import type { JsonValue } from "../../base.ts";

interface BindingSettings {
  /** Existing owned or purchased market:<id> voice. Its saved version determines the model. @pattern \S */
  readonly voice?: string;
  /** Existing style of this voice, not a new reference recording. @pattern \S */
  readonly voiceStyle?: string;
  /** Explicit Cantonese is required: automatic detection does not recognize it. */
  readonly language?: "auto" | "zh" | "en-US" | "ja" | "ko" | "fr-FR" | "pt" | "de" | "es" | "yue";
  readonly deliveryMode?: "creative" | "balanced" | "stable";
  /** Prefer the text's emotion or the existing voice sample's emotion. Omission preserves the native preset. */
  readonly emotionSource?: "text" | "voice";
  /** V3 expressive delivery; availability depends on the selected voice. */
  readonly vividExpression?: boolean;
  /** Relative emotion weights. All zero delegates to the voice sample; these are not probabilities. */
  readonly emotionBlend?: {
    /** @integer @minimum 0 @maximum 10 @default 0 */
    readonly anger?: number;
    /** @integer @minimum 0 @maximum 10 @default 0 */
    readonly happiness?: number;
    /** @integer @minimum 0 @maximum 10 @default 0 */
    readonly neutral?: number;
    /** @integer @minimum 0 @maximum 10 @default 0 */
    readonly sadness?: number;
    /** @integer @minimum 0 @maximum 10 @default 0 */
    readonly contextual?: number;
  };
  /** Higher is faster. Converted to the API's reciprocal duration multiplier. @minimum 0.5 @maximum 2 */
  readonly speed?: number;
  /** -1 requests random sampling; zero is a valid fixed seed. @integer @minimum -1 @maximum 2147483647 */
  readonly randomSeed?: number;
  /** Enable native unbounded long-text mode. */
  readonly longTextMode?: boolean;
  /** Existing native post-processing chain identifier. @pattern \S */
  readonly audioProcessingProfile?: string;
  readonly model?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
  readonly timestampGranularity?: never;
}
interface Settings extends BindingSettings {
  /** @pattern \S */
  readonly voice: string;
  /** Whole text. HTTP streaming output does not accept incremental input. @pattern \S */
  readonly text: string;
  /** @default "default" @pattern \S */
  readonly voiceStyle?: string;
  /** @default "auto" */
  readonly language?: "auto" | "zh" | "en-US" | "ja" | "ko" | "fr-FR" | "pt" | "de" | "es" | "yue";
  /** @default "balanced" */
  readonly deliveryMode?: "creative" | "balanced" | "stable";
  /** @default false */
  readonly vividExpression?: boolean;
  /** @minimum 0.5 @maximum 2 @default 1 */
  readonly speed?: number;
  /** @integer @minimum -1 @maximum 2147483647 @default -1 */
  readonly randomSeed?: number;
}
interface Output {
  /** Native MP3 only; the service exposes no bitrate, sample-rate or channel selector. */
  readonly format: "mp3";
  readonly sampleRateHz?: never;
  readonly bitRateBps?: never;
  readonly channelCount?: never;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
  readonly constantBitRate?: never;
}
interface Regular {
  readonly inputType?: "text";
  readonly referenceEmphasis?: never;
}
interface Markup {
  /** Native {{...}} control markers; no invented separate instructions field. */
  readonly inputType: "markup";
  /** Only meaningful on the controllable synthesis path. */
  readonly referenceEmphasis?: "similarity" | "balanced" | "expressive";
}
interface RegularBinding extends BindingSettings, Regular {}
interface MarkupBinding extends BindingSettings, Markup {}
export type TtsBinding = RegularBinding | MarkupBinding;
interface Placeholder {
  /** Literal marker. Reserved native splitter keys cannot be used as markers. @pattern ^[\s\S]+$ */
  readonly marker: string;
}
interface RegularPlaceholder extends RegularBinding, Placeholder {}
interface MarkupPlaceholder extends MarkupBinding, Placeholder {}
interface Lookup {
  /** Entries are OR alternatives; a nested array requires all its tags. @minItems 1 */
  readonly tags: readonly (string | readonly string[])[];
}
interface RegularLookup extends RegularBinding, Lookup {}
interface MarkupLookup extends MarkupBinding, Lookup {}
interface RegularFallback extends RegularBinding {
  /** @pattern \S */
  readonly voice: string;
}
interface MarkupFallback extends MarkupBinding {
  /** @pattern \S */
  readonly voice: string;
}
interface Brackets {
  /** One UTF-16 code unit; the native bracket pair is exactly two units. @pattern ^[\s\S]$ */
  readonly open: string;
  /** @pattern ^[\s\S]$ */
  readonly close: string;
}
interface InlineSplitter {
  readonly id?: never;
  /** Ordered bindings; omitted settings inherit the native current configuration. */
  readonly placeholders?: readonly (RegularPlaceholder | MarkupPlaceholder)[];
  readonly fallback?: RegularFallback | MarkupFallback;
  readonly brackets?: readonly Brackets[];
  /** First matching entry wins. The adapter preserves this array's order. */
  readonly lookup?: readonly (RegularLookup | MarkupLookup)[];
}
interface PlaceholderSplitter extends InlineSplitter {
  /** @minItems 1 */
  readonly placeholders: readonly (RegularPlaceholder | MarkupPlaceholder)[];
}
interface FallbackSplitter extends InlineSplitter { readonly fallback: RegularFallback | MarkupFallback }
interface BracketSplitter extends InlineSplitter { readonly brackets: readonly Brackets[] }
interface SavedSplitter {
  /** Existing configuration ID; synthesize does not create or edit it. @pattern \S */
  readonly id: string;
  readonly placeholders?: never;
  readonly fallback?: never;
  readonly brackets?: never;
  readonly lookup?: never;
}
export type TextSplitter = SavedSplitter | PlaceholderSplitter | FallbackSplitter | BracketSplitter;
interface SubtitleInlineSplitter extends InlineSplitter {
  readonly placeholders?: readonly RegularPlaceholder[];
  readonly fallback?: RegularFallback;
  readonly lookup?: readonly RegularLookup[];
}
interface SubtitlePlaceholderSplitter extends SubtitleInlineSplitter {
  /** @minItems 1 */
  readonly placeholders: readonly RegularPlaceholder[];
}
interface SubtitleFallbackSplitter extends SubtitleInlineSplitter { readonly fallback: RegularFallback }
interface SubtitleBracketSplitter extends SubtitleInlineSplitter { readonly brackets: readonly Brackets[] }
interface Single {
  readonly output?: Output;
  readonly segments?: never;
  readonly textSplitter?: never;
}
interface SingleText extends Settings, Single, Regular {
  /** Flash trades quality for lower first-audio latency. @default "none" */
  readonly latencyOptimization?: "none" | "maximum";
  readonly subtitleFormat?: never;
}
interface SingleSubtitles extends Settings, Single, Regular {
  /** Native subtitle artifact, retained in completion metadata; not a normalized timing track. */
  readonly subtitleFormat: "srt";
  readonly latencyOptimization?: "none";
}
interface SingleMarkup extends Settings, Single, Markup {
  readonly subtitleFormat?: never;
  readonly latencyOptimization?: "none" | "maximum";
}
interface Segment {
  readonly kind: "speech";
  readonly output?: never;
  readonly segments?: never;
  readonly subtitleFormat?: never;
  /** Async content filtering drops flash; do not advertise it as an effective option. */
  readonly latencyOptimization?: never;
}
export interface TextSegment extends Settings, Regular, Segment {}
export interface MarkupSegment extends Settings, Markup, Segment {}
export type TtsSegment = TextSegment | MarkupSegment;

