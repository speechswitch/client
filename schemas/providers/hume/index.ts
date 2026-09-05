interface Output {
  readonly format: "mp3" | "pcm" | "wav";
  // Hume's synthesis contract does not offer output rate/encoding controls.
  readonly sampleRateHz?: never;
  readonly bitRateBps?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Delivery {
  /** Extreme values outside 0.75–1.5 may be unstable. @minimum 0.25 @maximum 3 */
  readonly speed?: number;
  /** @minimum 0 @maximum 5000 */
  readonly trailingSilenceMs?: number;
}
interface VoiceId {
  /** Existing voice ID, including saved custom voices. @pattern ^[\s\S]+$ */
  readonly voice: string;
  readonly voiceName?: never;
  /** Voice-library entries require catalog; private saved voices use custom. @default "custom" */
  readonly voiceSource?: "catalog" | "custom";
  readonly voiceDescription?: never;
}
interface VoiceName {
  readonly voice?: never;
  /** @pattern ^[\s\S]+$ */
  readonly voiceName: string;
  /** @default "custom" */
  readonly voiceSource?: "catalog" | "custom";
  readonly voiceDescription?: never;
}
interface DesignedVoice {
  readonly voice?: never;
  readonly voiceName?: never;
  readonly voiceSource?: never;
  /** Novel voice design is supported by Octave 1, with instant mode disabled. @pattern ^[\s\S]{1,1000}$ */
  readonly voiceDescription?: string;
}
interface SpeakerId extends VoiceId { readonly alias: string }
interface SpeakerName extends VoiceName { readonly alias: string }
interface Turn extends Delivery {
  readonly speaker: string;
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
  readonly instructions?: never;
}
interface DirectedTurn extends Delivery {
  readonly speaker: string;
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
  /** Concise acting directions work best. Octave 1 only. @pattern ^[\s\S]{0,1000}$ */
  readonly instructions?: string;
}
interface Settings extends Delivery {
  /** @minimum 0.25 @maximum 3 @default 1 */
  readonly speed?: number;
  /** @minimum 0 @maximum 5000 @default 0 */
  readonly trailingSilenceMs?: number;
  readonly output: Output;
  /** Experimental; omission uses Hume's model- and voice-dependent default. @minimum 0.1 @maximum 1 */
  readonly temperature?: number;
  /** Defaults to instant mode for saved voices; novel voice design disables it. */
  readonly latencyOptimization?: "none" | "aggressive";
  /** @default true */
  readonly splitTurns?: boolean;
}
interface TextContext {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
  readonly requestIds?: never;
  readonly turns?: never;
}
interface Single extends Settings {
  readonly text: string | AsyncIterable<string | { readonly command: "flush" }>;
  readonly turns?: never;
  readonly speakers?: never;
  /** Text context uses HTTP; exactly one prior generation ID also supports WebSocket. */
  readonly contextBefore?: TextContext
    | { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave1 extends Single {
  readonly model: "octave-1";
  /** Octave 2 does not yet support acting directions. @pattern ^[\s\S]{0,1000}$ */
  readonly instructions?: string;
  readonly timestampGranularity?: never;
}
interface Octave1Id extends Octave1, VoiceId {}
interface Octave1Name extends Octave1, VoiceName {}
interface Octave1Design extends Single, DesignedVoice {
  readonly model: "octave-1";
  readonly instructions?: never;
  readonly timestampGranularity?: never;
  readonly latencyOptimization?: "none";
}
interface Octave2 extends Single {
  readonly model: "octave-2";
  readonly instructions?: never;
  readonly timestampGranularity?: "word" | "phoneme" | readonly ("word" | "phoneme")[];
}
interface Octave2Id extends Octave2, VoiceId {}
interface Octave2Name extends Octave2, VoiceName {}
interface Dialogue extends Settings {
  readonly text?: never;
  readonly voice?: never;
  readonly voiceName?: never;
  readonly voiceSource?: never;
  readonly voiceDescription?: never;
  readonly instructions?: never;
}
interface Octave1Dialogue extends Dialogue {
  readonly model: "octave-1";
  readonly speakers: readonly (SpeakerId | SpeakerName)[];
  readonly turns: readonly DirectedTurn[] | AsyncIterable<DirectedTurn | { readonly command: "flush" }>;
  readonly timestampGranularity?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never }
    | { readonly text?: never; readonly requestIds?: never; readonly turns: readonly DirectedTurn[] };
}
interface Octave2Dialogue extends Dialogue {
  readonly model: "octave-2";
  readonly speakers: readonly (SpeakerId | SpeakerName)[];
  readonly turns: readonly Turn[] | AsyncIterable<Turn | { readonly command: "flush" }>;
  readonly timestampGranularity?: "word" | "phoneme" | readonly ("word" | "phoneme")[];
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never }
    | { readonly text?: never; readonly requestIds?: never; readonly turns: readonly Turn[] };
}

interface Octave1IdStatic extends Octave1Id {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
}
interface Octave1NameStatic extends Octave1Name {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
}
interface Octave1DesignStatic extends Octave1Design {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
}
interface Octave2IdStatic extends Octave2Id {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
}
interface Octave2NameStatic extends Octave2Name {
  /** @pattern ^[\s\S]{0,5000}$ */
  readonly text: string;
}
// Repeat the narrower transport fields explicitly: authored provider types stay
// plain, and specgen verifies these combinations against the shared concepts.
interface Octave1IdStream extends Octave1Id {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave1NameStream extends Octave1Name {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave1DesignStream extends Octave1Design {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave2IdStream extends Octave2Id {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave2NameStream extends Octave2Name {
  readonly text: AsyncIterable<string | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave1DialogueStatic extends Octave1Dialogue { readonly turns: readonly DirectedTurn[] }
interface Octave2DialogueStatic extends Octave2Dialogue { readonly turns: readonly Turn[] }
interface Octave1DialogueStream extends Octave1Dialogue {
  readonly turns: AsyncIterable<DirectedTurn | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}
interface Octave2DialogueStream extends Octave2Dialogue {
  readonly turns: AsyncIterable<Turn | { readonly command: "flush" }>;
  readonly splitTurns?: never;
  readonly contextBefore?: { readonly text?: never; readonly requestIds: readonly string[]; readonly turns?: never };
}

export type TtsRequest = Octave1IdStatic | Octave1NameStatic | Octave1DesignStatic | Octave2IdStatic | Octave2NameStatic
  | Octave1IdStream | Octave1NameStream | Octave1DesignStream | Octave2IdStream | Octave2NameStream
  | Octave1DialogueStatic | Octave2DialogueStatic
  | Octave1DialogueStream | Octave2DialogueStream;
