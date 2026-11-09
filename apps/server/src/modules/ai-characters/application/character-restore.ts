import type { PlanService } from '../../tasks';
import { restoreAICharacterLogs } from '../domain/activity-log';
import { validateAICharacter } from '../domain/character-settings';
import { AppError } from '../../../core/errors/app-error';
import { isMissingApiKey, type ProviderRuntimePort } from '../../providers';
import type { CharacterRecord } from '../persistence/character-record';
import { createCharacterJob, type Job } from '../runtime/character-registry';
import { restoreTaskExecution, restoreTaskMemory } from '../../tasks';
import { executionState } from '../integrations/task-execution-adapter';

export async function restoreAICharacterJob(
  view: CharacterRecord,
  providers: ProviderRuntimePort,
  ledger: PlanService,
): Promise<{ job: Job; shouldAutoJoin: boolean }> {
  const provider = await providers.getRuntime(view.providerId);
  const settings = validateAICharacter(view, provider, {
    allowMissingApiKey: true,
  });
  if (typeof view.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(view.id))
    throw new AppError('Agent 标识无效。', 500);

  const missingApiKey = isMissingApiKey(provider);

  const job = createCharacterJob(
    {
      view: {
        ...settings,
        id: view.id,
        createdAt: view.createdAt,
        providerName: provider.name,
        status: 'stopped',
        ...restoreAICharacterLogs(view.logEntries),
      },
      abort: new AbortController(),
      ledger,
      currentRunId: view.currentRunId,
    },
    restoreTaskMemory(view.runtime),
  );

  restoreTaskExecution(executionState(job));

  const shouldAutoJoin =
    !missingApiKey &&
    ['idle', 'running', 'joining', 'failed'].includes(view.status);

  return { job, shouldAutoJoin };
}
