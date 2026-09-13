# Normalized speech API



## TTS request

### `dataGovernance`

Controls the provider's use and retention of request data.

Type: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined` (optional).

### `expressivity`

Delivery register, from calm to animated.

Type: `"animated" | "calm" | "standard" | "very_animated" | "very_calm" | undefined` (optional).

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

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `replacements`

Phrase-to-pronunciation substitutions.

Type: `Readonly<Record<string, string>> | undefined` (optional).

### `speed`

Speech speed multiplier.

Type: `number | undefined` (optional).

### `telemetry`

Request observability and usage reporting.

Type: `{ readonly tags?: readonly string[] | undefined; } | undefined` (optional).

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string | TtsClearCommand | TtsFlushCommand | TtsUpdateCommand> | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | undefined` (optional).

### `timestampGranularity`

Timing detail requested alongside audio.

Type: `"character" | undefined` (optional).

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


## deepgram

Request variant 1:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"en"`
- `model`: `"aura-1"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"angus" | "arcas" | "asteria" | "athena" | "helios" | "hera" | "luna" | "orion" | "orpheus" | "perseus" | "stella" | "zeus"`

Request variant 2:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"en"`
- `model`: `"aura-1"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"angus" | "arcas" | "asteria" | "athena" | "helios" | "hera" | "luna" | "orion" | "orpheus" | "perseus" | "stella" | "zeus"`

Request variant 3:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"de"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"aurelia" | "elara" | "fabian" | "julius" | "kara" | "lara" | "viktoria"`

Request variant 4:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"de"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"aurelia" | "elara" | "fabian" | "julius" | "kara" | "lara" | "viktoria"`

Request variant 5:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"en"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"amalthea" | "andromeda" | "apollo" | "arcas" | "aries" | "asteria" | "athena" | "atlas" | "aurora" | "callista" | "cora" | "cordelia" | "delia" | "draco" | "electra" | "harmonia" | ... 24 more ... | "zeus"`

Request variant 6:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"en"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"amalthea" | "andromeda" | "apollo" | "arcas" | "aries" | "asteria" | "athena" | "atlas" | "aurora" | "callista" | "cora" | "cordelia" | "delia" | "draco" | "electra" | "harmonia" | ... 24 more ... | "zeus"`

Request variant 7:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"es"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"agustina" | "alvaro" | "antonia" | "aquila" | "carina" | "celeste" | "diana" | "estrella" | "gloria" | "javier" | "luciano" | "nestor" | "olivia" | "selena" | "silvia" | "sirio" | "valerio"`

Request variant 8:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"es"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"agustina" | "alvaro" | "antonia" | "aquila" | "carina" | "celeste" | "diana" | "estrella" | "gloria" | "javier" | "luciano" | "nestor" | "olivia" | "selena" | "silvia" | "sirio" | "valerio"`

Request variant 9:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"fr"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"agathe" | "hector"`

Request variant 10:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"fr"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"agathe" | "hector"`

Request variant 11:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"it"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"cesare" | "cinzia" | "demetra" | "dionisio" | "elio" | "flavio" | "livia" | "maia" | "melia"`

Request variant 12:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"it"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"cesare" | "cinzia" | "demetra" | "dionisio" | "elio" | "flavio" | "livia" | "maia" | "melia"`

Request variant 13:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"ja"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"ama" | "ebisu" | "fujin" | "izanami" | "uzume"`

Request variant 14:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"ja"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"ama" | "ebisu" | "fujin" | "izanami" | "uzume"`

Request variant 15:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"nl"`
- `model`: `"aura-2"`
- `output`: `RestOutput`
- `speed`: `number | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"beatrix" | "cornelia" | "daphne" | "hestia" | "lars" | "leda" | "rhea" | "roman" | "sander"`

Request variant 16:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `language`: `"nl"`
- `model`: `"aura-2"`
- `output`: `StreamingOutput`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"beatrix" | "cornelia" | "daphne" | "hestia" | "lars" | "leda" | "rhea" | "roman" | "sander"`

Request variant 17:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `expressivity`: `"animated" | "calm" | "standard" | "very_animated" | "very_calm" | undefined`
- `language`: `"en"`
- `model`: `"flux"`
- `output`: `FluxRestOutput`
- `speed`: `0.5 | 0.55 | 0.6 | 0.65 | 0.7 | 0.75 | 0.8 | 0.85 | 0.9 | 0.95 | 1 | 1.05 | 1.1 | 1.15 | 1.2 | 1.25 | 1.3 | 1.35 | 1.4 | 1.45 | 1.5 | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `string`
- `voice`: `"alexis" | "bree" | "brittany" | "brooke" | "bruce" | "cliff" | "cole" | "colin" | "conor" | "donovan" | "drew" | "elise" | "gemma" | "haley" | "hannah" | "heather" | "jack" | "kai" | ... 17 more ... | "wes"`

Request variant 18:

- `dataGovernance`: `{ readonly modelImprovementOptOut?: boolean | undefined; } | undefined`
- `expressivity`: `"animated" | "calm" | "standard" | "very_animated" | "very_calm" | undefined`
- `language`: `"en"`
- `model`: `"flux"`
- `output`: `FluxStreamingOutput`
- `speed`: `0.5 | 0.55 | 0.6 | 0.65 | 0.7 | 0.75 | 0.8 | 0.85 | 0.9 | 0.95 | 1 | 1.05 | 1.1 | 1.15 | 1.2 | 1.25 | 1.3 | 1.35 | 1.4 | 1.45 | 1.5 | undefined`
- `telemetry`: `{ readonly tags?: readonly string[] | undefined; } | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `voice`: `"alexis" | "bree" | "brittany" | "brooke" | "bruce" | "cliff" | "cole" | "colin" | "conor" | "donovan" | "drew" | "elise" | "gemma" | "haley" | "hannah" | "heather" | "jack" | "kai" | ... 17 more ... | "wes"`


## xai

Request variant 1:

- `language`: `Language | undefined` (default: `"auto"`)
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `text`: `string`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`

Request variant 2:

- `language`: `Language | undefined` (default: `"auto"`)
- `latencyOptimization`: `"aggressive" | "moderate" | "none" | undefined`
- `model`: `"grok-tts" | undefined`
- `output`: `Output | undefined`
- `replacements`: `Readonly<Record<string, string>> | undefined`
- `speed`: `number | undefined`
- `text`: `AsyncIterable<TtsInput>`
- `textNormalization`: `boolean | undefined`
- `voice`: `string | undefined`
