import {
  createLookup,
  /* atprotoRefs, type AtprotoRefs, bundleLexicons */ lexiconToValibot,
  type InferLexiconOutput,
} from '@bigmistqke/lexicon-to-valibot'
import strongRefLexicon from '@bigmistqke/typed-lexicons/com/atproto/repo/strongRef'
import type * as v from 'valibot'
import audioEffectLexicon from './app.eddy.audioEffect'
import projectLexicon from './app.eddy.project'
import stemLexicon from './app.eddy.stem'
import valuesLexicon from './app.eddy.values'
import visualEffectLexicon from './app.eddy.visualEffect'

const lookup = createLookup(
  projectLexicon,
  audioEffectLexicon,
  visualEffectLexicon,
  stemLexicon,
  valuesLexicon,
  strongRefLexicon,
)

// SDK format validators for parsing incoming data from PDS
export const projectValidators = lexiconToValibot(projectLexicon, { lookup, format: 'sdk' })
export const stemValidators = lexiconToValibot(stemLexicon, { lookup, format: 'sdk' })
export const audioEffectValidators = lexiconToValibot(audioEffectLexicon, { lookup, format: 'sdk' })
export const visualEffectValidators = lexiconToValibot(visualEffectLexicon, {
  lookup,
  format: 'sdk',
})
export const valuesValidators = lexiconToValibot(valuesLexicon, { lookup, format: 'sdk' })

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
export const valuesWireValidators = lexiconToValibot(valuesLexicon, { lookup, format: 'wire' })

// Types inferred from validators (satisfies preserves literal types without readonly)
export type Project = v.InferOutput<typeof projectValidators.main>
export type Canvas = v.InferOutput<typeof projectValidators.canvas>
export type Track = v.InferOutput<typeof projectValidators.track>
export type Clip = v.InferOutput<typeof projectValidators.clip>
export type ClipSourceStem = v.InferOutput<(typeof projectValidators)['clipSource.stem']>
export type ClipSourceGroup = v.InferOutput<(typeof projectValidators)['clipSource.group']>
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
export type Group = v.InferOutput<(typeof projectValidators)['group']>
export type Member = v.InferOutput<(typeof projectValidators)['member']>
export type MemberVoid = v.InferOutput<(typeof projectValidators)['member.void']>
export type LayoutGrid = v.InferOutput<(typeof projectValidators)['layout.grid']>

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

// Curve types
export type CurveKeyframe = v.InferOutput<(typeof projectValidators)['curve.keyframe']>
export type CurveEnvelope = v.InferOutput<(typeof projectValidators)['curve.envelope']>
export type CurveLfo = v.InferOutput<(typeof projectValidators)['curve.lfo']>
export type Curve = CurveKeyframe | CurveEnvelope | CurveLfo

export type Value = StaticValue // TODO: add | CurveRef when curve system is implemented

// Stem types
export type Stem = v.InferOutput<typeof stemValidators.main>
export type AudioMeta = v.InferOutput<typeof stemValidators.audioMeta>
export type VideoMeta = v.InferOutput<typeof stemValidators.videoMeta>
