import {
  createLookup,
  lexiconToValibot,
  type InferLexiconOutput,
} from '@bigmistqke/lexicon-to-valibot'
import strongRefLexicon from '@bigmistqke/typed-lexicons/com/atproto/repo/strongRef'
import type * as v from 'valibot'
import audioEffectLexicon from './app.eddy.audioEffect'
import clipLexicon from './app.eddy.clip'
import groupLexicon from './app.eddy.group'
import jamLexicon from './app.eddy.jam'
import pipelineLexicon from './app.eddy.pipeline'
import projectLexicon from './app.eddy.project'
import stemLexicon from './app.eddy.stem'
import trackLexicon from './app.eddy.track'
import curveLexicon from './app.eddy.value.curve'
import staticValueLexicon from './app.eddy.value.static'
import visualEffectLexicon from './app.eddy.visualEffect'

const lookup = createLookup(
  audioEffectLexicon,
  clipLexicon,
  curveLexicon,
  groupLexicon,
  jamLexicon,
  pipelineLexicon,
  projectLexicon,
  stemLexicon,
  strongRefLexicon,
  trackLexicon,
  staticValueLexicon,
  visualEffectLexicon,
)

// SDK format validators for parsing incoming data from PDS
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

// Wire format validators for validating outgoing data to PDS
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

// Types inferred from validators (satisfies preserves literal types without readonly)
export type Project = v.InferOutput<typeof projectValidators.main>
export type Canvas = v.InferOutput<typeof projectValidators.canvas>
export type Track = v.InferOutput<typeof trackValidators.track>
export type Clip = v.InferOutput<typeof clipValidators.clip>
export type ClipSourceStem = v.InferOutput<(typeof clipValidators)['clipSource.stem']>
export type ClipSourceGroup = v.InferOutput<(typeof clipValidators)['clipSource.group']>
export type ClipSource = ClipSourceStem | ClipSourceGroup
export type StaticValue = v.InferOutput<typeof valuesValidators.staticValue>
export type StaticVec2 = v.InferOutput<typeof valuesValidators.staticVec2>
export type StaticVec3 = v.InferOutput<typeof valuesValidators.staticVec3>
export type StaticVec4 = v.InferOutput<typeof valuesValidators.staticVec4>
export type StaticBlendMode = v.InferOutput<typeof valuesValidators.staticBlendMode>
export type CustomParams = v.InferOutput<typeof valuesValidators.customParams>
// TODO: Re-enable when curve system is implemented
// export type CurveRef = v.InferOutput<typeof projectValidators.curveRef>
export type StemRef = InferLexiconOutput<typeof strongRefLexicon, 'main'>

// Group types
export type Group = v.InferOutput<(typeof groupValidators)['group']>
export type Member = v.InferOutput<(typeof groupValidators)['member']>
export type MemberVoid = v.InferOutput<(typeof groupValidators)['member.void']>
export type LayoutGrid = v.InferOutput<(typeof groupValidators)['layout.grid']>

// Pipeline types
export type PipelineOutput = v.InferOutput<typeof pipelineValidators.output>
export type AudioPipeline = v.InferOutput<typeof pipelineValidators.audioPipeline>
export type VideoPipeline = v.InferOutput<typeof pipelineValidators.videoPipeline>

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

export type Value = StaticValue // TODO: add | CurveRef when curve system is implemented

// Stem types
export type Stem = v.InferOutput<typeof stemValidators.main>
export type AudioMeta = v.InferOutput<typeof stemValidators.audioMeta>
export type VideoMeta = v.InferOutput<typeof stemValidators.videoMeta>

// Curve types
export type CurveKeyframe = v.InferOutput<typeof curveValidators.keyframe>
export type CurveEnvelope = v.InferOutput<typeof curveValidators.envelope>
export type CurveLfo = v.InferOutput<typeof curveValidators.lfo>
export type Curve = CurveKeyframe | CurveEnvelope | CurveLfo

// Jam types
export type JamMetadata = v.InferOutput<typeof jamValidators.metadata>
export type JamColumn = v.InferOutput<typeof jamValidators.column>
export type JamColumnDuration = v.InferOutput<typeof jamValidators.columnDuration>
export type JamLayoutType = v.InferOutput<typeof jamValidators.layoutType>
