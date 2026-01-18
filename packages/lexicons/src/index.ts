import { type AtprotoRefs, atprotoRefs, lexiconToValibot } from '@bigmistqke/lexicon-to-valibot'
import type * as v from 'valibot'
import audioEffectLexicon from './app.eddy.audioEffect'
import projectLexicon from './app.eddy.project'
import stemLexicon from './app.eddy.stem'
import visualEffectLexicon from './app.eddy.visualEffect'

// Step 1: Build project validators first (for shared types like staticValue)
const projectBaseRefs = lexiconToValibot(projectLexicon, { externalRefs: atprotoRefs, format: 'sdk' as const })

// Step 2: Build external refs with project types for effect lexicons
const projectTypeRefs = {
  ...atprotoRefs,
  'app.eddy.project#staticValue': projectBaseRefs.staticValue,
  'app.eddy.project#staticVec2': projectBaseRefs.staticVec2,
  'app.eddy.project#staticVec3': projectBaseRefs.staticVec3,
  'app.eddy.project#staticVec4': projectBaseRefs.staticVec4,
  'app.eddy.project#staticBlendMode': projectBaseRefs.staticBlendMode,
  'app.eddy.project#customParams': projectBaseRefs.customParams,
}

// Step 3: Build effect validators using project type refs
const audioEffectRefs = lexiconToValibot(audioEffectLexicon, { externalRefs: projectTypeRefs, format: 'sdk' as const })
const visualEffectRefs = lexiconToValibot(visualEffectLexicon, { externalRefs: projectTypeRefs, format: 'sdk' as const })

// Step 4: Build full external refs including effect validators
const fullExternalRefs = {
  ...projectTypeRefs,
  'app.eddy.audioEffect#gain': audioEffectRefs.gain,
  'app.eddy.audioEffect#pan': audioEffectRefs.pan,
  'app.eddy.audioEffect#reverb': audioEffectRefs.reverb,
  'app.eddy.audioEffect#custom': audioEffectRefs.custom,
  'app.eddy.visualEffect#transform': visualEffectRefs.transform,
  'app.eddy.visualEffect#opacity': visualEffectRefs.opacity,
  'app.eddy.visualEffect#brightness': visualEffectRefs.brightness,
  'app.eddy.visualEffect#contrast': visualEffectRefs.contrast,
  'app.eddy.visualEffect#saturation': visualEffectRefs.saturation,
  'app.eddy.visualEffect#colorize': visualEffectRefs.colorize,
  'app.eddy.visualEffect#custom': visualEffectRefs.custom,
}

// Step 5: Rebuild project validators with full refs (for audioPipeline/videoPipeline)
const sdkOptions = { externalRefs: fullExternalRefs, format: 'sdk' as const }
export const projectValidators = lexiconToValibot(projectLexicon, sdkOptions)
export const stemValidators = lexiconToValibot(stemLexicon, sdkOptions)
export const audioEffectValidators = audioEffectRefs
export const visualEffectValidators = visualEffectRefs

// Wire format validators for validating outgoing data to PDS
const wireOptions = { externalRefs: fullExternalRefs, format: 'wire' as const }
export const projectWireValidators = lexiconToValibot(projectLexicon, wireOptions)
export const stemWireValidators = lexiconToValibot(stemLexicon, wireOptions)
export const audioEffectWireValidators = lexiconToValibot(audioEffectLexicon, wireOptions)
export const visualEffectWireValidators = lexiconToValibot(visualEffectLexicon, wireOptions)

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
