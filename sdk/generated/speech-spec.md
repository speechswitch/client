# Normalized speech API



## TTS request

### `accent`

Accent to use independently of the synthesis language.

Type: `string | undefined` (optional).

### `accentBlend`

Blend a base accent with a target accent; the ratio is 0 for the base and 1 for the target.

Type: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined` (optional).

### `accentPreservation`

Preserve the source voice's accent in generated speech.

Type: `boolean | undefined` (optional).

### `apiVersion`

Provider API generation when it changes the available request capabilities.

Type: `string | undefined` (optional).

### `audioDelivery`

Deliver audio immediately as generated, or pace byte emission for playback.

Type: `"immediate" | "paced" | undefined` (optional).

### `audioEnhancement`

Apply provider audio cleanup and loudness enhancement to generated output.

Type: `boolean | undefined` (optional).

### `audioProcessingProfile`

Existing audio post-processing chain identifier.

Type: `string | undefined` (optional).

### `audioRetention`

Allow the provider to retain a generated audio file; false requests inline audio without file retention.

Type: `boolean | undefined` (optional).

### `automaticGainControl`

Automatically adjust output gain levels.

Type: `boolean | undefined` (optional).

### `automaticTextFlushing`

Let the provider adapt text flushing for low latency and speech quality.

Type: `boolean | undefined` (optional).

### `completionDelayMs`

Provider grace period after the last generated chunk before completion.

Type: `number | undefined` (optional).

### `conditionOnPreviousChunks`

Use previous generated audio as conditioning for subsequent chunks.

Type: `boolean | undefined` (optional).

### `contentRetentionDays`

Opt into provider content deletion after this many days; not zero-retention.

Type: `number | undefined` (optional).

### `contextAfter`

Text or generation identifiers providing following speech context.

Type: `{ readonly text?: string | undefined; readonly requestIds?: readonly string[] | undefined; } | undefined` (optional).

### `contextBefore`

Text or previous generation identifiers providing preceding speech context.

Type: `{ readonly text?: string | undefined; readonly texts?: readonly string[] | undefined; readonly requestIds?: readonly string[] | undefined; readonly turns?: readonly { readonly speaker: string; readonly text: string; readonly instructions?: string | undefined; readonly speed?: number | undefined; readonly trailingSil...` (optional).

### `continuation`

Carry synthesis state across incremental fragments in one named context. Completion semantics are provider-specific.

Type: `{ readonly id: string; readonly maxBufferDelayMs?: number | undefined; } | undefined` (optional).

### `deliveryMode`

Discrete delivery policy balancing consistency and expressive variation.

Type: `"balanced" | "creative" | "stable" | undefined` (optional).

### `deliveryReference`

Reference performance identifier used to guide delivery independently of voice identity.

Type: `string | undefined` (optional).

### `deliveryVariance`

Variation within the generated delivery, from 0 to 1.

Type: `number | undefined` (optional).

### `durationStretching`

Enable extended duration stretching of generated speech.

Type: `boolean | undefined` (optional).

### `earlyStopThreshold`

Generation early-stopping threshold, from 0 to 1.

Type: `number | undefined` (optional).

### `effectsProfiles`

Ordered audio processing profiles for the target playback device.

Type: `readonly string[] | undefined` (optional).

### `emotion`

Requested emotional delivery.

Type: `string | undefined` (optional).

### `emotionBlend`

Relative emotional tendencies on the provider's scale, not normalized probabilities.

Type: `{ readonly anger?: number | undefined; readonly happiness?: number | undefined; readonly neutral?: number | undefined; readonly sadness?: number | undefined; readonly contextual?: number | undefined; } | undefined` (optional).

### `emotionIntensity`

Strength of emotional expression on the provider's scale.

Type: `number | undefined` (optional).

### `emotionSource`

Prefer contextual text emotion or the selected voice sample's emotion.

Type: `"text" | "voice" | undefined` (optional).

### `features`

Provider feature flags enabled for this synthesis request.

Type: `readonly string[] | undefined` (optional).

### `formulaReading`

Interpret mathematical expressions in the specified notation.

Type: `"latex" | "plain_text" | false | undefined` (optional).

### `frequencyPenalty`

Penalize audio tokens according to how frequently they have occurred.

Type: `number | undefined` (optional).

### `includeUsage`

Request native usage accounting when it requires an alternate response mode.

Type: `boolean | undefined` (optional).

### `inferenceSteps`

Number of inference steps used to generate speech.

Type: `number | undefined` (optional).

### `inputType`

Interpretation of the input text.

Type: `"markup" | "ssml" | "text" | undefined` (optional).

### `instructions`

Natural-language guidance for the spoken delivery.

Type: `string | undefined` (optional).

### `language`

Language or locale used for synthesis.

Type: `string | undefined` (optional).

### `languageTextNormalization`

Apply a language-specific normalization pass independently of general normalization.

Type: `boolean | undefined` (optional).

### `latencyOptimization`

Degree to which synthesis quality may be traded for lower first-audio latency.

Type: `"aggressive" | "maximum" | "moderate" | "none" | "strong" | undefined` (optional).

### `lexicon`

Pronunciation lexicon name or names.

Type: `string | readonly string[] | undefined` (optional).

### `longTextMode`

Enable a provider's extended long-text generation mode.

Type: `boolean | undefined` (optional).

### `loudnessNormalization`

Normalize output loudness independently of the requested gain.

Type: `boolean | undefined` (optional).

### `maxAudioTokens`

Maximum audio tokens generated per text chunk.

Type: `number | undefined` (optional).

### `maxBufferDelayMs`

Maximum provider text-buffering delay before generation begins.

Type: `number | undefined` (optional).

### `metadata`

Provider-side metadata attached to the synthesis request.

Type: `{ readonly [key: string]: JsonValue; } | undefined` (optional).

### `minP`

Minimum token probability relative to the most likely token, from 0 to 1.

Type: `number | undefined` (optional).

### `minTextChunkLength`

Minimum characters before splitting a new synthesis chunk.

Type: `number | undefined` (optional).

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `modelImprovementOptOut`

Opt this request out of the provider's model-improvement program. May affect pricing.

Type: `boolean | undefined` (optional).

### `namedEntityPronunciationEnhancement`

Improve pronunciation of names, brands, and other named entities.

Type: `boolean | undefined` (optional).

### `numberPronunciationLanguage`

Language for reading numbers independently of the synthesis language.

Type: `string | undefined` (optional).

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `pacingBias`

Delivery pacing bias: zero is neutral, negative is faster, positive is slower. Not a speed multiplier.

Type: `number | undefined` (optional).

### `pitchBias`

Pitch adjustment on the provider's scale, when not specified in semitones.

Type: `number | undefined` (optional).

### `pitchSemitones`

Pitch adjustment in semitones.

Type: `number | undefined` (optional).

### `presencePenalty`

Penalize audio tokens that have already occurred, independently of frequency.

Type: `number | undefined` (optional).

### `processingPriority`

Scheduling priority, independent of synthesis quality/latency tradeoffs.

Type: `"realtime" | "standard" | undefined` (optional).

### `promptCacheKey`

Cache affinity hint for repeated synthesis prompts.

Type: `string | undefined` (optional).

### `pronunciationDictionaries`

Ordered pronunciation dictionary references, with optional pinned versions.

Type: `readonly { readonly id: string; readonly versionId?: string | undefined; readonly version?: number | undefined; }[] | undefined` (optional).

### `pronunciationDictionarySelection`

Select dictionaries within a scope; omitted IDs use its active defaults, while an empty list disables them.

Type: `{ readonly scope: string | number; readonly ids?: readonly (string | number)[] | undefined; } | undefined` (optional).

### `randomSeed`

Seed used by providers that support deterministic sampling.

Type: `number | undefined` (optional).

### `referenceAudio`

Reference audio used for voice conditioning, independent of an existing voice identifier.

Type: `Uint8Array<ArrayBufferLike> | undefined` (optional).

### `referenceAudioEnhancement`

Clean up the source recording behind the selected voice.

Type: `boolean | undefined` (optional).

### `referenceAudioTrimming`

Trim non-speech portions from reference audio before voice conditioning.

Type: `boolean | undefined` (optional).

### `referenceEmphasis`

Balance reference similarity against expressive variation in controllable synthesis.

Type: `"balanced" | "expressive" | "similarity" | undefined` (optional).

### `referenceSamples`

Voice-conditioning recordings paired with their exact transcripts.

Type: `readonly { readonly audio: Uint8Array<ArrayBufferLike>; readonly text: string; }[] | undefined` (optional).

### `repetitionPenalty`

Penalty for repeating audio patterns.

Type: `number | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: "ipa" | "japanese_yomigana" | "pinyin" | "x_sampa" | undefined; }[] | undefined` (optional).

### `requestId`

Caller-supplied request correlation label, not a provider-generated identifier.

Type: `string | undefined` (optional).

### `safetySettings`

Category-specific content filtering.

Type: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined` (optional).

### `segmentation`

Whether incremental text waits for sentence boundaries or is synthesized immediately.

Type: `"immediate" | "manual" | "sentence" | undefined` (optional).

### `segments`

Ordered speech and silence in one composed output; provider types enforce valid segment shapes.

Type: `readonly { readonly kind: "pause" | "speech"; readonly text?: string | undefined; readonly pauseMs?: number | undefined; readonly voice?: string | undefined; readonly model?: string | undefined; ... 18 more ...; readonly referenceEmphasis?: "balanced" | ... 2 more ... | undefined; }[] | undefined` (optional).

### `sessionId`

Caller-supplied session correlation label, not a provider-generated identifier.

Type: `string | undefined` (optional).

### `speakerGender`

Speaker gender used for language-specific synthesis decisions.

Type: `"female" | "male" | undefined` (optional).

### `speakers`

Indexed speakers for dialogue, each with an existing voice and/or reference recordings.

Type: `readonly { readonly alias?: string | undefined; readonly voice?: string | undefined; readonly voiceName?: string | undefined; readonly voiceSource?: "catalog" | "custom" | undefined; readonly referenceSamples?: readonly { ...; }[] | undefined; }[] | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `speedBias`

Native speaking-rate bias: zero is neutral and positive is faster; not a multiplier.

Type: `number | undefined` (optional).

### `splitTurns`

Allow the provider to split input turns into smaller natural speech segments.

Type: `boolean | undefined` (optional).

### `stability`

Voice consistency, from 0 (more expressive) to 1 (more stable).

Type: `number | undefined` (optional).

### `styleExaggeration`

Exaggeration of the source voice's speaking style, on the provider's scale.

Type: `number | undefined` (optional).

### `subtitleFormat`

Request a native subtitle artifact, independently of normalized timestamp tracks.

Type: `"srt" | undefined` (optional).

### `tags`

Usage-reporting labels attached to this request.

Type: `readonly string[] | undefined` (optional).

### `targetDurationMs`

Target synthesized duration in milliseconds; some providers exclude a simultaneous speed multiplier.

Type: `number | undefined` (optional).

### `targetLoudnessLufs`

Requested absolute loudness in LUFS, independent of relative volume scaling.

Type: `number | undefined` (optional).

### `temperature`

Sampling temperature; supported bounds depend on the provider.

Type: `number | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand> | undefined` (optional).

### `textBuffering`

Buffer incremental text before synthesis.

Type: `boolean | undefined` (optional).

### `textBufferThreshold`

Character-count threshold that triggers synthesis of buffered input.

Type: `number | undefined` (optional).

### `textBufferThresholds`

Successive character-count thresholds for incremental text buffering.

Type: `readonly number[] | undefined` (optional).

### `textChunkLength`

Target number of text characters per synthesis chunk.

Type: `number | undefined` (optional).

### `textFlushDelayMs`

Idle time before flushing buffered text; some providers may flush complete sentences sooner.

Type: `number | undefined` (optional).

### `textMarkup`

Opt into native inline text syntax; these controls are independent of general text normalization.

Type: `{ readonly pauses?: boolean | undefined; readonly phonemes?: boolean | undefined; readonly speeds?: readonly number[] | undefined; } | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `"auto" | boolean | { readonly locale?: string | undefined; readonly rules?: readonly string[] | undefined; } | undefined` (optional).

### `textSplitter`

Text splitting and voice binding, supplied inline or by saved identifier. Provider types enforce the valid configurations.

Type: `{ readonly id?: string | undefined; readonly placeholders?: readonly TextSplitPlaceholder[] | undefined; readonly fallback?: TextSplitBinding | undefined; readonly brackets?: readonly { ...; }[] | undefined; readonly lookup?: readonly TextSplitLookup[] | undefined; } | undefined` (optional).

### `timestampDelivery`

Deliver alignment with its audio chunk, or later on an independent timeline.

Type: `"chunk" | "trailing" | undefined` (optional).

### `timestampGranularity`

Timing detail requested alongside audio; an array selects multiple supported kinds.

Type: `"character" | "phoneme" | "segment" | "sentence" | "ssml" | "viseme" | "word" | readonly ("character" | "phoneme" | "sentence" | "ssml" | "viseme" | "word")[] | undefined` (optional).

### `timestampText`

Whether timestamps describe the original or normalized spoken text.

Type: `"normalized" | "original" | undefined` (optional).

### `topK`

Maximum number of token candidates considered during sampling.

Type: `number | undefined` (optional).

### `topP`

Nucleus sampling probability mass, from 0 to 1.

Type: `number | undefined` (optional).

### `trailingSilenceMs`

Silence appended after an utterance, in milliseconds.

Type: `number | undefined` (optional).

### `turns`

Dialogue turns, supplied whole or incrementally when supported.

Type: `AsyncIterable<TtsFlushCommand | { readonly speaker: string; readonly text: string; readonly instructions?: string | undefined; readonly speed?: number | undefined; readonly trailingSilenceMs?: number | undefined; }> | readonly { ...; }[] | undefined` (optional).

### `vividExpression`

Enable the provider's more expressive delivery mode.

Type: `boolean | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | number | undefined` (optional).

### `voiceBlend`

Blend existing voices using relative weights instead of selecting one voice.

Type: `readonly { readonly voice: string; readonly weight: number; }[] | undefined` (optional).

### `voiceBoost`

Strengthen the influence of the voice prompt on generated speech.

Type: `boolean | undefined` (optional).

### `voiceDescription`

Design a voice from a description, rather than directing an existing voice's delivery.

Type: `string | undefined` (optional).

### `voiceGuidance`

Strength of voice-conditioning guidance, on the provider's scale.

Type: `number | undefined` (optional).

### `voiceName`

Select a saved voice by name instead of identifier.

Type: `string | undefined` (optional).

### `voiceSimilarity`

How closely generated speech should resemble the source voice, from 0 to 1.

Type: `number | undefined` (optional).

### `voiceSource`

Namespace of an existing voice, independent of selecting it by ID or name.

Type: `"catalog" | "custom" | undefined` (optional).

### `voiceStyle`

Saved delivery style identifier belonging to the selected voice.

Type: `string | undefined` (optional).

### `voiceTransform`

Post-synthesis voice coloration and acoustic effects, independent of speaking pitch.

Type: `{ readonly brightness?: number | undefined; readonly softness?: number | undefined; readonly crispness?: number | undefined; readonly effect?: "auditorium_echo" | "robotic" | "spacious_echo" | "telephone" | undefined; } | undefined` (optional).

### `volumeDb`

Output gain adjustment in decibels, independent of linear volume scaling.

Type: `number | undefined` (optional).

### `volumeScale`

Output volume multiplier.

Type: `number | undefined` (optional).

## amazon

Request variant 1:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative" | "long-form" | "neural" | "standard" | undefined`
- `output`: `Output`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative"`
- `output`: `Output`
- `text`: `AsyncIterable<string>`
- `voice`: `string`


## async

Request variant 1:

- `language`: `"de" | "en" | "es" | "fr" | "it" | "pt" | undefined`
- `model`: `"flash_v1.5"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput`
- `segmentation`: `"immediate" | "sentence" | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 2:

- `language`: `"de" | "en" | "es" | "fr" | "it" | "pt" | undefined`
- `model`: `"flash_v1.5"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput | WavOutput`
- `text`: `string`
- `voice`: `string`

Request variant 3:

- `language`: `"de" | "en" | "es" | "fr" | "it" | "pt" | undefined`
- `model`: `"flash_v1.5"`
- `output`: `Mp3Output | PcmOutput | WavOutput`
- `text`: `string`
- `timestampGranularity`: `"word"`
- `voice`: `string`

Request variant 4:

- `language`: `"ar" | "de" | "en" | "es" | "fr" | "he" | "hi" | "hy" | "it" | "ja" | "pt" | "ro" | "ru" | "tr" | "zh" | undefined`
- `model`: `"castleflow-1.0"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput`
- `segmentation`: `"immediate" | "sentence" | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 5:

- `language`: `"ar" | "de" | "en" | "es" | "fr" | "he" | "hi" | "hy" | "it" | "ja" | "pt" | "ro" | "ru" | "tr" | "zh" | undefined`
- `model`: `"castleflow-1.0"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput | WavOutput`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 6:

- `language`: `"ar" | "de" | "en" | "es" | "fr" | "he" | "hi" | "hy" | "it" | "ja" | "pt" | "ro" | "ru" | "tr" | "zh" | undefined`
- `model`: `"castleflow-1.0"`
- `output`: `Mp3Output | PcmOutput | WavOutput`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"word"`
- `voice`: `string`

Request variant 7:

- `language`: `"en" | undefined`
- `model`: `"pro_v1.0"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput`
- `segmentation`: `"immediate" | "sentence" | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 8:

- `language`: `"en" | undefined`
- `model`: `"pro_v1.0"`
- `output`: `Mp3Output | MuLawOutput | PcmOutput | WavOutput`
- `text`: `string`
- `voice`: `string`

Request variant 9:

- `language`: `"en" | undefined`
- `model`: `"pro_v1.0"`
- `output`: `Mp3Output | PcmOutput | WavOutput`
- `text`: `string`
- `timestampGranularity`: `"word"`
- `voice`: `string`


## camb

Request variant 1:

- `accentPreservation`: `boolean | undefined`
- `audioEnhancement`: `boolean | undefined`
- `inferenceSteps`: `number | undefined`
- `language`: `Language`
- `model`: `"mars8.1-flash-beta"`
- `namedEntityPronunciationEnhancement`: `boolean | undefined`
- `output`: `EncodedOutput`
- `referenceAudioEnhancement`: `boolean | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string>`
- `textFlushDelayMs`: `number | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 2:

- `accentPreservation`: `boolean | undefined`
- `audioEnhancement`: `boolean | undefined`
- `language`: `Language`
- `model`: `"mars8-flash" | "mars8-instruct" | "mars8-pro" | "mars8.1-flash-beta" | "mars8.1-pro-beta"`
- `namedEntityPronunciationEnhancement`: `boolean | undefined`
- `output`: `EncodedOutput | PcmOutput`
- `referenceAudioEnhancement`: `boolean | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 3:

- `accentPreservation`: `boolean | undefined`
- `audioEnhancement`: `boolean | undefined`
- `inferenceSteps`: `number | undefined`
- `language`: `Language`
- `model`: `"mars8.1-flash-beta"`
- `namedEntityPronunciationEnhancement`: `boolean | undefined`
- `output`: `EncodedOutput`
- `referenceAudioEnhancement`: `boolean | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textFlushDelayMs`: `number | undefined`
- `timestampGranularity`: `"word"`
- `voice`: `string`


## cartesia

Request variant 1:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined`
- `lexicon`: `string | undefined`
- `model`: `"sonic-3" | "sonic-3.5"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 2:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined`
- `lexicon`: `string | undefined`
- `maxBufferDelayMs`: `number | undefined`
- `model`: `"sonic-3" | "sonic-3.5"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 3:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined`
- `lexicon`: `string | undefined`
- `maxBufferDelayMs`: `number | undefined`
- `model`: `"sonic-3" | "sonic-3.5"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[]`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 4:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined`
- `lexicon`: `string | undefined`
- `model`: `"sonic-3" | "sonic-3.5"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[]`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 5:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `string | undefined`
- `lexicon`: `string | undefined`
- `model`: `"sonic-3.6"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 6:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `string | undefined`
- `lexicon`: `string | undefined`
- `maxBufferDelayMs`: `number | undefined`
- `model`: `"sonic-3.6"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 7:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `string | undefined`
- `lexicon`: `string | undefined`
- `maxBufferDelayMs`: `number | undefined`
- `model`: `"sonic-3.6"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[]`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 8:

- `accent`: `string | undefined`
- `emotion`: `Emotion | undefined`
- `language`: `string | undefined`
- `lexicon`: `string | undefined`
- `model`: `"sonic-3.6"`
- `output`: `RawOutput`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | { readonly locale: string; } | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[]`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`


## deepdub

Request variant 1:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"og-1.1"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `randomSeed`: `number`
- `referenceAudio`: `Uint8Array<ArrayBufferLike>`
- `speakerGender`: `"female" | "male" | undefined`
- `targetDurationMs`: `number`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string | undefined`
- `voiceBoost`: `boolean | undefined`

Request variant 2:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"og-1.1"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `randomSeed`: `number`
- `referenceAudio`: `Uint8Array<ArrayBufferLike>`
- `speakerGender`: `"female" | "male" | undefined`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string | undefined`
- `voiceBoost`: `boolean | undefined`

Request variant 3:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"og-1.1"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `randomSeed`: `number`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `speakerGender`: `"female" | "male" | undefined`
- `targetDurationMs`: `number`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`

Request variant 4:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"og-1.1"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `randomSeed`: `number`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `speakerGender`: `"female" | "male" | undefined`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`

Request variant 5:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"lightning-2.5" | "og-1.1" | "phantom-x-3.2"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike>`
- `speakerGender`: `"female" | "male" | undefined`
- `targetDurationMs`: `number`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string | undefined`
- `voiceBoost`: `boolean | undefined`

Request variant 6:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"lightning-2.5" | "og-1.1" | "phantom-x-3.2"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike>`
- `speakerGender`: `"female" | "male" | undefined`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string | undefined`
- `voiceBoost`: `boolean | undefined`

Request variant 7:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"lightning-2.5" | "og-1.1" | "phantom-x-3.2"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `speakerGender`: `"female" | "male" | undefined`
- `targetDurationMs`: `number`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`

Request variant 8:

- `accentBlend`: `{ readonly baseLocale: string; readonly targetLocale: string; readonly ratio: number; } | undefined`
- `audioEnhancement`: `boolean | undefined`
- `automaticGainControl`: `boolean | undefined`
- `deliveryReference`: `string | undefined`
- `deliveryVariance`: `number | undefined`
- `durationStretching`: `boolean | undefined`
- `language`: `string`
- `model`: `"lightning-2.5" | "og-1.1" | "phantom-x-3.2"`
- `output`: `Output`
- `processingPriority`: `"realtime" | "standard" | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `speakerGender`: `"female" | "male" | undefined`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`


## deepgram

Request variant 1:

- `language`: `"en"`
- `model`: `"aura-1"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"angus" | "arcas" | "asteria" | "athena" | "helios" | "hera" | "luna" | "orion" | "orpheus" | "perseus" | "stella" | "zeus"`

Request variant 2:

- `language`: `"en"`
- `model`: `"aura-1"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"angus" | "arcas" | "asteria" | "athena" | "helios" | "hera" | "luna" | "orion" | "orpheus" | "perseus" | "stella" | "zeus"`

Request variant 3:

- `language`: `"de"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"aurelia" | "elara" | "fabian" | "julius" | "kara" | "lara" | "viktoria"`

Request variant 4:

- `language`: `"de"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"aurelia" | "elara" | "fabian" | "julius" | "kara" | "lara" | "viktoria"`

Request variant 5:

- `language`: `"en"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"amalthea" | "andromeda" | "apollo" | "arcas" | "aries" | "asteria" | "athena" | "atlas" | "aurora" | "callista" | "cora" | "cordelia" | "delia" | "draco" | "electra" | "harmonia" | ... 24 more ... | "zeus"`

Request variant 6:

- `language`: `"en"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"amalthea" | "andromeda" | "apollo" | "arcas" | "aries" | "asteria" | "athena" | "atlas" | "aurora" | "callista" | "cora" | "cordelia" | "delia" | "draco" | "electra" | "harmonia" | ... 24 more ... | "zeus"`

Request variant 7:

- `language`: `"es"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"agustina" | "alvaro" | "antonia" | "aquila" | "carina" | "celeste" | "diana" | "estrella" | "gloria" | "javier" | "luciano" | "nestor" | "olivia" | "selena" | "silvia" | "sirio" | "valerio"`

Request variant 8:

- `language`: `"es"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"agustina" | "alvaro" | "antonia" | "aquila" | "carina" | "celeste" | "diana" | "estrella" | "gloria" | "javier" | "luciano" | "nestor" | "olivia" | "selena" | "silvia" | "sirio" | "valerio"`

Request variant 9:

- `language`: `"fr"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"agathe" | "hector"`

Request variant 10:

- `language`: `"fr"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"agathe" | "hector"`

Request variant 11:

- `language`: `"it"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"cesare" | "cinzia" | "demetra" | "dionisio" | "elio" | "flavio" | "livia" | "maia" | "melia"`

Request variant 12:

- `language`: `"it"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"cesare" | "cinzia" | "demetra" | "dionisio" | "elio" | "flavio" | "livia" | "maia" | "melia"`

Request variant 13:

- `language`: `"ja"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"ama" | "ebisu" | "fujin" | "izanami" | "uzume"`

Request variant 14:

- `language`: `"ja"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"ama" | "ebisu" | "fujin" | "izanami" | "uzume"`

Request variant 15:

- `language`: `"nl"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `tags`: `readonly string[] | undefined`
- `text`: `string`
- `voice`: `"beatrix" | "cornelia" | "daphne" | "hestia" | "lars" | "leda" | "rhea" | "roman" | "sander"`

Request variant 16:

- `language`: `"nl"`
- `model`: `"aura-2"`
- `modelImprovementOptOut`: `boolean | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"beatrix" | "cornelia" | "daphne" | "hestia" | "lars" | "leda" | "rhea" | "roman" | "sander"`


## elevenlabs

Request variant 1:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 2:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 3:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 4:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `string | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `true | undefined`
- `textBufferThresholds`: `readonly number[] | undefined`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 5:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 6:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `string | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `true | undefined`
- `textBufferThresholds`: `readonly number[] | undefined`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 7:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `string | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `false`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 8:

- `inputType`: `"ssml" | "text" | undefined`
- `language`: `string | undefined`
- `model`: `"flash-v2" | "flash-v2.5"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `false`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 9:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 10:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"multilingual-v2"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 11:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"multilingual-v2"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 12:

- `inputType`: `"ssml" | "text" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `true | undefined`
- `textBufferThresholds`: `readonly number[] | undefined`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 13:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 14:

- `inputType`: `"ssml" | "text" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `true | undefined`
- `textBufferThresholds`: `readonly number[] | undefined`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 15:

- `inputType`: `"ssml" | "text" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `false`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 16:

- `inputType`: `"ssml" | "text" | undefined`
- `model`: `"multilingual-v2"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `stability`: `number | undefined`
- `styleExaggeration`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBuffering`: `false`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`
- `voiceBoost`: `boolean | undefined`
- `voiceSimilarity`: `number | undefined`

Request variant 17:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"eleven-v3"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`

Request variant 18:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"eleven-v3"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `voice`: `string`

Request variant 19:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"maximum"`
- `model`: `"eleven-v3"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `textNormalization`: `false | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`

Request variant 20:

- `language`: `string | undefined`
- `model`: `"eleven-v3"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `"auto" | boolean | undefined`
- `voice`: `string`

Request variant 21:

- `contextAfter`: `Context | undefined`
- `contextBefore`: `Context | undefined`
- `language`: `string | undefined`
- `languageTextNormalization`: `boolean | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | "strong" | undefined`
- `model`: `"eleven-v3"`
- `output`: `Output`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: string | undefined; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"normalized" | "original" | undefined`
- `voice`: `string`

Request variant 22:

- `language`: `string | undefined`
- `model`: `"eleven-v3"`
- `output`: `StreamingOutput`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId: string; }[] | undefined`
- `randomSeed`: `number | undefined`
- `stability`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `"auto" | boolean | undefined`
- `timestampGranularity`: `"character"`
- `timestampText`: `"original" | undefined`
- `voice`: `string`


## fish

Request variant 1:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s1"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[]`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"segment" | undefined`
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string | undefined`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 2:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s1"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[]`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string | undefined`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 3:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s1"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[] | undefined`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"segment" | undefined`
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 4:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s1"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[] | undefined`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 5:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speakers`: `readonly { readonly voice: string; readonly referenceSamples?: undefined; }[] | readonly { readonly voice?: undefined; readonly referenceSamples: readonly ReferenceSample[]; }[]`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"segment" | undefined`
- `topP`: `number | undefined` (default: `0.7`)
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 6:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speakers`: `readonly { readonly voice: string; readonly referenceSamples?: undefined; }[] | readonly { readonly voice?: undefined; readonly referenceSamples: readonly ReferenceSample[]; }[]`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `topP`: `number | undefined` (default: `0.7`)
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 7:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[]`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"segment" | undefined`
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string | undefined`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 8:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[]`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string | undefined`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 9:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[] | undefined`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"segment" | undefined`
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `volumeDb`: `number | undefined` (default: `0`)

Request variant 10:

- `conditionOnPreviousChunks`: `boolean | undefined` (default: `true`)
- `earlyStopThreshold`: `number | undefined` (default: `1`)
- `features`: `readonly string[] | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined` (default: `"none"`)
- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `maxAudioTokens`: `number | undefined` (default: `1024`)
- `minTextChunkLength`: `number | undefined` (default: `50`)
- `model`: `"s2-pro" | "s2.1-pro" | "s2.1-pro-free"`
- `output`: `Mp3 | Opus | Uncompressed`
- `referenceSamples`: `readonly ReferenceSample[] | undefined`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textChunkLength`: `number | undefined` (default: `300`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `volumeDb`: `number | undefined` (default: `0`)


## google

Request variant 1:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"markup" | "ssml" | "text" | undefined`
- `language`: `ChirpFullLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `replacements`: `readonly Pronunciation[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `PrebuiltVoice`
- `volumeDb`: `number | undefined`

Request variant 2:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `ChirpFullLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Pcm | RawG711`
- `replacements`: `readonly Pronunciation[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `voice`: `PrebuiltVoice`

Request variant 3:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"markup" | "ssml" | "text" | undefined`
- `language`: `ChirpPauseLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `PrebuiltVoice`
- `volumeDb`: `number | undefined`

Request variant 4:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `ChirpPauseLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Pcm | RawG711`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `voice`: `PrebuiltVoice`

Request variant 5:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `ChirpTextLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `PrebuiltVoice`
- `volumeDb`: `number | undefined`

Request variant 6:

- `inputType`: `"text" | undefined`
- `language`: `ChirpTextLanguage`
- `model`: `"chirp-3-hd"`
- `output`: `Encoded | Pcm | RawG711`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `voice`: `PrebuiltVoice`

Request variant 7:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `ChirpFullLanguage`
- `model`: `"chirp-3-instant-custom-voice"`
- `output`: `Encoded | Pcm | Wav`
- `replacements`: `readonly Pronunciation[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 8:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `ChirpFullLanguage`
- `model`: `"chirp-3-instant-custom-voice"`
- `output`: `Encoded | Pcm | RawG711`
- `replacements`: `readonly Pronunciation[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `voice`: `string`

Request variant 9:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `"bn-IN" | "gu-IN" | "th-TH" | "vi-VN"`
- `model`: `"chirp-3-instant-custom-voice"`
- `output`: `Encoded | Pcm | Wav`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 10:

- `inputType`: `"markup" | "text" | undefined`
- `language`: `"bn-IN" | "gu-IN" | "th-TH" | "vi-VN"`
- `model`: `"chirp-3-instant-custom-voice"`
- `output`: `Encoded | Pcm | RawG711`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `voice`: `string`

Request variant 11:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `pitchSemitones`: `number | undefined`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speakers`: `readonly { readonly alias: string; readonly voice: PrebuiltVoice; }[]`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `volumeDb`: `number | undefined`

Request variant 12:

- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Pcm | RawG711`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speakers`: `readonly { readonly alias: string; readonly voice: PrebuiltVoice; }[]`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `textNormalization`: `boolean | undefined` (default: `true`)

Request variant 13:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-lite-preview-tts" | "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `pitchSemitones`: `number | undefined`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `voice`: `PrebuiltVoice`
- `volumeDb`: `number | undefined`

Request variant 14:

- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-lite-preview-tts" | "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Pcm | RawG711`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<string>`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `voice`: `PrebuiltVoice`

Request variant 15:

- `effectsProfiles`: `readonly string[] | undefined`
- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Mp3 | Pcm | Wav`
- `pitchSemitones`: `number | undefined`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speakers`: `readonly { readonly alias: string; readonly voice: PrebuiltVoice; }[]`
- `speed`: `number | undefined` (default: `1`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `turns`: `readonly Turn[]`
- `volumeDb`: `number | undefined`

Request variant 16:

- `inputType`: `"text" | undefined`
- `instructions`: `string | undefined`
- `language`: `string`
- `model`: `"gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview"`
- `output`: `Encoded | Pcm | RawG711`
- `safetySettings`: `readonly { readonly category: "dangerous_content" | "harassment" | "hate_speech" | "sexually_explicit"; readonly threshold: "high" | "low" | "medium" | "none" | "off"; }[] | undefined`
- `speakers`: `readonly { readonly alias: string; readonly voice: PrebuiltVoice; }[]`
- `speed`: `number | undefined` (default: `1`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `turns`: `AsyncIterable<Turn> | readonly Turn[]`


## gradium

- `lexicon`: `string | undefined`
- `model`: `"default" | "gradium-tts-beta" | undefined` (default: `"default"`)
- `output`: `Opus | Pcm | Telephony | Wav`
- `pacingBias`: `number | undefined` (default: `0`)
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string | AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `"auto" | false | { readonly locale: "de" | "en" | "es" | "fr" | "fr-be" | "fr-ch" | "pt"; readonly rules?: undefined; } | { readonly locale?: undefined; readonly rules: readonly Rule[]; } | undefined`
- `timestampGranularity`: `"segment" | undefined`
- `voice`: `string`
- `voiceGuidance`: `number | undefined` (default: `2`)

## hume

Request variant 1:

- `contextBefore`: `GenerationContext | TextContext | undefined`
- `latencyOptimization`: `"none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceDescription`: `string | undefined`

Request variant 2:

- `contextBefore`: `GenerationContext | undefined`
- `latencyOptimization`: `"none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceDescription`: `string | undefined`

Request variant 3:

- `contextBefore`: `DirectedDialogueContext | GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speakers`: `readonly (SpeakerId | SpeakerName)[]`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `turns`: `readonly DirectedTurn[]`

Request variant 4:

- `contextBefore`: `GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speakers`: `readonly (SpeakerId | SpeakerName)[]`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `turns`: `AsyncIterable<DirectedTurn | { readonly command: "flush"; }>`

Request variant 5:

- `contextBefore`: `GenerationContext | TextContext | undefined`
- `instructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 6:

- `contextBefore`: `GenerationContext | undefined`
- `instructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 7:

- `contextBefore`: `GenerationContext | TextContext | undefined`
- `instructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceName`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 8:

- `contextBefore`: `GenerationContext | undefined`
- `instructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceName`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 9:

- `contextBefore`: `DialogueContext | GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speakers`: `readonly (SpeakerId | SpeakerName)[]`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `turns`: `readonly Turn[]`

Request variant 10:

- `contextBefore`: `GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speakers`: `readonly (SpeakerId | SpeakerName)[]`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `turns`: `AsyncIterable<Turn | { readonly command: "flush"; }>`

Request variant 11:

- `contextBefore`: `GenerationContext | TextContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 12:

- `contextBefore`: `GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 13:

- `contextBefore`: `GenerationContext | TextContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `temperature`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceName`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)

Request variant 14:

- `contextBefore`: `GenerationContext | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `timestampGranularity`: `"phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined`
- `trailingSilenceMs`: `number | undefined` (default: `0`)
- `voiceName`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined` (default: `"custom"`)


## inworld

Inworld realtime synthesis, narrowed by model and input transport capabilities.

Request variant 1:

- `audioEnhancement`: `boolean | undefined` (default: `false`)
- `contextBefore`: `{ readonly texts: readonly string[]; readonly text?: undefined; readonly requestIds?: undefined; readonly turns?: undefined; } | undefined`
- `language`: `string | undefined`
- `model`: `"inworld-tts-1.5-max" | "inworld-tts-1.5-mini" | "inworld-tts-2-flash"`
- `output`: `Flac | Mp3 | Opus | Pcm | Telephony | Wav`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined` (default: `"auto"`)
- `timestampDelivery`: `"chunk" | "trailing" | undefined` (default: `"trailing"`)
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 2:

- `automaticTextFlushing`: `boolean | undefined` (default: `false`)
- `language`: `string | undefined`
- `model`: `"inworld-tts-1.5-max" | "inworld-tts-1.5-mini" | "inworld-tts-2-flash"`
- `output`: `Mp3 | Opus | Pcm | Telephony | Wav`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textBufferThreshold`: `number | undefined` (default: `1000`)
- `textFlushDelayMs`: `number | undefined` (default: `0`)
- `textNormalization`: `"auto" | boolean | undefined` (default: `"auto"`)
- `timestampDelivery`: `"chunk" | "trailing" | undefined` (default: `"trailing"`)
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 3:

- `audioEnhancement`: `boolean | undefined` (default: `false`)
- `contextBefore`: `{ readonly texts: readonly string[]; readonly text?: undefined; readonly requestIds?: undefined; readonly turns?: undefined; } | undefined`
- `deliveryMode`: `"balanced" | "creative" | "stable" | undefined` (default: `"balanced"`)
- `instructions`: `string | undefined`
- `language`: `string | undefined`
- `model`: `"inworld-tts-2"`
- `output`: `Flac | Mp3 | Opus | Pcm | Telephony | Wav`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `"auto" | boolean | undefined` (default: `"auto"`)
- `timestampDelivery`: `"chunk" | "trailing" | undefined` (default: `"trailing"`)
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 4:

- `automaticTextFlushing`: `boolean | undefined` (default: `false`)
- `deliveryMode`: `"balanced" | "creative" | "stable" | undefined` (default: `"balanced"`)
- `language`: `string | undefined`
- `model`: `"inworld-tts-2"`
- `output`: `Mp3 | Opus | Pcm | Telephony | Wav`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textBufferThreshold`: `number | undefined` (default: `1000`)
- `textFlushDelayMs`: `number | undefined` (default: `0`)
- `textNormalization`: `"auto" | boolean | undefined` (default: `"auto"`)
- `timestampDelivery`: `"chunk" | "trailing" | undefined` (default: `"trailing"`)
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`


## kugelaudio

Native KugelAudio synthesis; model aliases share capabilities, while input mode determines defaults and buffering controls.

Request variant 1:

- `language`: `Language | undefined`
- `maxAudioTokens`: `number | undefined` (default: `2048`)
- `model`: `"kugel-1" | "kugel-1-turbo" | "kugel-2" | "kugel-2-turbo" | "kugel-2.5" | "kugel-3" | undefined` (default: `"kugel-3"`)
- `output`: `Pcm | Telephony`
- `pronunciationDictionarySelection`: `{ readonly scope: number; readonly ids?: readonly number[] | undefined; } | undefined`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined` (default: `0.4`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"word" | undefined`
- `timestampText`: `"normalized" | undefined`
- `voice`: `string | number`
- `voiceBoost`: `boolean | undefined`
- `voiceGuidance`: `number | undefined` (default: `2`)

Request variant 2:

- `language`: `Language | undefined`
- `maxAudioTokens`: `number | undefined` (default: `2048`)
- `model`: `"kugel-1" | "kugel-1-turbo" | "kugel-2" | "kugel-2-turbo" | "kugel-2.5" | "kugel-3" | undefined` (default: `"kugel-3"`)
- `output`: `Pcm | Telephony`
- `pronunciationDictionarySelection`: `{ readonly scope: number; readonly ids?: readonly number[] | undefined; } | undefined`
- `speed`: `number | undefined` (default: `1`)
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | UpdateCommand | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textBufferThreshold`: `number | undefined` (default: `10000`)
- `textFlushDelayMs`: `number | undefined` (default: `500`)
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"word" | undefined`
- `timestampText`: `"normalized" | undefined`
- `voice`: `string | number`
- `voiceBoost`: `boolean | undefined`
- `voiceGuidance`: `number | undefined` (default: `2`)


## lovo

LOVO Genny's job-based TTS API. The selected voice determines model and language.

- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`
- `voiceStyle`: `string | undefined`

## microsoft

Model and input variants keep unsupported combinations out of all generated language APIs.

Request variant 1:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `"en-US" | "zh-CN" | undefined`
- `model`: `"dragon-hd-flash"`
- `output`: `Output | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `"en-US" | "zh-CN" | undefined`
- `model`: `"dragon-hd-flash"`
- `output`: `StreamingOutput | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 3:

- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"dragon-hd"`
- `namedEntityPronunciationEnhancement`: `boolean | undefined`
- `output`: `Output | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 4:

- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"dragon-hd"`
- `output`: `StreamingOutput | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 5:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"mai-voice-2" | "mai-voice-2-flash"`
- `output`: `Output | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 6:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"mai-voice-2" | "mai-voice-2-flash"`
- `output`: `StreamingOutput | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 7:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"neural" | undefined` (default: `"neural"`)
- `output`: `Output | undefined`
- `pitchSemitones`: `number | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 8:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"neural" | undefined` (default: `"neural"`)
- `output`: `StreamingOutput | undefined`
- `pitchSemitones`: `number | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string>`
- `timestampGranularity`: `"sentence" | "word" | readonly ("sentence" | "word")[] | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 9:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"neural" | undefined` (default: `"neural"`)
- `output`: `StreamingOutput | undefined`
- `pitchSemitones`: `number | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"sentence" | "word" | readonly ("sentence" | "word")[]`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 10:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"dragon-hd-omni"`
- `output`: `Output | undefined`
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `topK`: `number | undefined` (default: `22`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `voiceGuidance`: `number | undefined` (default: `1.4`)

Request variant 11:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"dragon-hd-omni"`
- `output`: `StreamingOutput | undefined`
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `AsyncIterable<string>`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 12:

- `emotion`: `string | undefined`
- `inputType`: `"text" | undefined`
- `language`: `string | undefined`
- `model`: `"dragon-hd-omni"`
- `output`: `StreamingOutput | undefined`
- `temperature`: `number | undefined` (default: `0.7`)
- `text`: `string`
- `timestampGranularity`: `"word"`
- `topK`: `number | undefined` (default: `22`)
- `topP`: `number | undefined` (default: `0.7`)
- `voice`: `string`
- `voiceGuidance`: `number | undefined` (default: `1.4`)

Request variant 13:

- `inputType`: `"ssml"`
- `output`: `Output | undefined`
- `text`: `string`

Request variant 14:

- `inputType`: `"ssml"`
- `output`: `StreamingOutput | undefined`
- `text`: `string`
- `timestampGranularity`: `"sentence" | "ssml" | "viseme" | "word" | readonly ("sentence" | "ssml" | "viseme" | "word")[]`


## minimax

Provider/model/transport combinations stay here; the shared base stays sum-type free.

Request variant 1:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 2:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 3:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 4:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 5:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 6:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 7:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 8:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 9:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 10:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 11:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 12:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 13:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 14:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 15:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 16:

- `emotion`: `Emotion | undefined`
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 17:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 18:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 19:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 20:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 21:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 22:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 23:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 24:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 25:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 26:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 27:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 28:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 29:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 30:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 31:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 32:

- `emotion`: `"fluent" | "whisper" | Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 33:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 34:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 35:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 36:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 37:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 38:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `Flac | Mp3 | Wav | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 39:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 40:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `HttpOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textNormalization`: `boolean | undefined` (default: `false`)
- `timestampDelivery`: `"trailing" | undefined`
- `timestampGranularity`: `"sentence" | "word" | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 41:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 42:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 43:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 44:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voiceBlend`: `readonly { readonly voice: string; readonly weight: number; }[]`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 45:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 46:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `SocketMp3 | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `voiceTransform`: `VoiceTransform`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 47:

- `emotion`: `Emotion | undefined`
- `formulaReading`: `"latex"`
- `language`: `"zh" | undefined` (default: `"zh"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)

Request variant 48:

- `emotion`: `Emotion | undefined`
- `language`: `Language | undefined` (default: `"auto"`)
- `languageTextNormalization`: `boolean | undefined` (default: `false`)
- `model`: `"speech-2.8-hd" | "speech-2.8-turbo" | undefined` (default: `"speech-2.8-hd"`)
- `output`: `StreamingOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; readonly alphabet?: undefined; }[] | undefined`
- `speed`: `number | undefined` (default: `1`)
- `splitTurns`: `boolean | undefined` (default: `true`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`
- `volumeScale`: `number | undefined` (default: `1`)


## mistral

Whole-text input, streaming output. Saved voices and one-off reference audio are separate capabilities.

- `metadata`: `{ readonly [key: string]: JsonValue; } | undefined`
- `model`: `"voxtral-mini-tts-2603" | undefined` (default: `"voxtral-mini-tts-2603"`)
- `output`: `EncodedOutput | PcmOutput | undefined`
- `promptCacheKey`: `string | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `text`: `string`
- `voice`: `string | undefined`

## murf

Falcon 2 streams input/output. Gen2 remains available through /generate after streaming deprecation.

Request variant 1:

- `language`: `string | undefined`
- `maxBufferDelayMs`: `number | undefined` (default: `300`)
- `model`: `"falcon-2" | undefined` (default: `"falcon-2"`)
- `output`: `FalconOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `speedBias`: `number | undefined` (default: `0`)
- `text`: `AsyncIterable<TtsInput>`
- `textBufferThreshold`: `number | undefined` (default: `40`)
- `voice`: `string`
- `voiceStyle`: `string | undefined`

Request variant 2:

- `language`: `string | undefined`
- `model`: `"falcon-2" | undefined` (default: `"falcon-2"`)
- `output`: `FalconOutput | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `speedBias`: `number | undefined` (default: `0`)
- `text`: `string`
- `voice`: `string`
- `voiceStyle`: `string | undefined`

Request variant 3:

- `audioRetention`: `boolean | undefined` (default: `true`)
- `deliveryVariance`: `0 | 0.2 | 0.4 | 0.6 | 0.8 | 1 | undefined` (default: `0.2`)
- `inputType`: `"markup" | "text" | undefined`
- `language`: `string | undefined`
- `model`: `"gen2"`
- `output`: `Gen2Output | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `speedBias`: `number | undefined` (default: `0`)
- `targetDurationMs`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"word" | undefined`
- `timestampText`: `"normalized" | undefined` (default: `"normalized"`)
- `voice`: `string`
- `voiceStyle`: `string | undefined`

Request variant 4:

- `audioRetention`: `boolean | undefined` (default: `true`)
- `deliveryVariance`: `0 | 0.2 | 0.4 | 0.6 | 0.8 | 1 | undefined` (default: `0.2`)
- `inputType`: `"markup" | "text" | undefined`
- `language`: `string`
- `model`: `"gen2"`
- `output`: `Gen2Output | undefined`
- `pitchBias`: `number | undefined` (default: `0`)
- `speedBias`: `number | undefined` (default: `0`)
- `targetDurationMs`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `"word"`
- `timestampText`: `"original"`
- `voice`: `string`
- `voiceStyle`: `string | undefined`


## openai

Whole-text speech generation; Realtime conversation generation is a different API.

Request variant 1:

- `model`: `"tts-1" | "tts-1-hd" | undefined` (default: `"tts-1"`)
- `output`: `EncodedOutput | PcmOutput | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `"alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer"`
- `voiceSource`: `"catalog" | undefined`

Request variant 2:

- `includeUsage`: `boolean | undefined` (default: `false`)
- `instructions`: `string | undefined`
- `model`: `"gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-03-20" | "gpt-4o-mini-tts-2025-12-15"`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `"alloy" | "ash" | "ballad" | "cedar" | "coral" | "echo" | "fable" | "marin" | "nova" | "onyx" | "sage" | "shimmer" | "verse"`
- `voiceSource`: `"catalog" | undefined`

Request variant 3:

- `includeUsage`: `boolean | undefined` (default: `false`)
- `instructions`: `string | undefined`
- `model`: `"gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-03-20" | "gpt-4o-mini-tts-2025-12-15"`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"custom"`


## resemble

Deployed Gradio Chatterbox APIs, not Resemble's separate commercial synthesis API.

Request variant 1:

- `model`: `"chatterbox" | undefined` (default: `"chatterbox"`)
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `0`)
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `referenceAudioTrimming`: `boolean | undefined` (default: `false`)
- `styleExaggeration`: `number | undefined` (default: `0.5`)
- `temperature`: `number | undefined` (default: `0.8`)
- `text`: `string`
- `voiceGuidance`: `number | undefined` (default: `0.5`)

Request variant 2:

- `language`: `"ar" | "da" | "de" | "el" | "en" | "es" | "fi" | "fr" | "he" | "hi" | "it" | "ja" | "ko" | "ms" | "nl" | "no" | "pl" | "pt" | "ru" | "sv" | "sw" | "tr" | "zh" | undefined` (default: `"en"`)
- `model`: `"chatterbox-multilingual"`
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `0`)
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `styleExaggeration`: `number | undefined` (default: `0.5`)
- `temperature`: `number | undefined` (default: `0.8`)
- `text`: `string`
- `voiceGuidance`: `number | undefined` (default: `0.5`)

Request variant 3:

- `loudnessNormalization`: `boolean | undefined` (default: `true`)
- `minP`: `number | undefined` (default: `0`)
- `model`: `"chatterbox-turbo"`
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `0`)
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `repetitionPenalty`: `number | undefined` (default: `1.2`)
- `temperature`: `number | undefined` (default: `0.8`)
- `text`: `string`
- `topK`: `number | undefined` (default: `1000`)
- `topP`: `number | undefined` (default: `0.95`)


## respeecher

Request variant 1:

- `frequencyPenalty`: `number | undefined`
- `language`: `"en" | "uk" | undefined` (default: `"en"`)
- `minP`: `number | undefined`
- `model`: `"realtime-tts" | undefined` (default: `"realtime-tts"`)
- `output`: `Mulaw | Pcm | undefined`
- `presencePenalty`: `number | undefined`
- `randomSeed`: `number | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string | AsyncIterable<TtsInput>`
- `topK`: `number | undefined`
- `topP`: `number | undefined`
- `voice`: `string`

Request variant 2:

- `frequencyPenalty`: `number | undefined`
- `language`: `"en" | "uk" | undefined` (default: `"en"`)
- `minP`: `number | undefined`
- `model`: `"realtime-tts" | undefined` (default: `"realtime-tts"`)
- `output`: `Wave`
- `presencePenalty`: `number | undefined`
- `randomSeed`: `number | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `topK`: `number | undefined`
- `topP`: `number | undefined`
- `voice`: `string`


## rime

Rime's preferred streaming HTTP and JSON WebSocket protocols. Model and language determine capabilities.

Request variant 1:

- `language`: `"ar" | "de" | "fr" | "hi" | "it" | "ja" | "pt"`
- `model`: `"coda"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`

Request variant 2:

- `language`: `"ar" | "de" | "fr" | "hi" | "it" | "ja" | "pt"`
- `model`: `"coda"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 3:

- `language`: `"en" | "es" | undefined` (default: `"en"`)
- `model`: `"coda"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 4:

- `language`: `"en" | "es" | undefined` (default: `"en"`)
- `model`: `"coda"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 5:

- `language`: `"de" | "fr"`
- `model`: `"mist-v2"`
- `output`: `LegacyMp3 | LegacyMuLaw | LegacyPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `textMarkup`: `Markup | undefined`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `voice`: `string`

Request variant 6:

- `language`: `"de" | "fr"`
- `model`: `"mist-v2"`
- `output`: `LegacyMp3 | LegacyMuLaw | LegacyPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textMarkup`: `Markup | undefined`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `voice`: `string`

Request variant 7:

- `language`: `"en" | "es" | undefined` (default: `"en"`)
- `model`: `"mist-v2"`
- `output`: `LegacyMp3 | LegacyMuLaw | LegacyPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `textMarkup`: `Markup | undefined`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 8:

- `language`: `"en" | "es" | undefined` (default: `"en"`)
- `model`: `"mist-v2"`
- `output`: `LegacyMp3 | LegacyMuLaw | LegacyPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textMarkup`: `Markup | undefined`
- `textNormalization`: `boolean | undefined` (default: `true`)
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 9:

- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `textMarkup`: `Markup | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 10:

- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textMarkup`: `Markup | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 11:

- `language`: `"de" | "fr"`
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `textMarkup`: `MarkupWithoutPhonemes | undefined`
- `voice`: `string`

Request variant 12:

- `language`: `"de" | "fr"`
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textMarkup`: `MarkupWithoutPhonemes | undefined`
- `voice`: `string`

Request variant 13:

- `language`: `"es"`
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `textMarkup`: `MarkupWithoutPhonemes | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 14:

- `language`: `"es"`
- `model`: `"mist-v3"`
- `output`: `ModernEncoded | ModernPcm | undefined`
- `segmentation`: `"immediate" | "manual" | "sentence" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `textMarkup`: `MarkupWithoutPhonemes | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`


## smallest.ai

Current Smallest.ai models. Lightning v2 is retired (410), not a supported variant.

Request variant 1:

- `contentRetentionDays`: `7 | undefined`
- `continuation`: `{ readonly id: string; readonly maxBufferDelayMs?: number | undefined; }`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `ProLanguage | undefined` (default: `"auto"`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`

Request variant 2:

- `completionDelayMs`: `number | undefined` (default: `4000`)
- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `ProLanguage | undefined` (default: `"auto"`)
- `maxBufferDelayMs`: `number | undefined` (default: `0`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 3:

- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `ProLanguage | undefined` (default: `"auto"`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: undefined; }[] | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 4:

- `contentRetentionDays`: `7 | undefined`
- `continuation`: `{ readonly id: string; readonly maxBufferDelayMs?: number | undefined; }`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`

Request variant 5:

- `completionDelayMs`: `number | undefined` (default: `4000`)
- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `maxBufferDelayMs`: `number | undefined` (default: `0`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string>`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`

Request variant 6:

- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `model`: `"lightning-v3.1-pro"`
- `numberPronunciationLanguage`: `ProLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`

Request variant 7:

- `contentRetentionDays`: `7 | undefined`
- `continuation`: `{ readonly id: string; readonly maxBufferDelayMs?: number | undefined; }`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `StandardLanguage | undefined` (default: `"auto"`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `string`

Request variant 8:

- `completionDelayMs`: `number | undefined` (default: `4000`)
- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `StandardLanguage | undefined` (default: `"auto"`)
- `maxBufferDelayMs`: `number | undefined` (default: `0`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 9:

- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `StandardLanguage | undefined` (default: `"auto"`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly versionId?: undefined; }[] | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `voice`: `string`

Request variant 10:

- `contentRetentionDays`: `7 | undefined`
- `continuation`: `{ readonly id: string; readonly maxBufferDelayMs?: number | undefined; }`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<TtsInput>`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`

Request variant 11:

- `completionDelayMs`: `number | undefined` (default: `4000`)
- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `maxBufferDelayMs`: `number | undefined` (default: `0`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `AsyncIterable<string>`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`

Request variant 12:

- `contentRetentionDays`: `7 | undefined`
- `formulaReading`: `"plain_text" | false | undefined` (default: `false`)
- `language`: `"en" | "hi" | undefined` (default: `"en"`)
- `model`: `"lightning-v3.1"`
- `numberPronunciationLanguage`: `StandardLanguage | undefined`
- `output`: `EncodedOutput | PcmOutput | undefined`
- `requestId`: `string | undefined`
- `sessionId`: `string | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `"word"`
- `voice`: `"avery" | "devansh" | "kartik" | "liam" | "maithili" | "meher"`


## typecast

Model-aware single-voice or composed synthesis. Every transport accepts whole text, never AsyncIterable input.

Request variant 1:

- `output`: `FullWave | Mp3 | undefined`
- `segments`: `readonly TtsSegment[]`

Request variant 2:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v21"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `Granularity`
- `voice`: `string`

Request variant 3:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v21"`
- `output`: `Mp3 | Wave | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 4:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `LegacyLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v21"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `Granularity | undefined`
- `voice`: `string`
- `volumeScale`: `number`

Request variant 5:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | "tonedown" | "toneup" | "whisper" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `Granularity`
- `voice`: `string`

Request variant 6:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | "tonedown" | "toneup" | "whisper" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `Mp3 | Wave | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 7:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | "tonedown" | "toneup" | "whisper" | undefined` (default: `"normal"`)
- `emotionIntensity`: `number | undefined` (default: `1`)
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `Granularity | undefined`
- `voice`: `string`
- `volumeScale`: `number`

Request variant 8:

- `contextAfter`: `{ readonly text: string; } | undefined`
- `contextBefore`: `{ readonly text: string; } | undefined`
- `emotion`: `"auto"`
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `timestampGranularity`: `Granularity`
- `voice`: `string`

Request variant 9:

- `contextAfter`: `{ readonly text: string; } | undefined`
- `contextBefore`: `{ readonly text: string; } | undefined`
- `emotion`: `"auto"`
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `Mp3 | Wave | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 10:

- `contextAfter`: `{ readonly text: string; } | undefined`
- `contextBefore`: `{ readonly text: string; } | undefined`
- `emotion`: `"auto"`
- `language`: `ModernLanguage | undefined` (default: `"auto"`)
- `model`: `"ssfm-v30"`
- `output`: `FullWave | Mp3 | undefined`
- `pitchSemitones`: `number | undefined` (default: `0`)
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `timestampGranularity`: `Granularity | undefined`
- `voice`: `string`
- `volumeScale`: `number`


## vocu

Request variant 1:

- `output`: `Output | undefined`
- `segments`: `readonly TtsSegment[]`

Request variant 2:

- `output`: `Output | undefined`
- `segments`: `readonly TextSegment[]`
- `subtitleFormat`: `"srt"`

Request variant 3:

- `audioProcessingProfile`: `string | undefined`
- `deliveryMode`: `"balanced" | "creative" | "stable" | undefined` (default: `"balanced"`)
- `emotionBlend`: `{ readonly anger?: number | undefined; readonly happiness?: number | undefined; readonly neutral?: number | undefined; readonly sadness?: number | undefined; readonly contextual?: number | undefined; } | undefined`
- `emotionSource`: `"text" | "voice" | undefined`
- `inputType`: `"markup"`
- `language`: `"auto" | "de" | "en-US" | "es" | "fr-FR" | "ja" | "ko" | "pt" | "yue" | "zh" | undefined` (default: `"auto"`)
- `latencyOptimization`: `"maximum" | "none" | undefined`
- `longTextMode`: `boolean | undefined`
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `-1`)
- `referenceEmphasis`: `"balanced" | "expressive" | "similarity" | undefined`
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `vividExpression`: `boolean | undefined` (default: `false`)
- `voice`: `string`
- `voiceStyle`: `string | undefined` (default: `"default"`)

Request variant 4:

- `audioProcessingProfile`: `string | undefined`
- `deliveryMode`: `"balanced" | "creative" | "stable" | undefined` (default: `"balanced"`)
- `emotionBlend`: `{ readonly anger?: number | undefined; readonly happiness?: number | undefined; readonly neutral?: number | undefined; readonly sadness?: number | undefined; readonly contextual?: number | undefined; } | undefined`
- `emotionSource`: `"text" | "voice" | undefined`
- `inputType`: `"text" | undefined`
- `language`: `"auto" | "de" | "en-US" | "es" | "fr-FR" | "ja" | "ko" | "pt" | "yue" | "zh" | undefined` (default: `"auto"`)
- `latencyOptimization`: `"none" | undefined`
- `longTextMode`: `boolean | undefined`
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `-1`)
- `speed`: `number | undefined` (default: `1`)
- `subtitleFormat`: `"srt"`
- `text`: `string`
- `vividExpression`: `boolean | undefined` (default: `false`)
- `voice`: `string`
- `voiceStyle`: `string | undefined` (default: `"default"`)

Request variant 5:

- `audioProcessingProfile`: `string | undefined`
- `deliveryMode`: `"balanced" | "creative" | "stable" | undefined` (default: `"balanced"`)
- `emotionBlend`: `{ readonly anger?: number | undefined; readonly happiness?: number | undefined; readonly neutral?: number | undefined; readonly sadness?: number | undefined; readonly contextual?: number | undefined; } | undefined`
- `emotionSource`: `"text" | "voice" | undefined`
- `inputType`: `"text" | undefined`
- `language`: `"auto" | "de" | "en-US" | "es" | "fr-FR" | "ja" | "ko" | "pt" | "yue" | "zh" | undefined` (default: `"auto"`)
- `latencyOptimization`: `"maximum" | "none" | undefined` (default: `"none"`)
- `longTextMode`: `boolean | undefined`
- `output`: `Output | undefined`
- `randomSeed`: `number | undefined` (default: `-1`)
- `speed`: `number | undefined` (default: `1`)
- `text`: `string`
- `vividExpression`: `boolean | undefined` (default: `false`)
- `voice`: `string`
- `voiceStyle`: `string | undefined` (default: `"default"`)

Request variant 6:

- `output`: `Output | undefined`
- `text`: `string`
- `textSplitter`: `TextSplitter`

Request variant 7:

- `output`: `Output | undefined`
- `subtitleFormat`: `"srt"`
- `text`: `string`
- `textSplitter`: `SavedSplitter | SubtitleBracketSplitter | SubtitleFallbackSplitter | SubtitlePlaceholderSplitter`


## voice.ai

Request variant 1:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"immediate" | undefined` (default: `"immediate"`)
- `language`: `"en" | NonEnglish | undefined` (default: `"en"`)
- `model`: `"auto" | undefined` (default: `"auto"`)
- `output`: `Output | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 2:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"paced"`
- `language`: `"en" | NonEnglish | undefined` (default: `"en"`)
- `model`: `"auto" | undefined` (default: `"auto"`)
- `output`: `Pcm | Telephony`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 3:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"immediate" | undefined` (default: `"immediate"`)
- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"voiceai-tts-v1-2026-02-10" | "voiceai-tts-v1-latest"`
- `output`: `Output | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 4:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"paced"`
- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"voiceai-tts-v1-2026-02-10" | "voiceai-tts-v1-latest"`
- `output`: `Pcm | Telephony`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 5:

- `apiVersion`: `"tts-v2"`
- `output`: `{ readonly format: "mp3" | "pcm" | "wav"; readonly sampleRateHz?: undefined; readonly bitRateBps?: undefined; readonly sampleEncoding?: undefined; readonly byteOrder?: undefined; readonly channelCount?: undefined; readonly constantBitRate?: undefined; } | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `topP`: `number | undefined`
- `voice`: `string`

Request variant 6:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"immediate" | undefined` (default: `"immediate"`)
- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"voiceai-tts-lite-v1-2026-04-15" | "voiceai-tts-lite-v1-latest"`
- `output`: `Output | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 7:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"paced"`
- `language`: `"en" | undefined` (default: `"en"`)
- `model`: `"voiceai-tts-lite-v1-2026-04-15" | "voiceai-tts-lite-v1-latest"`
- `output`: `Pcm | Telephony`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 8:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"immediate" | undefined` (default: `"immediate"`)
- `language`: `NonEnglish`
- `model`: `"voiceai-tts-multilingual-v1-2026-02-10" | "voiceai-tts-multilingual-v1-latest"`
- `output`: `Output | undefined`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`

Request variant 9:

- `apiVersion`: `"v1" | undefined` (default: `"v1"`)
- `audioDelivery`: `"paced"`
- `language`: `NonEnglish`
- `model`: `"voiceai-tts-multilingual-v1-2026-02-10" | "voiceai-tts-multilingual-v1-latest"`
- `output`: `Pcm | Telephony`
- `pronunciationDictionaries`: `readonly { readonly id: string; readonly version?: number | undefined; readonly versionId?: undefined; }[] | undefined`
- `temperature`: `number | undefined` (default: `1`)
- `text`: `string | AsyncIterable<TtsInput>`
- `topP`: `number | undefined` (default: `0.8`)
- `voice`: `string | undefined`


## xai

Request variant 1:

- `language`: `Language | undefined` (default: `"auto"`)
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | undefined`
- `voice`: `string | undefined`

Request variant 2:

- `language`: `Language | undefined` (default: `"auto"`)
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | undefined`
- `voice`: `string | undefined`
