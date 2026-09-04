# Normalized speech API



## TTS request

### `audioEnhancement`

Whether the provider should apply additional audio cleanup or enhancement.

Type: `boolean | undefined` (optional).

### `contextTexts`

Earlier synthesized text supplied as context for the current request.

Type: `readonly string[] | undefined` (optional).

### `continuityId`

Identifier used to continue speech style and prosody across synthesis requests.

Type: `string | undefined` (optional).

### `deliveryInstructions`

Natural-language direction for how the speech should be delivered.

Type: `string | undefined` (optional).

### `deliveryVariation`

Degree of variation in how the requested delivery is performed.

Type: `"balanced" | "creative" | "stable" | undefined` (optional).

### `dictionarySelection`

Pronunciation dictionaries selected from an optional provider project.

Type: `{ readonly projectId?: string | number | undefined; readonly dictionaryIds?: readonly (string | number)[] | undefined; } | undefined` (optional).

### `emotion`

Requested speaking emotion or affect.

Type: `string | undefined` (optional).

### `emotionIntensity`

Strength of the requested emotion or affect.

Type: `number | undefined` (optional).

### `frequencyPenalty`

Penalty scaled by how frequently a model token has occurred.

Type: `number | undefined` (optional).

### `guidanceScale`

Classifier-free guidance strength used by a generative speech model.

Type: `number | undefined` (optional).

### `inlinePauses`

Whether provider-specific inline pause markup is interpreted.

Type: `boolean | undefined` (optional).

### `inlinePhonemes`

Whether provider-specific inline phoneme markup is interpreted.

Type: `boolean | undefined` (optional).

### `inlineSpeedFactors`

Speed factors applied to provider-specific marked spans in input order.

Type: `readonly number[] | undefined` (optional).

### `inputType`

Interpretation of the input text.

Type: `"ssml" | "text" | undefined` (optional).

### `interpretMath`

Whether written mathematical operators should be interpreted as spoken math.

Type: `boolean | undefined` (optional).

### `language`

Language or locale used for synthesis.

Type: `string | undefined` (optional).

### `latencyOptimization`

Degree to which synthesis quality may be traded for lower first-audio latency.

Type: `"aggressive" | "moderate" | "none" | undefined` (optional).

### `lexicon`

Pronunciation lexicon name or names.

Type: `string | readonly string[] | undefined` (optional).

### `loudnessNormalization`

Whether output loudness is normalized.

Type: `boolean | undefined` (optional).

### `maxOutputTokens`

Maximum number of model tokens generated for the requested speech.

Type: `number | undefined` (optional).

### `minimumTokenProbability`

Minimum token probability retained during model sampling.

Type: `number | undefined` (optional).

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `numberReadingLanguage`

Language used to read numbers independently of the synthesis language.

Type: `string | undefined` (optional).

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `pitchSemitones`

Speaking pitch adjustment in semitones.

Type: `number | undefined` (optional).

### `presencePenalty`

Penalty applied when a model token has already occurred.

Type: `number | undefined` (optional).

### `randomSeed`

Seed controlling deterministic model sampling, where supported.

Type: `number | undefined` (optional).

### `referenceAudio`

Reference audio used to derive a voice for this synthesis request.

Type: `Uint8Array<ArrayBufferLike> | undefined` (optional).

### `referenceAudioTrimming`

Whether silence is removed from reference audio before voice conditioning.

Type: `boolean | undefined` (optional).

### `repetitionPenalty`

Penalty applied to repeated model tokens.

Type: `number | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined` (optional).

### `segmentation`

Strategy used to decide when incrementally supplied text is synthesized.

Type: `"explicit" | "immediate" | "sentence" | undefined` (optional).

### `segments`

Ordered speech and silence segments composed into one output.

Type: `readonly ({ readonly text: string; readonly voice: string; readonly model: string; readonly language?: string | undefined; readonly output: TtsOutput; readonly speed?: number | undefined; ... 6 more ...; readonly randomSeed?: number | undefined; } | { ...; })[] | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `streamingBuffer`

Server-side buffering controls for incrementally supplied text.

Type: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: boolean | undefined; readonly completionDelayMs?: number | undefined; } | undefined` (optional).

### `surroundingContext`

