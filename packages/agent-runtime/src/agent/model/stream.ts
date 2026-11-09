import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type OpenAICompletionsOptions,
} from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import {
  stream as streamGoogle,
  type GoogleOptions,
} from '@earendil-works/pi-ai/api/google-generative-ai';
import { usesGoogleThinkingLevel } from '@earendil-works/pi-ai/api/google-shared';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AgentConfig, ModelEndpoint } from '../../contracts/config';
import { mergeSignals, withDeadline } from '../../kernel/abort';
import {
  estimateTokens,
  RequestCharge,
  type RequestAccounting,
} from './charge';
import { streamFailure, thrownFailure, type StreamFailure } from './failure';
import { reportProviderFailure, saveLastRequest } from './diagnostics';
import { createModel } from './pi';

/** Everything one character turn needs to make provider requests. */
export type ModelStreamOptions = {
  config: AgentConfig;
  endpoint: ModelEndpoint;
  budget: RequestAccounting;
  /** Turn-level stop signal, composed with the loop signal and a deadline. */
  signal: AbortSignal;
  /** Injected OpenAI-compatible transport; the Google SDK uses global fetch. */
  request?: typeof fetch;
  /**
   * Persists request admission before dispatch. Called after the call is charged
   * and before the request leaves, so a crash cannot replay it for free.
   */
  persistAdmission?: () => Promise<void>;
};

type StreamFnArgs = Parameters<StreamFn>;

type RelayRequest = ModelStreamOptions & {
  context: StreamFnArgs[1];
  callerSignal?: AbortSignal;
  output: AssistantMessageEventStream;
};

/**
 * Streams one provider request into Pi's decision loop. The request model is
 * rebuilt from the turn config so mutable Pi state cannot change its identity.
 */
export function streamModel(
  options: ModelStreamOptions,
  context: StreamFnArgs[1],
  callerSignal?: AbortSignal,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void relay({ ...options, context, callerSignal, output });
  return output;
}

/** Runs one model call and relays its events until a terminal event or failure. */
async function relay(request: RelayRequest) {
  const { config, endpoint, budget, output } = request;
  const model = createModel(config, request.endpoint);
  const deadline = withDeadline(
    mergeSignals(request.signal, request.callerSignal),
    Math.min(config.timeoutMs, budget.remainingMs),
    'model_timeout',
  );
  const combined = deadline.signal;
  const charge = new RequestCharge(
    budget,
    estimateTokens(request.context, config.maxTokens),
  );
  const fail = (failure: StreamFailure) =>
    output.push({
      type: 'error',
      reason: failure.stopReason,
      error: errorMessage(model, failure),
    });
  let status = 0;
  try {
    combined.throwIfAborted();
    // Charge and persist admission before dispatch: a crash between these lines
    // must leave the request accounted for rather than replaying it for free.
    const maxTokens = charge.begin();
    await request.persistAdmission?.();
    combined.throwIfAborted();
    const source =
      model.api === 'google-generative-ai'
        ? streamGoogle(model, request.context, {
            ...googleOptions(config, model),
            signal: combined,
            maxTokens,
          })
        : stream(model, request.context, {
            ...providerOptions(
              config,
              endpoint,
              request.request ?? fetch,
              (next) => (status = next),
            ),
            signal: combined,
            maxTokens,
          });
    for await (const event of source) {
      if (event.type === 'done' || event.type === 'error') {
        charge.settleUsage(
          (event.type === 'done' ? event.message : event.error).usage
            .totalTokens,
        );
        if (event.type === 'error' && !combined.aborted)
          console.warn(
            `[model] stream error status=${status} stopReason=${event.error.stopReason} message=${String(event.error.errorMessage ?? '').slice(0, 1000)}`,
          );
        if (event.type === 'error' || combined.aborted)
          fail(
            streamFailure({
              aborted: request.signal.aborted,
              expired: deadline.expired,
              status,
            }),
          );
        else output.push(event);
      } else if (!combined.aborted) output.push(event);
    }
  } catch (error) {
    charge.settleUnknown();
    fail(thrownFailure(error, request.signal.aborted));
  } finally {
    deadline.clear();
    output.end();
  }
}

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Terminal error message carrying model identity and failure details. */
function errorMessage(
  model: Model<'openai-completions'> | Model<'google-generative-ai'>,
  failure: StreamFailure,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: failure.stopReason,
    errorMessage: failure.message,
    timestamp: Date.now(),
  };
}

