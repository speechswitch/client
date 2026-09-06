/** Finite JSON data; adapters never stringify unsupported values into silent omissions. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Provider-neutral audio output fields. */
export type TtsOutput = {
  /** Audio format or container. */
  readonly format: "mp3" | "ogg_vorbis" | "wav" | "pcm" | "ogg_opus" | "alaw" | "mulaw" | "flac" | "aac" | "opus" | "webm_opus" | "truesilk" | "amr_wb" | "g722" | "ogg";
  /** Requested audio sample rate. */
  readonly sampleRateHz?: number;
  /** Requested encoded audio bit rate. */
  readonly bitRateBps?: number;
  /** Number of output audio channels. */
  readonly channelCount?: number;
  /** Require constant-bitrate encoding when supported. */
  readonly constantBitRate?: boolean;
  /** Representation of samples within PCM or a container such as WAV. */
  readonly sampleEncoding?: "signed_integer_16" | "signed_integer_32" | "float_32" | "mulaw" | "alaw";
  /** Byte order of each uncompressed sample. */
  readonly byteOrder?: "little_endian" | "big_endian";
};

/** Provider-neutral TTS request fields. */
export interface TtsClearCommand {
  readonly command: "clear";
}

export interface TtsFlushCommand {
  readonly command: "flush";
}

export interface TtsUpdateCommand {
  readonly command: "update";
  readonly voice?: string;
  readonly voiceStyle?: string;
  readonly speedBias?: number;
  readonly pitchBias?: number;
  readonly textBufferThreshold?: number;
  readonly maxBufferDelayMs?: number;
  /** Replace session pronunciation substitutions; an empty array removes them. */
  readonly replacements?: readonly { readonly pattern: string; readonly replacement: string }[];
  /** Change session generation settings; the provider determines when they take effect. */
  readonly voiceGuidance?: number;
  readonly temperature?: number;
  readonly maxAudioTokens?: number;
  readonly language?: string;
  readonly textNormalization?: boolean;
  readonly speed?: number;
}

