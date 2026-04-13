/**
 * POI Engine Module - Public API
 * 
 * Layer 3: Trade Request lifecycle management.
 * Provides state machine validation, transition requests, and event queries.
 */

export {
  POI_STATES,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  IMMUTABLE_STATES,
  UNILATERAL_STATE_CAP,
  validateTransition,
  validateUnilateralTransition,
  isMutable,
  canCollapse,
} from './state-machine';

export type {
  PoiState,
  TransitionRequest,
  TransitionResult,
} from './state-machine';

export { requestTransition, getPoiHistory } from './client';
