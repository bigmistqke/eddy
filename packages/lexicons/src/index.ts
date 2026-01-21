/**
 * Eddy Lexicons
 *
 * ATProto lexicon definitions for Eddy projects.
 *
 * Time domains:
 * - app.eddy.absolute: Clips/projects with ms timing (video editors)
 * - app.eddy.musical: Clips/projects with bar timing (DAWs, jam)
 *
 * Shared:
 * - app.eddy.track: Track with clipIds[] (domain-agnostic)
 * - app.eddy.group: Group with members[] (domain-agnostic)
 * - app.eddy.clip: Source types only (stem, group refs)
 * - app.eddy.project: Canvas definition
 */

import {
  createLookup,
  lexiconToValibot,
  type InferLexiconOutput,
} from '@bigmistqke/lexicon-to-valibot'
import strongRefLexicon from '@bigmistqke/typed-lexicons/com/atproto/repo/strongRef'
import type * as v from 'valibot'

// Lexicon imports
import absoluteLexicon from './app.eddy.absolute'
import audioEffectLexicon from './app.eddy.audioEffect'
import clipLexicon from './app.eddy.clip'
import groupLexicon from './app.eddy.group'
import jamLexicon from './app.eddy.jam'
import musicalLexicon from './app.eddy.musical'
import pipelineLexicon from './app.eddy.pipeline'
import projectLexicon from './app.eddy.project'
import stemLexicon from './app.eddy.stem'
import trackLexicon from './app.eddy.track'
import curveLexicon from './app.eddy.value.curve'
import staticValueLexicon from './app.eddy.value.static'
import visualEffectLexicon from './app.eddy.visualEffect'

const lookup = createLookup(
  absoluteLexicon,
  audioEffectLexicon,
  clipLexicon,
  curveLexicon,
  groupLexicon,
  jamLexicon,
  musicalLexicon,
  pipelineLexicon,
  projectLexicon,
  stemLexicon,
  strongRefLexicon,
  trackLexicon,
  staticValueLexicon,
  visualEffectLexicon,
)

/**********************************************************************************/
/*                                                                                */
/*                                   Validators                                   */
/*                                                                                */
/**********************************************************************************/

// Time domain validators (SDK format)
export const absoluteValidators = lexiconToValibot(absoluteLexicon, { lookup, format: 'sdk' })
export const musicalValidators = lexiconToValibot(musicalLexicon, { lookup, format: 'sdk' })

// Shared validators (SDK format)
export const projectValidators = lexiconToValibot(projectLexicon, { lookup, format: 'sdk' })
export const stemValidators = lexiconToValibot(stemLexicon, { lookup, format: 'sdk' })
export const audioEffectValidators = lexiconToValibot(audioEffectLexicon, { lookup, format: 'sdk' })
export const visualEffectValidators = lexiconToValibot(visualEffectLexicon, {
  lookup,
  format: 'sdk',
})
export const valuesValidators = lexiconToValibot(staticValueLexicon, { lookup, format: 'sdk' })
export const curveValidators = lexiconToValibot(curveLexicon, { lookup, format: 'sdk' })
export const trackValidators = lexiconToValibot(trackLexicon, { lookup, format: 'sdk' })
export const clipValidators = lexiconToValibot(clipLexicon, { lookup, format: 'sdk' })
export const groupValidators = lexiconToValibot(groupLexicon, { lookup, format: 'sdk' })
export const jamValidators = lexiconToValibot(jamLexicon, { lookup, format: 'sdk' })
export const pipelineValidators = lexiconToValibot(pipelineLexicon, { lookup, format: 'sdk' })

// Wire format validators
export const absoluteWireValidators = lexiconToValibot(absoluteLexicon, { lookup, format: 'wire' })
export const musicalWireValidators = lexiconToValibot(musicalLexicon, { lookup, format: 'wire' })
export const projectWireValidators = lexiconToValibot(projectLexicon, { lookup, format: 'wire' })
export const stemWireValidators = lexiconToValibot(stemLexicon, { lookup, format: 'wire' })
export const audioEffectWireValidators = lexiconToValibot(audioEffectLexicon, {
  lookup,
  format: 'wire',
})
export const visualEffectWireValidators = lexiconToValibot(visualEffectLexicon, {
  lookup,
  format: 'wire',
})
export const valuesWireValidators = lexiconToValibot(staticValueLexicon, { lookup, format: 'wire' })
export const curveWireValidators = lexiconToValibot(curveLexicon, { lookup, format: 'wire' })
export const jamWireValidators = lexiconToValibot(jamLexicon, { lookup, format: 'wire' })
export const pipelineWireValidators = lexiconToValibot(pipelineLexicon, { lookup, format: 'wire' })

/**********************************************************************************/
/*                                                                                */
/*                              Time Domain Types                                 */
/*                                                                                */
/**********************************************************************************/

