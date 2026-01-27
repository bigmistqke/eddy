/**
 * @eddy/timeline
 *
 * Runtime utilities for querying project timeline data.
 * No pre-compilation - just query at render time.
 */

// Absolute timeline (ms) - primary API
export * from './absolute-timeline'
// Musical timeline (ticks) - converts to absolute internally
export * from './musical-timeline'
