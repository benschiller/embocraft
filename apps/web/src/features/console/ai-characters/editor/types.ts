import type { AICharactersController } from '../useAICharactersController';
import type { ConsoleFeedback } from '../../useConsoleFeedback';
import type { ProviderView } from '@voxel/shared';
export type AICharacterFormProps = Pick<
  AICharactersController,
  | 'agent'
  | 'setAgent'
  | 'editingAgent'
  | 'setShowAgentForm'
  | 'selected'
  | 'chooseProvider'
  | 'saveAgent'
  | 'joinOnCreate'
  | 'setJoinOnCreate'
  | 'jobs'
  | 'deleteAgent'
  | 'joinAgent'
  | 'stopAgent'
> &
  Pick<ConsoleFeedback, 'busy' | 'setNotice' | 'setError' | 'error'> & {
    providers: ProviderView[];
    disabled: boolean;
    capacityFull?: boolean;
    leaveDisabled?: boolean;
  };
