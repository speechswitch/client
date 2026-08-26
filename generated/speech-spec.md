# Normalized speech API

Provider-neutral TTS request fields.

## TTS request

### `format`

Audio encoding format.

Type: `string | undefined` (optional).

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

### `sampleRateHz`

Audio sample rate in hertz.

Type: `number | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string> | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | undefined` (optional).

## amazon

Request variant 1:

- `format`: `"mp3" | "ogg_vorbis"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative" | "long-form" | "neural" | "standard" | undefined`
- `sampleRateHz`: `8000 | 16000 | 22050 | 24000 | 44100 | 48000 | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 2:

- `format`: `"ogg_opus"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative" | "long-form" | "neural" | "standard" | undefined`
- `sampleRateHz`: `48000 | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 3:

- `format`: `"pcm"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative" | "long-form" | "neural" | "standard" | undefined`
- `sampleRateHz`: `8000 | 16000 | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 4:

- `format`: `"alaw" | "mulaw"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative" | "long-form" | "neural" | "standard" | undefined`
- `sampleRateHz`: `8000 | undefined`
- `text`: `string`
- `voice`: `string`

Request variant 5:

- `format`: `"mp3" | "ogg_vorbis"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative"`
- `sampleRateHz`: `8000 | 16000 | 22050 | 24000 | 44100 | 48000 | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 6:

- `format`: `"ogg_opus"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative"`
- `sampleRateHz`: `48000 | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 7:

- `format`: `"pcm"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative"`
- `sampleRateHz`: `8000 | 16000 | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`

Request variant 8:

- `format`: `"alaw" | "mulaw"`
- `inputType`: `"ssml" | "text" | undefined`
- `language`: `"ar-AE" | "arb" | "ca-ES" | "cmn-CN" | "cs-CZ" | "cy-GB" | "da-DK" | "de-AT" | "de-CH" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IE" | "en-IN" | "en-NZ" | "en-SG" | "en-US" | ... 24 more ... | undefined`
- `lexicon`: `string | readonly string[] | undefined`
- `model`: `"generative"`
- `sampleRateHz`: `8000 | undefined`
- `text`: `AsyncIterable<string>`
- `voice`: `string`
