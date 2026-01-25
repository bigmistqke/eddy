/**
 * Compile Musical Timeline
 *
 * Converts MusicalProject (tick-based timing) to AbsoluteProject (ms-based)
 * and delegates to compileAbsoluteTimeline.
 */

import type { AbsoluteClip, AbsoluteProject, MusicalClip, MusicalProject } from '@eddy/lexicons'
import { compileAbsoluteTimeline } from './compile-absolute-timeline'
import type { CanvasSize, CompiledTimeline } from './types'

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

/**********************************************************************************/
/*                                                                                */
/*                                  Conversion                                    */
/*                                                                                */
/**********************************************************************************/

/** Convert a MusicalClip to AbsoluteClip */
function convertClip(clip: MusicalClip, bpm: number, ppq: number): AbsoluteClip {
  return {
    id: clip.id,
    source: clip.source,
    start: ticksToMs(clip.start, bpm, ppq),
    duration: ticksToMs(clip.duration, bpm, ppq),
    offset: clip.offset ? ticksToMs(clip.offset, bpm, ppq) : undefined,
    speed: clip.speed,
    reverse: clip.reverse,
    audioPipeline: clip.audioPipeline,
    visualPipeline: clip.visualPipeline,
  }
}

/** Convert MusicalProject to AbsoluteProject */
function musicalToAbsolute(project: MusicalProject): AbsoluteProject {
  const bpm = project.bpm ?? DEFAULT_BPM
  const ppq = project.ppq ?? DEFAULT_PPQ

  const clips: AbsoluteClip[] = project.clips.map(clip => convertClip(clip, bpm, ppq))

  // Calculate duration from durationTicks or derive from clips
  let duration: number | undefined
  if (project.durationTicks !== undefined) {
    duration = ticksToMs(project.durationTicks, bpm, ppq)
  }

  return {
    schemaVersion: project.schemaVersion,
    title: project.title,
    description: project.description,
    duration,
    canvas: project.canvas,
    curves: project.curves,
    tracks: project.tracks,
    clips,
    groups: project.groups,
    root: project.root,
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
 * Compile a MusicalProject into a CompiledTimeline.
 * Converts tick-based timing to ms-based, then delegates to compileAbsoluteTimeline.
 */
export function compileMusicalTimeline(
  project: MusicalProject,
  canvasSize: CanvasSize,
): CompiledTimeline {
  const absoluteProject = musicalToAbsolute(project)
  return compileAbsoluteTimeline(absoluteProject, canvasSize)
}

/** Export the converter for testing/debugging */
export { musicalToAbsolute }
