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
 * - dj.eddy.track: Media and metadata tracks with inline clips
 * - dj.eddy.clip: Source types (stem, url, project, layout)
 * - dj.eddy.canvas: Canvas definition
 */

import {
    createLookup,
    lexiconToValibot,
    type InferLexiconOutput
} from '@bigmistqke/lexicon-to-valibot'
import strongRefLexicon from '@bigmistqke/typed-lexicons/com/atproto/repo/strongRef'
import * as v from "valibot"

// Lexicon imports
import absoluteLexicon from './dj.eddy.absolute'
import audioEffectLexicon from './dj.eddy.audio.effect'
import canvasLexicon from './dj.eddy.canvas'
import clipLexicon from './dj.eddy.clip'
import jamLexicon from './dj.eddy.jam'
import musicalLexicon from './dj.eddy.musical'
import pipelineLexicon from './dj.eddy.pipeline'
import stemLexicon from './dj.eddy.stem'
import trackLexicon from './dj.eddy.track'
import curveLexicon from './dj.eddy.value.curve'
import vectorLexicon from './dj.eddy.value.vector'
import visualEffectLexicon from './dj.eddy.visual.effect'

const lookup = createLookup(
    absoluteLexicon,
    audioEffectLexicon,
    canvasLexicon,
    clipLexicon,
    curveLexicon,
    vectorLexicon,
    jamLexicon,
    musicalLexicon,
    pipelineLexicon,
    stemLexicon,
    strongRefLexicon,
    trackLexicon,
    visualEffectLexicon,
)

const sdkConfig = { lookup, format: 'sdk' } as const
const wireConfig = { lookup, format: 'wire' } as const

const integerValidator = v.object({ type: v.literal('integer'), value: v.number() })

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
export const valuesValidators = lexiconToValibot(vectorLexicon, sdkConfig)
export const curveValidators = lexiconToValibot(curveLexicon, sdkConfig)
export const trackValidators = lexiconToValibot(trackLexicon, sdkConfig)
export const clipValidators = lexiconToValibot(clipLexicon, sdkConfig)
export const jamValidators = lexiconToValibot(jamLexicon, sdkConfig)
export const pipelineValidators = lexiconToValibot(pipelineLexicon, sdkConfig)

// Wire format validators
export const absoluteWireValidators = lexiconToValibot(absoluteLexicon, wireConfig)
export const musicalWireValidators = lexiconToValibot(musicalLexicon, wireConfig)
export const stemWireValidators = lexiconToValibot(stemLexicon, wireConfig)
export const audioEffectWireValidators = lexiconToValibot(audioEffectLexicon, wireConfig)
export const visualEffectWireValidators = lexiconToValibot(visualEffectLexicon, wireConfig)
export const valuesWireValidators = lexiconToValibot(vectorLexicon, wireConfig)
export const curveWireValidators = lexiconToValibot(curveLexicon, wireConfig)
export const jamWireValidators = lexiconToValibot(jamLexicon, wireConfig)
export const pipelineWireValidators = lexiconToValibot(pipelineLexicon, wireConfig)

export const isMediaClip = (clip: any): clip is MediaClip => {
    return v.safeParse(clipValidators['clip.project'], clip).success ||
        v.safeParse(clipValidators['clip.stem'], clip).success ||
        v.safeParse(clipValidators['clip.url'], clip).success
}

export const isClipStem = (clip: any): clip is ClipStem => {
    return v.safeParse(clipValidators['clip.stem'], clip).success
}

export const isClipLayout = (clip: any): clip is ClipLayout => {
    return v.safeParse(clipValidators['clip.layout'], clip).success
}

export const isInteger = (value: any): value is Integer => {
    return v.safeParse(integerValidator, value).success
}

/**********************************************************************************/
/*                                                                                */
/*                                      Types                                     */
/*                                                                                */
/**********************************************************************************/

export type Integer = v.InferOutput<typeof integerValidator>

// Absolute time domain (ms)
export type AbsoluteProject = v.InferOutput<typeof absoluteValidators.project>

// Musical time domain (bars)
export type MusicalProject = v.InferOutput<typeof musicalValidators.project>
export type TimeSignature = v.InferOutput<typeof musicalValidators.timeSignature>

// Union types for generic handling
export type Project = AbsoluteProject | MusicalProject

// Canvas
export type Canvas = v.InferOutput<typeof canvasValidators.canvas>

// Track types (with inline clips)
export type MediaTrack = v.InferOutput<(typeof trackValidators)['media']>
export type LayoutTrack = v.InferOutput<(typeof trackValidators)['layout']>
export type Track = MediaTrack | LayoutTrack

// Clip sources (shared)
export type ClipStem = v.InferOutput<(typeof clipValidators)['clip.stem']>
export type ClipUrl = v.InferOutput<(typeof clipValidators)['clip.url']>
export type ClipProject = v.InferOutput<(typeof clipValidators)['clip.project']>
export type ClipLayout = v.InferOutput<(typeof clipValidators)['clip.layout']>

export type MediaClip = ClipStem | ClipUrl | ClipProject
export type MetadataClip = ClipLayout

export type Clip = MediaClip | MetadataClip

// Value types
export type StaticVec2 = v.InferOutput<typeof valuesValidators.vec2>
export type StaticVec3 = v.InferOutput<typeof valuesValidators.vec3>
export type StaticVec4 = v.InferOutput<typeof valuesValidators.vec4>
export type CustomParams = v.InferOutput<typeof valuesValidators.customParams>

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
