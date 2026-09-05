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

### `model`

Provider synthesis model or engine.

Type: `string | undefined` (optional).

### `modelImprovementOptOut`

Opt this request out of the provider's model-improvement program. May affect pricing.

Type: `boolean | undefined` (optional).

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `readonly { readonly pattern: string; readonly replacement: string; }[] | undefined` (optional).

### `segmentation`

Whether incremental text waits for sentence boundaries or is synthesized immediately.

Type: `"immediate" | "sentence" | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `stability`

Voice consistency, from 0 (more expressive) to 1 (more stable).

Type: `number | undefined` (optional).

### `tags`

Usage-reporting labels attached to this request.

Type: `readonly string[] | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand> | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | undefined` (optional).

### `timestampGranularity`

Timing detail requested alongside audio.

Type: `"character" | "word" | undefined` (optional).

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
