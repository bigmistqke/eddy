/**
 * Wrapper around createResource that provides automatic AbortController management.
 *
 * - Automatically creates an AbortController for each fetch
 * - Automatically aborts previous fetch on refetch
 * - Provides a cancel function for manual cancellation
 */

import {
  createResource,
  type InitializedResourceReturn,
  type NoInfer,
  type Resource,
  type ResourceFetcher,
  type ResourceOptions,
  type ResourceReturn,
  type ResourceSource,
} from 'solid-js'

export interface CancellableResourceOptions<T, S>
  extends Omit<ResourceOptions<T, S>, 'storage'> {
  /** Custom storage for the resource */
  storage?: ResourceOptions<T, S>['storage']
}

export type CancellableResourceFetcher<S, T> = (
  source: S,
  info: { signal: AbortSignal; refetching: S | boolean }
) => T | Promise<T>

export type CancellableResourceReturn<T, S> = [
  resource: Resource<T>,
  actions: {
    mutate: ResourceReturn<T, S>[1]['mutate']
    refetch: ResourceReturn<T, S>[1]['refetch']
    cancel: () => void
  },
]

export type InitializedCancellableResourceReturn<T, S> = [
  resource: InitializedResourceReturn<T>[0],
  actions: {
    mutate: InitializedResourceReturn<T, S>[1]['mutate']
    refetch: InitializedResourceReturn<T, S>[1]['refetch']
    cancel: () => void
  },
]

/**
 * Creates a resource with automatic AbortController management.
 *
 * @example
 * ```ts
 * const [data, { cancel }] = createCancellableResource(
 *   source,
 *   async (value, { signal }) => {
 *     const response = await fetch(url, { signal })
 *     return response.json()
 *   }
 * )
 *
 * // Cancel manually
 * cancel()
 * ```
 */
export function createCancellableResource<T, S = true>(
  source: ResourceSource<S>,
  fetcher: CancellableResourceFetcher<S, T>,
  options: CancellableResourceOptions<NoInfer<T>, S> & {
    initialValue: T
  }
): InitializedCancellableResourceReturn<T, S>

export function createCancellableResource<T, S = true>(
  source: ResourceSource<S>,
  fetcher: CancellableResourceFetcher<S, T>,
  options?: CancellableResourceOptions<NoInfer<T>, S>
): CancellableResourceReturn<T, S>

export function createCancellableResource<T, S = true>(
  source: ResourceSource<S>,
  fetcher: CancellableResourceFetcher<S, T>,
  options?: CancellableResourceOptions<NoInfer<T>, S>
): CancellableResourceReturn<T, S> {
  let abortController: AbortController | null = null

  // Wrap the fetcher to handle abort controller
  const wrappedFetcher: ResourceFetcher<S, T, S> = async (sourceValue, info) => {
    // Abort previous fetch if refetching
    if (info.refetching && abortController) {
      abortController.abort()
    }

    // Create new abort controller for this fetch
    abortController = new AbortController()
    const { signal } = abortController

    try {
      return await fetcher(sourceValue, {
        signal,
        refetching: info.refetching,
      })
    } finally {
      // Clear controller when done (unless it was replaced by a new fetch)
      if (abortController?.signal === signal) {
        abortController = null
      }
    }
  }

  const [resource, { mutate, refetch }] = createResource(
    source,
    wrappedFetcher,
    options
  )

  function cancel() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  return [resource, { mutate, refetch, cancel }]
}
