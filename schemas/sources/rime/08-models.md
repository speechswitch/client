> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Models

> Coda and Mist are Rime's models: what each one is for, which features they support, and how to choose between them.

Start with **Coda** for new applications. Choose **Mist v3** when the lowest time to first audio matters most, or when you need custom pauses. Inline pronunciation control is the one feature Mist v3 does not carry forward from Mist v2.

## Choose a model

| Pick this | When                                                                                                                                                                  |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coda`    | **Default for most new apps.** Rime's flagship model, with the highest voice-quality scores in Rime's human evaluations, sub-100ms model latency, and nine languages. |
| `mistv3`  | You need the fastest time to first audio (approximately 37ms P50 in Rime's benchmark), or custom pauses. Does not support inline pronunciation control.               |
| `mistv2`  | You need inline pronunciation control, which is available on Mist v2 and Mist v1 only.                                                                                |

For benchmark methodology, latency, and throughput numbers, see [Latency](/docs/latency#real-time-performance-benchmarks).

Rime supports Coda and Mist through the cloud API and on-premises, and both stream audio over [HTTP and WebSockets](/docs/streaming). On-prem image language coverage can differ from the cloud API; see the [on-prem quickstart](/docs/on-prem/quickstart#tts-service) before provisioning a deployment.

<Tip>Use the [regional endpoint](/docs/regional-endpoints) closest to your application to reduce network latency.</Tip>

## Feature matrix

| Attribute                                                | Coda |        Mist       |
| :------------------------------------------------------- | :--: | :---------------: |
| Number of voices                                         |  253 | 78 (v3), 138 (v2) |
| Multilingual                                             |   ✅  |         ✅         |
| [Text normalization](/docs/text-normalization)           |   ✅  |         ✅         |
| [`spell()` function](/docs/spell)                        |   ✅  |         ✅         |
| [Speed adjustment](/docs/speed)                          |   ✅  |         ✅         |
| [Pronunciation control](/platform/pronunciation-control) |   ❌  |    Mist v2 only   |
| [Custom pauses](/docs/custom-pauses)                     |   ❌  |         ✅         |

The Mist column reflects Mist v3 and Mist v2, which both serve English, French, German, and Spanish. See the [language matrix](/docs/voices#languages) for coverage per model.

The two Mist models differ on pronunciation control. Custom pauses work on both, but `phonemizeBetweenBrackets` works on Mist v2 and Mist v1 only, and is not supported on Mist v3 or Coda.

<Warning>**Inline pronunciation control is available on Mist v2 and Mist v1 only.** If your application depends on inline phoneme overrides, Mist v3 and Coda will not carry them. The alternatives are to submit the word to Rime for the pronunciation dictionary, or to respell it phonetically in plain English and accept that the result is approximate. See [Custom pronunciation](/docs/custom-pronunciation), and contact [support@rime.ai](mailto:support@rime.ai) if inline overrides are load-bearing for you.</Warning>

Multilingual describes the model, not the individual voice. Almost every voice serves a single language, so the number of voices you can choose from depends on the language you need. Through the cloud API, Coda serves 9 languages across 253 voices, but 162 of those voices are English and only 2 are Hindi. Browse the [Coda](/docs/voices-coda) and [Mist v3](/docs/voices-mist-v3) catalogs to see the voices available in a given language.

## Coda

**Coda**, released May 2026, is Rime's flagship TTS model. It pairs an LLM backbone with a dedicated speech inference engine trained on full-duplex conversational data.

* Received the highest voice-quality scores in Rime's human evaluations for naturalness, prosody, and artifact-free output
* **Sub-100ms model latency on the GPU engine** when self-hosted or on-prem
  * Cloud API users typically add 25 to 50ms of network round-trip time from most of the continental US when routed to the closest [regional endpoint](/docs/regional-endpoints)
* Nine cloud API languages: English, Arabic, French, German, Hindi, Italian, Japanese, Portuguese, and Spanish. Each voice serves one of them
* Word-level timestamps for text-audio alignment and interruption handling
* Supports [`spell()`](/docs/spell) for spelling sequences letter by letter or number by number
* Available with `modelId: coda`

## Mist v3

**Mist v3**, released March 2026, is the low-latency model in the Mist family.

* Typical time to first byte is well below 100ms
* Supports English, French, German, and Spanish
* Supports [custom pauses](/docs/custom-pauses). Does not support inline [pronunciation control](/platform/pronunciation-control), which is Mist v2 and Mist v1 only
* 78 voices; browse them in the [Mist v3 catalog](/docs/voices-mist-v3)
* [`speedAlpha`](/docs/speed) values above 1.0 produce faster speech, the modern direction
* Uses `modelId: mistv3`

## Mist v2

**Mist v2**, released February 2025, is the Mist model with inline pronunciation control.

* Supports English, French, German, and Spanish
* Inline [pronunciation control](/platform/pronunciation-control), which no other model supports, and [custom pauses](/docs/custom-pauses), which Mist v3 also supports
* On-prem latency depends on your GPU and text length. Rime measured a 175ms median on A10Gs and similar GPUs with 40 to 50 character sentences; see the [on-prem quickstart](/docs/on-prem/quickstart) for that figure in context and [Latency](/docs/latency) for the benchmark methodology
* 138 voices across accents, demographics, and speaking styles
* [`speedAlpha`](/docs/speed) values below 1.0 produce faster speech, the inverse of every other model
* Uses `modelId: mistv2`

## Mist legacy

**Mist**, released April 2023, is a legacy model in the Mist family. Use `modelId: mistv2` or `modelId: mist` to synthesize with these older deployments.

<Warning>Requests that omit `modelId`, or send a value the API does not recognize, are served by **Mist v3**. Set `modelId` explicitly on every request; Coda is never served by default.</Warning>

**Model v1 was released in April 2022 and has been deprecated.**
