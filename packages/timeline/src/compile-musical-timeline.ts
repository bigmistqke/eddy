/**
 * Musical Timeline Utilities
 *
 * Converts musical timing (ticks) to absolute timing (ms).
 * Uses the same runtime query approach as absolute timeline.
 */

import type { MusicalClip, MusicalProject, AbsoluteProject, AbsoluteClip } from '@eddy/lexicons'
import type { CanvasSize, Placement } from './compile-absolute-timeline'
import { getPlacementsAtTime as getAbsolutePlacementsAtTime, getProjectDuration as getAbsoluteProjectDuration } from './compile-absolute-timeline'

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

const DEFAULT_PPQ = 960
const DEFAULT_BPM = 12000 // 120 BPM scaled by 100

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Convert ticks to milliseconds */
function ticksToMs(ticks: number, bpm: number, ppq: number): number {
  // bpm is scaled by 100 in lexicon
  const actualBpm = bpm / 100
  const msPerBeat = 60000 / actualBpm
  const msPerTick = msPerBeat / ppq
  return Math.round(ticks * msPerTick)
}

/** Convert a MusicalClip to AbsoluteClip */
function convertClip(clip: MusicalClip, bpm: number, ppq: number): AbsoluteClip {
  return {
    id: clip.id,
    source: clip.source,
    start: ticksToMs(clip.start, bpm, ppq),
    duration: clip.duration !== undefined ? ticksToMs(clip.duration, bpm, ppq) : undefined,
    offset: clip.offset !== undefined ? ticksToMs(clip.offset, bpm, ppq) : undefined,
    speed: clip.speed,
    reverse: clip.reverse,
    audioPipeline: clip.audioPipeline,
    visualPipeline: clip.visualPipeline,
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                  Conversion                                    */
/*                                                                                */
/**********************************************************************************/

/** Convert MusicalProject to AbsoluteProject */
export function musicalToAbsolute(project: MusicalProject): AbsoluteProject {
  const bpm = project.bpm ?? DEFAULT_BPM
  const ppq = project.ppq ?? DEFAULT_PPQ

  // Convert media tracks
  const mediaTracks = project.mediaTracks.map(track => ({
    id: track.id,
    name: track.name,
    clips: track.clips.map(clip => convertClip(clip, bpm, ppq)),
    audioPipeline: track.audioPipeline,
    visualPipeline: track.visualPipeline,
    muted: track.muted,
    solo: track.solo,
  }))

  // Convert metadata tracks
  const metadataTracks = (project.metadataTracks ?? []).map(track => ({
    id: track.id,
    name: track.name,
    clips: track.clips.map(clip => convertClip(clip, bpm, ppq)),
  }))

  return {
    schemaVersion: project.schemaVersion,
    title: project.title,
    description: project.description,
    duration: project.durationTicks !== undefined ? ticksToMs(project.durationTicks, bpm, ppq) : undefined,
    canvas: project.canvas,
    mediaTracks,
    metadataTracks,
    parent: project.parent,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                 Public API                                     */
/*                                                                                */
/**********************************************************************************/

/**
 * Get placements at a given time (in ticks).
 * Converts to absolute timing internally.
 */
export function getPlacementsAtTime(
  project: MusicalProject,
  timeTicks: number,
  canvas: CanvasSize,
): Placement[] {
  const bpm = project.bpm ?? DEFAULT_BPM
  const ppq = project.ppq ?? DEFAULT_PPQ
  const timeMs = ticksToMs(timeTicks, bpm, ppq)

  const absoluteProject = musicalToAbsolute(project)
  return getAbsolutePlacementsAtTime(absoluteProject, timeMs, canvas)
}

/**
 * Get project duration in ticks.
 */
export function getProjectDuration(project: MusicalProject): number {
  if (project.durationTicks !== undefined) {
    return project.durationTicks
  }

  // Calculate from clips
  const bpm = project.bpm ?? DEFAULT_BPM
  const ppq = project.ppq ?? DEFAULT_PPQ
  const absoluteProject = musicalToAbsolute(project)
  const durationMs = getAbsoluteProjectDuration(absoluteProject)

  // Convert back to ticks
  const actualBpm = bpm / 100
  const msPerBeat = 60000 / actualBpm
  const msPerTick = msPerBeat / ppq
  return Math.round(durationMs / msPerTick)
}
