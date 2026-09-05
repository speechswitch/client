# Normalized speech API



## TTS request

### `accent`

Accent to use independently of the synthesis language.

Type: `string | undefined` (optional).

### `accentPreservation`

Preserve the source voice's accent in generated speech.

Type: `boolean | undefined` (optional).

### `audioEnhancement`

Apply provider audio cleanup and loudness enhancement to generated output.

Type: `boolean | undefined` (optional).

### `emotion`

Requested emotional delivery.

Type: `string | undefined` (optional).

### `inferenceSteps`

Number of inference steps used to generate speech.

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

### `maxBufferDelayMs`

Maximum provider text-buffering delay before generation begins.

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

### `output`

Requested audio representation.

Type: `TtsOutput | undefined` (optional).

### `referenceAudioEnhancement`

Clean up the source recording behind the selected voice.

Type: `boolean | undefined` (optional).

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

### `textFlushDelayMs`

Idle time before flushing trailing incomplete text; complete sentences may flush sooner.

Type: `number | undefined` (optional).

### `textNormalization`

Whether written text is normalized to spoken form before synthesis.

Type: `boolean | { readonly locale: string; } | undefined` (optional).

### `timestampGranularity`

Timing detail requested alongside audio; an array selects multiple supported kinds.

Type: `"character" | "phoneme" | "word" | readonly ("phoneme" | "word")[] | undefined` (optional).

### `timestampText`

Whether timestamps describe the original or normalized spoken text.

Type: `"normalized" | "original" | undefined` (optional).

### `voice`

Provider voice identifier.

Type: `string | undefined` (optional).

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
