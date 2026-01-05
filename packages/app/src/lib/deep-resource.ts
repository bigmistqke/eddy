/**
 * Deep resource primitive - combines resource fetching with store reconciliation.
 *
 * Fetches data via resource and syncs to a store using reconcile for fine-grained
 * reactivity. The store can be locally mutated while still receiving updates from refetches.
 */

import { createComputed, type Resource, type ResourceSource } from 'solid-js'
import { createStore, reconcile, type SetStoreFunction, type Store } from 'solid-js/store'
import {
  resource,
  type ManagedResourceReturn,
  type ResourceFetcher,
  type ManagedResourceOptions,
} from './resource'

type DeepResourceOptions<T extends object, R, S> = Omit<ManagedResourceOptions<R, S>, 'initialValue'> & {
  initialValue: T
  select?: (result: R) => T
}

type DeepResourceActions<R, S> = ManagedResourceReturn<R, S>[1]

/**
 * Creates a resource that syncs to a store with fine-grained reactivity.
 *
 * @example
 * ```ts
 * // Simple case - fetcher returns store type directly
 * const [settings, setSettings, res, { refetch }] = deepResource(
 *   () => userId(),
 *   async (id) => fetchSettings(id),
 *   { initialValue: defaultSettings }
 * )
 *
 * // With select - extract store value from larger response
 * const [project, setProject, res] = deepResource(
 *   () => projectId(),
 *   async (id) => getProjectRecord(id),
 *   {
 *     initialValue: createDefaultProject(),
 *     select: record => record.value
 *   }
 * )
 * // Access other fields from raw resource
 * const uri = () => res()?.uri
 * ```
 */
export function deepResource<T extends object, S, R = T>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, R>,
  options: DeepResourceOptions<T, R, S>,
): [Store<T>, SetStoreFunction<T>, Resource<R>, DeepResourceActions<R, S>] {
  const { initialValue, select, ...resourceOptions } = options

  const [store, setStore] = createStore<T>(initialValue)
  const [res, actions] = resource(source, fetcher, resourceOptions as ManagedResourceOptions<R, S>)

  createComputed(() => {
    const result = res()
    if (result !== undefined) {
      const value = select ? select(result) : (result as unknown as T)
      setStore(reconcile(value))
    }
  })

  return [store, setStore, res, actions]
}
