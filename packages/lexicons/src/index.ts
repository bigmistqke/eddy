/**
 * Eddy Lexicons
 *
 * ATProto lexicon definitions for Eddy projects.
 *
 * Time domains:
 * - dj.eddy.absolute: Clips/projects with ms timing (video editors)
 * - dj.eddy.musical: Clips/projects with bar timing (DAWs, jam)
 *
 * Shared:
 * - dj.eddy.track: Track with clipIds[] (domain-agnostic)
 * - dj.eddy.group: Group with members[] (domain-agnostic)
 * - dj.eddy.clip: Source types only (stem, group refs)
 * - dj.eddy.absolute: Canvas definition
 */

import {
  createLookup,
  lexiconToValibot,
  type InferLexiconOutput,
} from '@bigmistqke/lexicon-to-valibot'
import strongRefLexicon from '@bigmistqke/typed-lexicons/com/atproto/repo/strongRef'
import type * as v from 'valibot'

// Lexicon imports
import absoluteLexicon from './dj.eddy.absolute'
import audioEffectLexicon from './dj.eddy.audio.effect'
import canvasLexicon from './dj.eddy.canvas'
import clipLexicon from './dj.eddy.clip'
import groupLexicon from './dj.eddy.group'
import jamLexicon from './dj.eddy.jam'
import musicalLexicon from './dj.eddy.musical'
import pipelineLexicon from './dj.eddy.pipeline'
import stemLexicon from './dj.eddy.stem'
import trackLexicon from './dj.eddy.track'
import curveLexicon from './dj.eddy.value.curve'
import fixedLexicon from './dj.eddy.value.static'
import visualEffectLexicon from './dj.eddy.visual.effect'

const lookup = createLookup(
  absoluteLexicon,
  audioEffectLexicon,
  clipLexicon,
  curveLexicon,
  groupLexicon,
  jamLexicon,
  musicalLexicon,
  pipelineLexicon,
  absoluteLexicon,
  stemLexicon,
  strongRefLexicon,
  trackLexicon,
  fixedLexicon,
  visualEffectLexicon,
)

const sdkConfig = { lookup, format: 'sdk' } as const
const wireConfig = { lookup, format: 'wire' } as const

/**********************************************************************************/
/*                                                                                */
/*                                   Validators                                   */
/*                                                                                */
/**********************************************************************************/

// Time domain validators (SDK format)
export const absoluteValidators = lexiconToValibot(absoluteLexicon, sdkConfig)
export const musicalValidators = lexiconToValibot(musicalLexicon, sdkConfig)

// Shared validators (SDK format)
export const canvasValidators = lexiconToValibot(canvasLexicon, sdkConfig)
export const stemValidators = lexiconToValibot(stemLexicon, sdkConfig)
export const audioEffectValidators = lexiconToValibot(audioEffectLexicon, sdkConfig)
export const visualEffectValidators = lexiconToValibot(visualEffectLexicon, sdkConfig)
export const valuesValidators = lexiconToValibot(fixedLexicon, sdkConfig)
export const curveValidators = lexiconToValibot(curveLexicon, sdkConfig)
export const trackValidators = lexiconToValibot(trackLexicon, sdkConfig)
export const clipValidators = lexiconToValibot(clipLexicon, sdkConfig)
export const groupValidators = lexiconToValibot(groupLexicon, sdkConfig)
export const jamValidators = lexiconToValibot(jamLexicon, sdkConfig)
export const pipelineValidators = lexiconToValibot(pipelineLexicon, sdkConfig)

// Wire format validators
export const absoluteWireValidators = lexiconToValibot(absoluteLexicon, wireConfig)
export const musicalWireValidators = lexiconToValibot(musicalLexicon, wireConfig)
export const stemWireValidators = lexiconToValibot(stemLexicon, wireConfig)
export const audioEffectWireValidators = lexiconToValibot(audioEffectLexicon, wireConfig)
export const visualEffectWireValidators = lexiconToValibot(visualEffectLexicon, wireConfig)
export const valuesWireValidators = lexiconToValibot(fixedLexicon, wireConfig)
export const curveWireValidators = lexiconToValibot(curveLexicon, wireConfig)
export const jamWireValidators = lexiconToValibot(jamLexicon, wireConfig)
export const pipelineWireValidators = lexiconToValibot(pipelineLexicon, wireConfig)

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
export type Canvas = v.InferOutput<typeof canvasValidators.canvas>

// Track (domain-agnostic, uses clipIds)
export type Track = v.InferOutput<typeof trackValidators.track>

// Clip sources (shared)
export type ClipSourceStem = v.InferOutput<(typeof clipValidators)['source.stem']>
export type ClipSourceGroup = v.InferOutput<(typeof clipValidators)['source.group']>
export type ClipSource = ClipSourceStem | ClipSourceGroup

// Group types
export type Group = v.InferOutput<(typeof groupValidators)['group']>
export type Member = v.InferOutput<(typeof groupValidators)['member']>
export type MemberVoid = v.InferOutput<(typeof groupValidators)['member.void']>
export type LayoutGrid = v.InferOutput<(typeof groupValidators)['layout.grid']>

// Value types
export type StaticValue = v.InferOutput<typeof valuesValidators.fixed>
export type StaticVec2 = v.InferOutput<typeof valuesValidators.vec2>
export type StaticVec3 = v.InferOutput<typeof valuesValidators.vec3>
export type StaticVec4 = v.InferOutput<typeof valuesValidators.vec4>
export type StaticBlendMode = v.InferOutput<typeof valuesValidators.blendMode>
export type CustomParams = v.InferOutput<typeof valuesValidators.customParams>
export type Value = StaticValue

// Pipeline types
export type PipelineOutput = v.InferOutput<typeof pipelineValidators.output>
export type AudioPipeline = v.InferOutput<typeof pipelineValidators.audioPipeline>
export type VisualPipeline = v.InferOutput<typeof pipelineValidators.visualPipeline>

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
