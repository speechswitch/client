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

### `guidanceScale`

Classifier-free guidance strength used by a generative speech model.

Type: `number | undefined` (optional).

### `inputType`

Interpretation of the input text.

Type: `"ssml" | "text" | undefined` (optional).

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

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `pitchSemitones`

Speaking pitch adjustment in semitones.

Type: `number | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `streamingBuffer`

Server-side buffering controls for incrementally supplied text.

Type: `{ readonly maxDelayMs?: number | undefined; readonly characterThreshold?: number | undefined; readonly automatic?: boolean | undefined; } | undefined` (optional).

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

### `volumeDb`

Output gain adjustment in decibels.

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