Text surrounding the spoken input, used to infer its delivery.

Type: `{ readonly previous?: string | undefined; readonly next?: string | undefined; } | undefined` (optional).

### `targetLoudnessLufs`

Absolute output loudness target in LUFS.

Type: `number | undefined` (optional).

### `temperature`

Sampling temperature controlling variation in generated speech.

Type: `number | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand> | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | undefined` (optional).

### `timestampGranularity`

Requested alignment unit when timestamped synthesis is used.

Type: `"character" | "phoneme" | "sentence" | "viseme" | "word" | undefined` (optional).

### `topProbabilityMass`

Cumulative probability mass retained during nucleus sampling.

Type: `number | undefined` (optional).

### `topTokenCount`

Maximum number of candidate tokens retained during sampling.

Type: `number | undefined` (optional).

### `trailingSilenceSeconds`

Silence appended after the spoken input, in seconds.

Type: `number | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | undefined` (optional).

### `voiceSource`

Whether the selected voice comes from the provider catalog or the caller's custom voices.

Type: `"catalog" | "custom" | undefined` (optional).

### `voiceTuning`

Per-request controls for the selected voice's acoustic character.

Type: `{ readonly stability?: number | undefined; readonly similarity?: number | undefined; readonly style?: number | undefined; readonly speakerBoost?: boolean | undefined; } | undefined` (optional).

### `voiceVariant`

Provider-defined sub-variant or style identifier for the selected voice.

Type: `string | undefined` (optional).

### `volumeDb`

Output gain adjustment in decibels.

Type: `number | undefined` (optional).

### `volumeScale`

Speech volume multiplier, where 1 preserves the provider's default level.

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


## deepgram

Request variant 1:

- `language`: `Language`
- `model`: `"aura-1" | "aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `language`: `Language`
- `model`: `"aura-1" | "aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; }>`
- `voice`: `string`


## elevenlabs

Request variant 1:

- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"eleven-v3" | "flash-v2" | "flash-v2.5" | "multilingual-v2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `voiceTuning`: `{ readonly stability?: number | undefined; readonly similarity?: number | undefined; readonly style?: number | undefined; readonly speakerBoost?: boolean | undefined; } | undefined`

Request variant 2:

- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"eleven-v3" | "flash-v2" | "flash-v2.5" | "multilingual-v2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `voiceTuning`: `{ readonly stability?: number | undefined; readonly similarity?: number | undefined; readonly style?: number | undefined; readonly speakerBoost?: boolean | undefined; } | undefined`


## fish

Request variant 1:

- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `loudnessNormalization`: `boolean | undefined`
- `model`: `"s1" | "s2-pro"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `volumeDb`: `number | undefined`

Request variant 2:

- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `loudnessNormalization`: `boolean | undefined`
- `model`: `"s1" | "s2-pro"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `volumeDb`: `number | undefined`


## google

- `inputType`: `"ssml" | "text"`
- `language`: `string`
- `model`: `"chirp-3-hd" | "gemini-2.5-flash-lite-tts" | "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts"`
- `output`: `Output`
- `pitchSemitones`: `number | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string | undefined`
- `volumeDb`: `number | undefined`

## gradium

Request variant 1:

- `model`: `"tts" | "tts-beta"`
- `output`: `Output`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `model`: `"tts" | "tts-beta"`
- `output`: `Output`
- `text`: `AsyncIterable<string>`
- `voice`: `string`


## hume

Request variant 1:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceSeconds`: `number | undefined`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 2:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceSeconds`: `number | undefined`

Request variant 3:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceSeconds`: `number | undefined`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 4:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"none" | undefined`
- `model`: `"octave-1"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceSeconds`: `number | undefined`

Request variant 5:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `trailingSilenceSeconds`: `number | undefined`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 6:

- `continuityId`: `string | undefined`
- `deliveryInstructions`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"octave-2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `trailingSilenceSeconds`: `number | undefined`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`


## inworld

Request variant 1:

- `audioEnhancement`: `boolean | undefined`
- `contextTexts`: `readonly string[] | undefined`
- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"inworld-tts-1.5-max" | "inworld-tts-1.5-mini"`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 2:

- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | undefined`
- `model`: `"inworld-tts-1.5-max" | "inworld-tts-1.5-mini"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: boolean | undefined; } | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 3:

- `audioEnhancement`: `boolean | undefined`
- `contextTexts`: `readonly string[] | undefined`
- `deliveryInstructions`: `string | undefined`
- `deliveryVariation`: `"balanced" | "creative" | "stable" | undefined`
- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"inworld-tts-2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`

Request variant 4:

- `deliveryVariation`: `"balanced" | "creative" | "stable" | undefined`
- `language`: `string | undefined`
- `latencyOptimization`: `"aggressive" | undefined`
- `model`: `"inworld-tts-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: boolean | undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"character" | "word" | undefined`
- `voice`: `string`


## kugelaudio

Request variant 1:

- `dictionarySelection`: `DictionarySelection | undefined`
- `guidanceScale`: `number | undefined`
- `language`: `Language | undefined`
- `maxOutputTokens`: `number | undefined`
- `model`: `Model`
- `output`: `Output`
- `speed`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`

Request variant 2:

- `dictionarySelection`: `DictionarySelection | undefined`
- `guidanceScale`: `number | undefined`
- `language`: `Language | undefined`
- `maxOutputTokens`: `number | undefined`
- `model`: `Model`
- `output`: `Output`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: undefined; } | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `timestampGranularity`: `"word" | undefined`
- `voice`: `string`


## lovo

- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceVariant`: `string | undefined`

## microsoft

Request variant 1:

- `inputType`: `"ssml"`
- `output`: `Output`
- `text`: `string`

Request variant 2:

- `inputType`: `"text" | undefined`
- `language`: `string`
- `output`: `Output`
- `text`: `string`
- `voice`: `string`


## minimax

Request variant 1:

- `emotion`: `"angry" | "calm" | "disgusted" | "fearful" | "happy" | "sad" | "surprised" | undefined`
- `language`: `Language | undefined`
- `model`: `"speech-01-hd" | "speech-01-turbo" | "speech-02-hd" | "speech-02-turbo" | "speech-2.8-hd" | "speech-2.8-turbo"`
- `output`: `Output`
- `pitchSemitones`: `number | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`

Request variant 2:

- `emotion`: `"angry" | "calm" | "disgusted" | "fearful" | "fluent" | "happy" | "sad" | "surprised" | "whisper" | undefined`
- `language`: `Language | undefined`
- `model`: `"speech-2.6-hd" | "speech-2.6-turbo"`
- `output`: `Output`
- `pitchSemitones`: `number | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`
- `volumeScale`: `number | undefined`


## mistral

Request variant 1:

- `model`: `"voxtral-mini-tts-2603"`
- `output`: `Output`
- `referenceAudio`: `Uint8Array<ArrayBufferLike>`
- `text`: `string`

Request variant 2:

- `model`: `"voxtral-mini-tts-2603"`
- `output`: `Output`
- `text`: `string`
- `voice`: `string`


## murf

Request variant 1:

- `continuityId`: `string | undefined`
- `deliveryVariation`: `"balanced" | "creative" | "stable" | undefined`
- `language`: `string | undefined`
- `model`: `"falcon-2" | "gen2"`
- `output`: `StreamOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: undefined; } | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceVariant`: `string | undefined`

Request variant 2:

- `continuityId`: `string | undefined`
- `deliveryVariation`: `"balanced" | "creative" | "stable" | undefined`
- `language`: `string | undefined`
- `model`: `"falcon-2" | "gen2"`
- `output`: `StreamOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `voice`: `string`
- `voiceVariant`: `string | undefined`


## openai

Request variant 1:

- `deliveryInstructions`: `string | undefined`
- `model`: `"gpt-4o-mini-tts" | "gpt-4o-mini-tts-2025-12-15"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 2:

- `model`: `"tts-1" | "tts-1-hd"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`


## resemble

Request variant 1:

- `guidanceScale`: `number | undefined`
- `model`: `"chatterbox"`
- `output`: `Output`
- `randomSeed`: `number | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `referenceAudioTrimming`: `boolean | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voiceTuning`: `{ readonly stability?: undefined; readonly similarity?: undefined; readonly style?: number | undefined; readonly speakerBoost?: undefined; } | undefined`

Request variant 2:

- `guidanceScale`: `number | undefined`
- `language`: `"ar" | "da" | "de" | "el" | "en" | "es" | "fi" | "fr" | "he" | "hi" | "it" | "ja" | "ko" | "ms" | "nl" | "no" | "pl" | "pt" | "ru" | "sv" | "sw" | "tr" | "zh"`
- `model`: `"chatterbox-multilingual"`
- `output`: `Output`
- `randomSeed`: `number | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `voiceTuning`: `{ readonly stability?: undefined; readonly similarity?: undefined; readonly style?: number | undefined; readonly speakerBoost?: undefined; } | undefined`

Request variant 3:

- `loudnessNormalization`: `boolean | undefined`
- `minimumTokenProbability`: `number | undefined`
- `model`: `"chatterbox-turbo"`
- `output`: `Output`
- `randomSeed`: `number | undefined`
- `referenceAudio`: `Uint8Array<ArrayBufferLike> | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `topProbabilityMass`: `number | undefined`
- `topTokenCount`: `number | undefined`


## respeecher

Request variant 1:

- `continuityId`: `string | undefined`
- `frequencyPenalty`: `number | undefined`
- `language`: `"en" | "uk"`
- `minimumTokenProbability`: `number | undefined`
- `model`: `"realtime-tts"`
- `output`: `StreamingOutput`
- `presencePenalty`: `number | undefined`
- `randomSeed`: `number | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; }>`
- `topProbabilityMass`: `number | undefined`
- `topTokenCount`: `number | undefined`
- `voice`: `string`

Request variant 2:

- `frequencyPenalty`: `number | undefined`
- `language`: `"en" | "uk"`
- `minimumTokenProbability`: `number | undefined`
- `model`: `"realtime-tts"`
- `output`: `StreamingOutput`
- `presencePenalty`: `number | undefined`
- `randomSeed`: `number | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `topProbabilityMass`: `number | undefined`
- `topTokenCount`: `number | undefined`
- `voice`: `string`

Request variant 3:

- `frequencyPenalty`: `number | undefined`
- `language`: `"en" | "uk"`
- `minimumTokenProbability`: `number | undefined`
- `model`: `"realtime-tts"`
- `output`: `WavOutput`
- `presencePenalty`: `number | undefined`
- `randomSeed`: `number | undefined`
- `repetitionPenalty`: `number | undefined`
- `temperature`: `number | undefined`
- `text`: `string`
- `topProbabilityMass`: `number | undefined`
- `topTokenCount`: `number | undefined`
- `voice`: `string`


## rime

Request variant 1:

- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"coda"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `inlinePauses`: `boolean | undefined`
- `inlinePhonemes`: `boolean | undefined`
- `inlineSpeedFactors`: `readonly number[] | undefined`
- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"mist-v2"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`

Request variant 3:

- `inlinePauses`: `boolean | undefined`
- `inlineSpeedFactors`: `readonly number[] | undefined`
- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"mist-v3"`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 4:

- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"coda"`
- `output`: `Output`
- `segmentation`: `"explicit" | "immediate" | "sentence" | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `voice`: `string`

Request variant 5:

- `inlinePauses`: `boolean | undefined`
- `inlinePhonemes`: `boolean | undefined`
- `inlineSpeedFactors`: `readonly number[] | undefined`
- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"mist-v2"`
- `output`: `Output`
- `segmentation`: `"explicit" | "immediate" | "sentence" | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string`

Request variant 6:

- `inlinePauses`: `boolean | undefined`
- `inlineSpeedFactors`: `readonly number[] | undefined`
- `language`: `"ar" | "de" | "en" | "es" | "fr" | "hi" | "it" | "ja" | "pt" | undefined`
- `model`: `"mist-v3"`
- `output`: `Output`
- `segmentation`: `"explicit" | "immediate" | "sentence" | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; } | { readonly command: "flush"; }>`
- `voice`: `string`


## smallest.ai

Request variant 1:

- `continuityId`: `string`
- `interpretMath`: `boolean | undefined`
- `language`: `ProLanguage | undefined`
- `model`: `"lightning-v3.1-pro"`
- `numberReadingLanguage`: `ProLanguage | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: undefined; readonly automatic?: undefined; readonly completionDelayMs?: number | undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 2:

- `interpretMath`: `boolean | undefined`
- `language`: `ProLanguage | undefined`
- `model`: `"lightning-v3.1-pro"`
- `numberReadingLanguage`: `ProLanguage | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: undefined; readonly automatic?: undefined; readonly completionDelayMs?: number | undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 3:

- `dictionarySelection`: `{ readonly projectId?: undefined; readonly dictionaryIds?: readonly string[] | undefined; } | undefined`
- `interpretMath`: `boolean | undefined`
- `language`: `ProLanguage | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"lightning-v3.1-pro"`
- `numberReadingLanguage`: `ProLanguage | undefined`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 4:

- `continuityId`: `string`
- `interpretMath`: `boolean | undefined`
- `language`: `Language | undefined`
- `model`: `"lightning-v3.1"`
- `numberReadingLanguage`: `Language | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: undefined; readonly automatic?: undefined; readonly completionDelayMs?: number | undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 5:

- `interpretMath`: `boolean | undefined`
- `language`: `Language | undefined`
- `model`: `"lightning-v3.1"`
- `numberReadingLanguage`: `Language | undefined`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `streamingBuffer`: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: undefined; readonly automatic?: undefined; readonly completionDelayMs?: number | undefined; } | undefined`
- `text`: `AsyncIterable<string | { readonly command: "flush"; }>`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`

Request variant 6:

- `dictionarySelection`: `{ readonly projectId?: undefined; readonly dictionaryIds?: readonly string[] | undefined; } | undefined`
- `interpretMath`: `boolean | undefined`
- `language`: `Language | undefined`
- `latencyOptimization`: `"aggressive" | "none" | undefined`
- `model`: `"lightning-v3.1"`
- `numberReadingLanguage`: `Language | undefined`
- `output`: `Output`
- `speed`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`


## typecast

Request variant 1:

- `segments`: `readonly (TypecastPauseSegment | TypecastSpeechSegment)[]`

Request variant 2:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | undefined`
- `emotionIntensity`: `number | undefined`
- `language`: `V21Language | undefined`
- `latencyOptimization`: `"none"`
- `model`: `"ssfm-v21"`
- `output`: `Format`
- `pitchSemitones`: `number | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `surroundingContext`: `{ readonly previous?: string | undefined; readonly next?: string | undefined; } | undefined`
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`
- `volumeScale`: `number | undefined`

Request variant 3:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | undefined`
- `emotionIntensity`: `number | undefined`
- `language`: `V21Language | undefined`
- `latencyOptimization`: `"aggressive" | undefined`
- `model`: `"ssfm-v21"`
- `output`: `StreamFormat`
- `pitchSemitones`: `number | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `surroundingContext`: `{ readonly previous?: string | undefined; readonly next?: string | undefined; } | undefined`
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`
- `volumeScale`: `number | undefined`

Request variant 4:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | "tonedown" | "toneup" | "whisper" | undefined`
- `emotionIntensity`: `number | undefined`
- `language`: `V30Language | undefined`
- `latencyOptimization`: `"none"`
- `model`: `"ssfm-v30"`
- `output`: `Format`
- `pitchSemitones`: `number | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `surroundingContext`: `{ readonly previous?: string | undefined; readonly next?: string | undefined; } | undefined`
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`
- `volumeScale`: `number | undefined`

Request variant 5:

- `emotion`: `"angry" | "happy" | "normal" | "sad" | "tonedown" | "toneup" | "whisper" | undefined`
- `emotionIntensity`: `number | undefined`
- `language`: `V30Language | undefined`
- `latencyOptimization`: `"aggressive" | undefined`
- `model`: `"ssfm-v30"`
- `output`: `StreamFormat`
- `pitchSemitones`: `number | undefined`
- `randomSeed`: `number | undefined`
- `speed`: `number | undefined`
- `surroundingContext`: `{ readonly previous?: string | undefined; readonly next?: string | undefined; } | undefined`
- `targetLoudnessLufs`: `number | undefined`
- `text`: `string`
- `voice`: `string`
- `voiceSource`: `"catalog" | "custom" | undefined`
- `volumeScale`: `number | undefined`


## xai

Request variant 1:

- `language`: `Language`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`

Request variant 2:

- `language`: `Language`
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string | { readonly command: "clear"; }>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`
