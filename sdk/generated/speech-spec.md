# Normalized speech API



## TTS request

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

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand> | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | undefined` (optional).

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
