/**
 * Deep resource primitive - combines resource fetching with store reconciliation.
 *
 * Fetches data via resource and syncs to a store using reconcile for fine-grained
 * reactivity. The store can be locally mutated while still receiving updates from refetches.
 */

import { type InitializedResource, type ResourceSource } from 'solid-js'
import { createStore, reconcile, type SetStoreFunction, type Store } from 'solid-js/store'
import { resource, type ManagedResourceReturn, type ResourceFetcher } from './resource'

interface DeepResourceActions<T, U> extends Omit<ManagedResourceReturn<T, U>[1], 'mutate'> {
  mutate: SetStoreFunction<Awaited<T>>
}

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
export function deepResource<T extends Promise<object> | object, S>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, NoInfer<T>>,
  options: { initialValue: Awaited<T> },
): [InitializedResource<Store<T>>, DeepResourceActions<T, S>] {
  const [store, setStore] = createStore(options.initialValue)

  const [result, actions] = resource(
    source,
    async (source, info) => {
      const result = await fetcher(source, info)
      setStore(reconcile(result))
      return store
    },
    options,
  )

  return [
    result,
    {
      ...actions,
      mutate: setStore,
    },
  ] as const
}