// Absolute time domain (ms)
export type AbsoluteProject = v.InferOutput<typeof absoluteValidators.project>
export type AbsoluteClip = v.InferOutput<typeof absoluteValidators.clip>

// Musical time domain (bars)
export type MusicalProject = v.InferOutput<typeof musicalValidators.project>
export type MusicalClip = v.InferOutput<typeof musicalValidators.clip>
export type TimeSignature = v.InferOutput<typeof musicalValidators.timeSignature>

// Union types for generic handling
export type Project = AbsoluteProject | MusicalProject
export type Clip = AbsoluteClip | MusicalClip

/**********************************************************************************/
/*                                                                                */
/*                                 Shared Types                                   */
/*                                                                                */
/**********************************************************************************/

// Canvas
export type Canvas = v.InferOutput<typeof projectValidators.canvas>

// Track (domain-agnostic, uses clipIds)
export type Track = v.InferOutput<typeof trackValidators.track>

// Clip sources (shared)
export type ClipSourceStem = v.InferOutput<(typeof clipValidators)['clipSource.stem']>
export type ClipSourceGroup = v.InferOutput<(typeof clipValidators)['clipSource.group']>
export type ClipSource = ClipSourceStem | ClipSourceGroup

// Group types
export type Group = v.InferOutput<(typeof groupValidators)['group']>
export type Member = v.InferOutput<(typeof groupValidators)['member']>
export type MemberVoid = v.InferOutput<(typeof groupValidators)['member.void']>
export type LayoutGrid = v.InferOutput<(typeof groupValidators)['layout.grid']>

// Value types
export type StaticValue = v.InferOutput<typeof valuesValidators.staticValue>
export type StaticVec2 = v.InferOutput<typeof valuesValidators.staticVec2>
export type StaticVec3 = v.InferOutput<typeof valuesValidators.staticVec3>
export type StaticVec4 = v.InferOutput<typeof valuesValidators.staticVec4>
export type StaticBlendMode = v.InferOutput<typeof valuesValidators.staticBlendMode>
export type CustomParams = v.InferOutput<typeof valuesValidators.customParams>
export type Value = StaticValue

// Pipeline types
export type PipelineOutput = v.InferOutput<typeof pipelineValidators.output>
export type AudioPipeline = v.InferOutput<typeof pipelineValidators.audioPipeline>
export type VideoPipeline = v.InferOutput<typeof pipelineValidators.videoPipeline>

// Stem types
export type Stem = v.InferOutput<typeof stemValidators.main>
export type AudioMeta = v.InferOutput<typeof stemValidators.audioMeta>
export type VideoMeta = v.InferOutput<typeof stemValidators.videoMeta>
export type StemRef = InferLexiconOutput<typeof strongRefLexicon, 'main'>

// Curve types
export type CurveKeyframe = v.InferOutput<typeof curveValidators.keyframe>
export type CurveEnvelope = v.InferOutput<typeof curveValidators.envelope>
export type CurveLfo = v.InferOutput<typeof curveValidators.lfo>
export type Curve = CurveKeyframe | CurveEnvelope | CurveLfo

// Audio effect types
export type AudioEffectGain = v.InferOutput<typeof audioEffectValidators.gain>
export type AudioEffectPan = v.InferOutput<typeof audioEffectValidators.pan>
export type AudioEffectReverb = v.InferOutput<typeof audioEffectValidators.reverb>
export type AudioEffectCustom = v.InferOutput<typeof audioEffectValidators.custom>
export type AudioEffect = AudioEffectGain | AudioEffectPan | AudioEffectReverb | AudioEffectCustom

// Visual effect types
export type VisualEffectTransform = v.InferOutput<typeof visualEffectValidators.transform>
export type VisualEffectOpacity = v.InferOutput<typeof visualEffectValidators.opacity>
export type VisualEffectBrightness = v.InferOutput<typeof visualEffectValidators.brightness>
export type VisualEffectContrast = v.InferOutput<typeof visualEffectValidators.contrast>
export type VisualEffectSaturation = v.InferOutput<typeof visualEffectValidators.saturation>
export type VisualEffectColorize = v.InferOutput<typeof visualEffectValidators.colorize>
export type VisualEffectCustom = v.InferOutput<typeof visualEffectValidators.custom>
export type VisualEffect =
  | VisualEffectTransform
  | VisualEffectOpacity
  | VisualEffectBrightness
  | VisualEffectContrast
  | VisualEffectSaturation
  | VisualEffectColorize
  | VisualEffectCustom

// Jam types (uses musical time internally)
export type JamMetadata = v.InferOutput<typeof jamValidators.metadata>
export type JamLayoutRegion = v.InferOutput<typeof jamValidators.layoutRegion>
export type JamColumnDuration = v.InferOutput<typeof jamValidators.columnDuration>
export type JamLayoutType = v.InferOutput<typeof jamValidators.layoutType>