export type TtsRequest = {
  /** Text to synthesize, supplied whole or incrementally when the provider supports streaming input. */
  readonly text?: string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand>;
  /** Provider voice identifier. */
  readonly voice?: string | number;
  /** Blend existing voices using relative weights instead of selecting one voice. */
  readonly voiceBlend?: readonly { readonly voice: string; readonly weight: number }[];
  /** Select a saved voice by name instead of identifier. */
  readonly voiceName?: string;
  /** Saved delivery style identifier belonging to the selected voice. */
  readonly voiceStyle?: string;
  /** Namespace of an existing voice, independent of selecting it by ID or name. */
  readonly voiceSource?: "catalog" | "custom";
  /** Design a voice from a description, rather than directing an existing voice's delivery. */
  readonly voiceDescription?: string;
  /** Reference audio used for voice conditioning, independent of an existing voice identifier. */
  readonly referenceAudio?: Uint8Array;
  /** Voice-conditioning recordings paired with their exact transcripts. */
  readonly referenceSamples?: readonly { readonly audio: Uint8Array; readonly text: string }[];
  /** Indexed speakers for dialogue, each with an existing voice and/or reference recordings. */
  readonly speakers?: readonly {
    /** Name used to identify this speaker in dialogue text or turns. */
    readonly alias?: string;
    readonly voice?: string;
    readonly voiceName?: string;
    readonly voiceSource?: "catalog" | "custom";
    readonly referenceSamples?: readonly { readonly audio: Uint8Array; readonly text: string }[];
  }[];
  /** Dialogue turns, supplied whole or incrementally when supported. */
  readonly turns?: readonly { readonly speaker: string; readonly text: string; readonly instructions?: string; readonly speed?: number; readonly trailingSilenceMs?: number }[]
    | AsyncIterable<{ readonly speaker: string; readonly text: string; readonly instructions?: string; readonly speed?: number; readonly trailingSilenceMs?: number } | TtsFlushCommand>;
  /** Natural-language guidance for the spoken delivery. */
  readonly instructions?: string;
  /** Category-specific content filtering. */
  readonly safetySettings?: readonly {
    readonly category: "hate_speech" | "dangerous_content" | "harassment" | "sexually_explicit";
    readonly threshold: "low" | "medium" | "high" | "none" | "off";
  }[];
  /** Reference performance identifier used to guide delivery independently of voice identity. */
  readonly deliveryReference?: string;
  /** Interpretation of the input text. */
  readonly inputType?: "text" | "ssml" | "markup";
  /** Provider synthesis model or engine. */
  readonly model?: string;
  /** Provider-side metadata attached to the synthesis request. */
  readonly metadata?: { readonly [key: string]: JsonValue };
  /** Cache affinity hint for repeated synthesis prompts. */
  readonly promptCacheKey?: string;
  /** Opt this request out of the provider's model-improvement program. May affect pricing. */
  readonly modelImprovementOptOut?: boolean;
  /** Usage-reporting labels attached to this request. */
  readonly tags?: readonly string[];
  /** Language or locale used for synthesis. */
  readonly language?: string;
  /** Pronunciation lexicon name or names. */
  readonly lexicon?: string | readonly string[];
  /** Requested audio representation. */
  readonly output?: TtsOutput;
  /** Speech speed multiplier. */
  readonly speed?: number;
  /** Native speaking-rate bias: zero is neutral and positive is faster; not a multiplier. */
  readonly speedBias?: number;
  /** Allow the provider to retain a generated audio file; false requests inline audio without file retention. */
  readonly audioRetention?: boolean;
  /** Silence appended after an utterance, in milliseconds. */
  readonly trailingSilenceMs?: number;
  /** Allow the provider to split input turns into smaller natural speech segments. */
  readonly splitTurns?: boolean;
  /** Delivery pacing bias: zero is neutral, negative is faster, positive is slower. Not a speed multiplier. */
  readonly pacingBias?: number;
  /** Strength of voice-conditioning guidance, on the provider's scale. */
  readonly voiceGuidance?: number;
  /** Target synthesized duration in milliseconds; some providers exclude a simultaneous speed multiplier. */
  readonly targetDurationMs?: number;
  /** Variation within the generated delivery, from 0 to 1. */
  readonly deliveryVariance?: number;
  /** Sampling temperature; supported bounds depend on the provider. */
  readonly temperature?: number;
  /** Discrete delivery policy balancing consistency and expressive variation. */
  readonly deliveryMode?: "stable" | "balanced" | "creative";
  /** Nucleus sampling probability mass, from 0 to 1. */
  readonly topP?: number;
  /** Maximum number of token candidates considered during sampling. */
  readonly topK?: number;
  /** Output gain adjustment in decibels, independent of linear volume scaling. */
  readonly volumeDb?: number;
  /** Pitch adjustment in semitones. */
  readonly pitchSemitones?: number;
  /** Pitch adjustment on the provider's scale, when not specified in semitones. */
  readonly pitchBias?: number;
  /** Interpret mathematical expressions in the specified notation. */
  readonly formulaReading?: "latex";
  /** Post-synthesis voice coloration and acoustic effects, independent of speaking pitch. */
  readonly voiceTransform?: {
    readonly brightness?: number;
    readonly softness?: number;
    readonly crispness?: number;
    readonly effect?: "spacious_echo" | "auditorium_echo" | "telephone" | "robotic";
  };
  /** Ordered audio processing profiles for the target playback device. */
  readonly effectsProfiles?: readonly string[];
  /** Normalize output loudness independently of the requested gain. */
  readonly loudnessNormalization?: boolean;
  /** Maximum audio tokens generated per text chunk. */
  readonly maxAudioTokens?: number;
  /** Penalty for repeating audio patterns. */
  readonly repetitionPenalty?: number;
  /** Target number of text characters per synthesis chunk. */
  readonly textChunkLength?: number;
  /** Minimum characters before splitting a new synthesis chunk. */
  readonly minTextChunkLength?: number;
  /** Use previous generated audio as conditioning for subsequent chunks. */
  readonly conditionOnPreviousChunks?: boolean;
  /** Generation early-stopping threshold, from 0 to 1. */
  readonly earlyStopThreshold?: number;
  /** Provider feature flags enabled for this synthesis request. */
  readonly features?: readonly string[];
  /** Seed used by providers that support deterministic sampling. */
  readonly randomSeed?: number;
  /** Strengthen the influence of the voice prompt on generated speech. */
  readonly voiceBoost?: boolean;
  /** How closely generated speech should resemble the source voice, from 0 to 1. */
  readonly voiceSimilarity?: number;
  /** Exaggeration of the source voice's speaking style, from 0 to 1. */
  readonly styleExaggeration?: number;
  /** Ordered pronunciation dictionary references, with optional pinned versions. */
  readonly pronunciationDictionaries?: readonly { readonly id: string; readonly versionId?: string }[];
  /** Select dictionaries within a scope; omitted IDs use its active defaults, while an empty list disables them. */
  readonly pronunciationDictionarySelection?: { readonly scope: string | number; readonly ids?: readonly (string | number)[] };
  /** Text or previous generation identifiers providing preceding speech context. */
  readonly contextBefore?: { readonly text?: string; readonly texts?: readonly string[]; readonly requestIds?: readonly string[]; readonly turns?: readonly { readonly speaker: string; readonly text: string; readonly instructions?: string; readonly speed?: number; readonly trailingSilenceMs?: number }[] };
  /** Text or generation identifiers providing following speech context. */
  readonly contextAfter?: { readonly text?: string; readonly requestIds?: readonly string[] };
  /** Apply a language-specific normalization pass independently of general normalization. */
  readonly languageTextNormalization?: boolean;
  /** Buffer incremental text before synthesis. */
  readonly textBuffering?: boolean;
  /** Successive character-count thresholds for incremental text buffering. */
  readonly textBufferThresholds?: readonly number[];
  /** Character-count threshold that triggers synthesis of buffered input. */
  readonly textBufferThreshold?: number;
  /** Let the provider adapt text flushing for low latency and speech quality. */
  readonly automaticTextFlushing?: boolean;
  /** Enable extended duration stretching of generated speech. */
  readonly durationStretching?: boolean;
  /** Scheduling priority, independent of synthesis quality/latency tradeoffs. */
  readonly processingPriority?: "standard" | "realtime";
  /** Automatically adjust output gain levels. */
  readonly automaticGainControl?: boolean;
  /** Speaker gender used for language-specific synthesis decisions. */
  readonly speakerGender?: "male" | "female";
  /** Blend a base accent with a target accent; the ratio is 0 for the base and 1 for the target. */
  readonly accentBlend?: {
    readonly baseLocale: string;
    readonly targetLocale: string;
    readonly ratio: number;
  };
  /** Timing detail requested alongside audio; an array selects multiple supported kinds. */
  readonly timestampGranularity?: "character" | "word" | "phoneme" | "segment" | "sentence" | "viseme" | "ssml" | readonly ("word" | "phoneme" | "sentence" | "viseme" | "ssml")[];
  /** Deliver alignment with its audio chunk, or later on an independent timeline. */
  readonly timestampDelivery?: "chunk" | "trailing";
  /** Voice consistency, from 0 (more expressive) to 1 (more stable). */
  readonly stability?: number;
  /** Output volume multiplier. */
  readonly volumeScale?: number;
  /** Requested emotional delivery. */
  readonly emotion?: string;
  /** Accent to use independently of the synthesis language. */
  readonly accent?: string;
  /** Maximum provider text-buffering delay before generation begins. */
  readonly maxBufferDelayMs?: number;
  /** Whether timestamps describe the original or normalized spoken text. */
  readonly timestampText?: "original" | "normalized";
  /** Apply provider audio cleanup and loudness enhancement to generated output. */
  readonly audioEnhancement?: boolean;
  /** Improve pronunciation of names, brands, and other named entities. */
  readonly namedEntityPronunciationEnhancement?: boolean;
  /** Clean up the source recording behind the selected voice. */
  readonly referenceAudioEnhancement?: boolean;
  /** Preserve the source voice's accent in generated speech. */
  readonly accentPreservation?: boolean;
  /** Idle time before flushing buffered text; some providers may flush complete sentences sooner. */
  readonly textFlushDelayMs?: number;
  /** Number of inference steps used to generate speech. */
  readonly inferenceSteps?: number;
  /** Whether incremental text waits for sentence boundaries or is synthesized immediately. */
  readonly segmentation?: "sentence" | "immediate";
  /** Whether written text is normalized to spoken form before synthesis. */
  readonly textNormalization?: boolean | "auto" | { readonly locale?: string; readonly rules?: readonly string[] };
  /** Phrase-to-pronunciation substitutions. */
  readonly replacements?: readonly {
    readonly pattern: string;
    readonly replacement: string;
    /** Phonetic representation of the replacement, when required by the provider. */
    readonly alphabet?: "ipa" | "x_sampa" | "japanese_yomigana" | "pinyin";
  }[];
  /** Degree to which synthesis quality may be traded for lower first-audio latency. */
  readonly latencyOptimization?: "none" | "moderate" | "strong" | "aggressive" | "maximum";
};
