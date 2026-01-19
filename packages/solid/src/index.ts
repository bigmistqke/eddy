/**
 * @eddy/solid
 *
 * Shared SolidJS primitives for the eddy suite.
 * Generic reactive utilities that can be used across apps.
 */

// Async action with abort/cleanup support
export {
  action,
  defer,
  hold,
  CancelledError,
  $HOLD,
  $CLEANUP,
  type Action,
  type ActionContext,
  type ActionFetcher,
  type ActionFn,
  type ActionGenerator,
  type AsyncFetcher,
  type GeneratorFetcher,
  type TryFn,
  type PhaseContext,
  type PhasedAction,
  type PhaseMethod,
  type PromiseWithCleanup,
} from './action'

// Enhanced createResource with cleanup/abort
export {
  resource,
  type ResourceFetcher,
  type ResourceFetcherInfo,
  type ManagedResourceReturn,
  type ManagedResourceOptions,
  type InitializedManagedResourceReturn,
  type SimpleFetcher,
} from './resource'

// Resource + store reconciliation
export { deepResource, type StoreAccessor } from './deep-resource'

// Reactive map of resources
export { createResourceMap, type ResourceMap } from './create-resource-map'

// Clock for time management
export { createClock, type Clock, type ClockOptions } from './create-clock'