interface JobSettings {
  readonly output?: Output;
  readonly voice?: never;
  readonly voiceStyle?: never;
  readonly model?: never;
  readonly language?: never;
  readonly deliveryMode?: never;
  readonly emotionSource?: never;
  readonly vividExpression?: never;
  readonly emotionBlend?: never;
  readonly speed?: never;
  readonly randomSeed?: never;
  readonly longTextMode?: never;
  readonly audioProcessingProfile?: never;
  readonly inputType?: never;
  readonly referenceEmphasis?: never;
  readonly latencyOptimization?: never;
  readonly timestampGranularity?: never;
  readonly referenceAudio?: never;
  readonly referenceSamples?: never;
}
interface Batch extends JobSettings {
  readonly text?: never;
  readonly textSplitter?: never;
}
interface BatchAudio extends Batch {
  /** One native job, not independently synthesized and concatenated files. @minItems 1 */
  readonly segments: readonly TtsSegment[];
  readonly subtitleFormat?: never;
}
interface BatchSubtitles extends Batch {
  /** Controllable synthesis does not produce subtitles. @minItems 1 */
  readonly segments: readonly TextSegment[];
  readonly subtitleFormat: "srt";
}
interface SplitterInput extends JobSettings {
  /** Text with the placeholders expected by the saved native splitter. @pattern \S */
  readonly text: string;
  readonly output?: Output;
  readonly segments?: never;
  readonly voice?: never;
  readonly model?: never;
  readonly latencyOptimization?: never;
  readonly inputType?: never;
  readonly timestampGranularity?: never;
}
interface SplitterRequest extends SplitterInput {
  readonly textSplitter: TextSplitter;
  readonly subtitleFormat?: never;
}
interface SplitterSubtitles extends SplitterInput {
  /** Saved configurations are opaque: the server may omit SRT if they contain instruct segments. */
  readonly textSplitter: SavedSplitter | SubtitlePlaceholderSplitter | SubtitleFallbackSplitter | SubtitleBracketSplitter;
  readonly subtitleFormat: "srt";
}

export type TtsRequest = SingleText | SingleSubtitles | SingleMarkup | BatchAudio | BatchSubtitles | SplitterRequest | SplitterSubtitles;

export interface VocuDoneEvent {
  readonly event: "done";
  /** HTTP transport ended; native direct MP3 has no end-of-generation success marker. */
  readonly completion: "transport" | "generated";
  /** Exact native response data, including IDs, billing and subtitle artifacts when present. No timing shape is invented. */
  readonly metadata?: JsonValue;
  /** Native request tracing header, when present. */
  readonly requestId?: string;
}