/** Keep native Gemini calls within the same admission, deadline and retry policy. */
export function googleOptions(
  config: AgentConfig,
  model: Model<'google-generative-ai'>,
): GoogleOptions {
  const enabled =
    config.thinking === 'enabled' && config.reasoningEffort !== 'none';
  return {
    apiKey: config.apiKey,
    maxRetries: 0,
    toolChoice: 'any',
    thinking: usesGoogleThinkingLevel(model)
      ? {
          enabled: true,
          level: enabled && config.reasoningEffort !== 'low' ? 'HIGH' : 'LOW',
        }
      : {
          enabled,
          budgetTokens: enabled
            ? config.reasoningEffort === 'low'
              ? 1024
              : 8192
            : 0,
        },
    onPayload: (payload) => {
      const params = payload as { config: Record<string, unknown> };
      // Pi's retry setting does not configure the SDK's own HTTP retries.
      params.config.httpOptions = {
        timeout: config.timeoutMs,
        retryOptions: { attempts: 1 },
      };
    },
  };
}

/**
 * IFM's hosted models are stateless reasoning models that reject a multi-turn
 * request unless every assistant message carries `reasoning_content` ("" is
 * valid). See https://docs.ifm.ai/docs/multi-turn.md
 */
export function requiresReasoningReplay(
  endpoint: ModelEndpoint,
  model: string,
) {
  let host = '';
  try {
    host = new URL(endpoint.baseUrl).hostname;
  } catch {
    // Invalid base URLs are rejected elsewhere.
  }
  return (
    host === 'ifm.ai' || host.endsWith('.ifm.ai') || model.startsWith('IFM/')
  );
}

/**
 * IFM reasoning effort (`chat_template_kwargs.reasoning_effort`: low|medium|high,
 * https://docs.ifm.ai/docs/reasoning.md). K2 always reasons; at its default effort
 * it can spend the whole `max_tokens` budget before emitting the required tool call.
 * Thinking off maps to `low`; thinking on follows the character's effort.
 */
export function ifmReasoningEffort(config: AgentConfig): 'low' | 'high' {
  if (config.thinking !== 'enabled') return 'low';
  return config.reasoningEffort === 'high' || config.reasoningEffort === 'max'
    ? 'high'
    : 'low';
}

/**
 * Shape an IFM request: replay each assistant turn's reasoning as
 * `reasoning_content` ("" when absent) and set the reasoning effort unless the
 * request already carries one.
 */
export function ifmPayload(payload: unknown, config: AgentConfig) {
  const params = payload as {
    messages?: Array<Record<string, unknown>>;
    chat_template_kwargs?: Record<string, unknown>;
  };
  for (const message of params.messages ?? []) {
    if (message.role !== 'assistant') continue;
    if (typeof message.reasoning_content === 'string') continue;
    message.reasoning_content =
      typeof message.reasoning === 'string' ? message.reasoning : '';
  }
  params.chat_template_kwargs = {
    reasoning_effort: ifmReasoningEffort(config),
    ...params.chat_template_kwargs,
  };
  return params;
}

/**
 * Static request options shared by every provider call of one stream.
 *
 * Every value here is a policy decision rather than a provider default: no
 * hidden retries, no prompt cache retention, and tool calls are required.
 */
export function providerOptions(
  config: AgentConfig,
  endpoint: ModelEndpoint,
  request: typeof fetch,
  onStatus: (status: number) => void,
): Omit<OpenAICompletionsOptions, 'signal' | 'maxTokens'> {
  return {
    apiKey: config.apiKey || 'ollama',
    maxRetries: 0,
    toolChoice: 'required',
    timeoutMs: config.timeoutMs,
    cacheRetention: 'none',
    reasoningEffort:
      endpoint.type === 'deepseek' &&
      config.thinking === 'enabled' &&
      config.reasoningEffort !== 'none'
        ? (config.reasoningEffort as OpenAICompletionsOptions['reasoningEffort'])
        : undefined,
    onPayload: requiresReasoningReplay(endpoint, config.model)
      ? (payload) => ifmPayload(payload, config)
      : undefined,
    fetch: async (url, init) => {
      await saveLastRequest(init);
      const response = await request(url, { ...init, redirect: 'error' });
      onStatus(response.status);
      if (response.status >= 400)
        await reportProviderFailure(String(url), init, response);
      return response;
    },
  };
}
