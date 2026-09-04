# Normalized speech API

Provider-neutral TTS request fields.

## TTS request

### `inputType`

Interpretation of the input text.

Type: `"ssml" | "text" | undefined` (optional).

### `language`

Language or locale used for synthesis.

Type: `string | undefined` (optional).

### `lexicon`

Pronunciation lexicon name or names.

Type: `string | readonly string[] | undefined` (optional).

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `optimizeStreamingLatency`

Whether to trade a small amount of quality for lower first-audio latency.

Type: `boolean | undefined` (optional).

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

Type: `string | AsyncIterable<string> | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | undefined` (optional).

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


## xai

Request variant 1:

- `language`: `Language`
- `model`: `"grok-tts" | undefined`
- `optimizeStreamingLatency`: `boolean | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`

Request variant 2:

- `language`: `Language`
- `model`: `"grok-tts" | undefined`
- `optimizeStreamingLatency`: `boolean | undefined`
- `output`: `Output | undefined`
- `replacements`: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<string>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`
