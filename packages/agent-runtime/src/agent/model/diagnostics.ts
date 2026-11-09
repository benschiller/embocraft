import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Operator diagnostics for failed provider calls (Floperati). The transcript only
 * ever shows a redacted message; this logs the provider's own error body to the
 * server log, and with MODEL_DEBUG_DIR set also saves the request JSON for replay.
 * The request body carries the conversation and tools, never the API key (that is
 * an Authorization header and is not recorded).
 */
export async function reportProviderFailure(
  url: string,
  init: RequestInit | undefined,
  response: Response,
): Promise<void> {
  let body: string;
  try {
    body = (await response.clone().text()).slice(0, 2000);
  } catch {
    body = '<unreadable>';
  }
  const requestText = typeof init?.body === 'string' ? init.body : '';
  let summary: string;
  try {
    const request = JSON.parse(requestText) as {
      model?: string;
      messages?: unknown[];
      tools?: unknown[];
      max_tokens?: number;
      max_completion_tokens?: number;
    };
    summary = ` model=${request.model} messages=${request.messages?.length} tools=${request.tools?.length} max_tokens=${request.max_tokens ?? request.max_completion_tokens} bytes=${requestText.length}`;
  } catch {
    summary = ` bytes=${requestText.length}`;
  }
  console.warn(
    `[model] HTTP ${response.status} from ${new URL(url).host}${summary} body=${body}`,
  );
  const dir = process.env.MODEL_DEBUG_DIR;
  if (!dir || !requestText) return;
  try {
    await mkdir(dir, { recursive: true });
    const file = join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${response.status}.json`,
    );
    await writeFile(
      file,
      JSON.stringify(
        {
          url,
          status: response.status,
          response: body,
          request: JSON.parse(requestText),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.warn(`[model] request saved to ${file}`);
  } catch (error) {
    console.warn('[model] could not save failed request', error);
  }
}

/** With MODEL_DEBUG_DIR set, keep the latest request body for offline replay. */
export async function saveLastRequest(init: RequestInit | undefined) {
  const dir = process.env.MODEL_DEBUG_DIR;
  if (!dir || typeof init?.body !== 'string') return;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'last-request.json'), init.body, { mode: 0o600 });
  } catch (error) {
    console.warn('[model] could not save last request', error);
  }
}
