import { type AtprotoRefs, atprotoRefs, lexiconToValibot } from '@bigmistqke/lexicon-to-valibot'
import type * as v from 'valibot'
import projectLexicon from './app.eddy.project'
import stemLexicon from './app.eddy.stem'

// SDK format validators for parsing incoming data from PDS
const sdkOptions = { externalRefs: atprotoRefs, format: 'sdk' as const }
export const projectValidators = lexiconToValibot(projectLexicon, sdkOptions)
export const stemValidators = lexiconToValibot(stemLexicon, sdkOptions)

// Wire format validators for validating outgoing data to PDS
const wireOptions = { externalRefs: atprotoRefs, format: 'wire' as const }
export const projectWireValidators = lexiconToValibot(projectLexicon, wireOptions)
export const stemWireValidators = lexiconToValibot(stemLexicon, wireOptions)

// Types inferred from validators (satisfies preserves literal types without readonly)
export type Project = v.InferOutput<typeof projectValidators.main>
export type Canvas = v.InferOutput<typeof projectValidators.canvas>
export type Track = v.InferOutput<typeof projectValidators.track>
export type Clip = v.InferOutput<typeof projectValidators.clip>
export type ClipSourceStem = v.InferOutput<(typeof projectValidators)['clipSource.stem']>
export type ClipSourceGroup = v.InferOutput<(typeof projectValidators)['clipSource.group']>
export type ClipSource = ClipSourceStem | ClipSourceGroup
export type StaticValue = v.InferOutput<typeof projectValidators.staticValue>
export type StaticVec2 = v.InferOutput<typeof projectValidators.staticVec2>
export type StaticVec3 = v.InferOutput<typeof projectValidators.staticVec3>
export type StaticVec4 = v.InferOutput<typeof projectValidators.staticVec4>
export type StaticBlendMode = v.InferOutput<typeof projectValidators.staticBlendMode>
export type CustomParams = v.InferOutput<typeof projectValidators.customParams>
// TODO: Re-enable when curve system is implemented
// export type CurveRef = v.InferOutput<typeof projectValidators.curveRef>
export type StemRef = v.InferOutput<AtprotoRefs['com.atproto.repo.strongRef']>

// Group types
export type Group = v.InferOutput<(typeof projectValidators)['group']>
export type Member = v.InferOutput<(typeof projectValidators)['member']>
export type MemberVoid = v.InferOutput<(typeof projectValidators)['member.void']>
export type LayoutGrid = v.InferOutput<(typeof projectValidators)['layout.grid']>

export type AudioEffectGain = v.InferOutput<(typeof projectValidators)['audioEffect.gain']>
export type AudioEffectPan = v.InferOutput<(typeof projectValidators)['audioEffect.pan']>
export type AudioEffectReverb = v.InferOutput<(typeof projectValidators)['audioEffect.reverb']>
export type AudioEffectCustom = v.InferOutput<(typeof projectValidators)['audioEffect.custom']>
export type AudioEffect = AudioEffectGain | AudioEffectPan | AudioEffectReverb | AudioEffectCustom

export type VisualEffectTransform = v.InferOutput<
  (typeof projectValidators)['visualEffect.transform']
>
export type VisualEffectOpacity = v.InferOutput<(typeof projectValidators)['visualEffect.opacity']>
export type VisualEffectBrightness = v.InferOutput<
  (typeof projectValidators)['visualEffect.brightness']
>
export type VisualEffectContrast = v.InferOutput<(typeof projectValidators)['visualEffect.contrast']>
export type VisualEffectSaturation = v.InferOutput<
  (typeof projectValidators)['visualEffect.saturation']
>
export type VisualEffectColorize = v.InferOutput<(typeof projectValidators)['visualEffect.colorize']>
export type VisualEffectCustom = v.InferOutput<(typeof projectValidators)['visualEffect.custom']>
export type VisualEffect =
  | VisualEffectTransform
  | VisualEffectOpacity
  | VisualEffectBrightness
  | VisualEffectContrast
  | VisualEffectSaturation
  | VisualEffectColorize
  | VisualEffectCustom

export type CurveKeyframe = v.InferOutput<(typeof projectValidators)['curve.keyframe']>
export type CurveEnvelope = v.InferOutput<(typeof projectValidators)['curve.envelope']>
export type CurveLfo = v.InferOutput<(typeof projectValidators)['curve.lfo']>
export type Curve = CurveKeyframe | CurveEnvelope | CurveLfo

export type Value = StaticValue // TODO: add | CurveRef when curve system is implemented

export type Stem = v.InferOutput<typeof stemValidators.main>
export type AudioMeta = v.InferOutput<typeof stemValidators.audioMeta>
export type VideoMeta = v.InferOutput<typeof stemValidators.videoMeta>
