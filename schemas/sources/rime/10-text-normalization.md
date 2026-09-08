> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text normalization

> Rime normalizes numbers, dates, currency, phone numbers, and measurements before synthesis, in English and other supported languages.

When you send text to Rime's TTS models, a normalization layer runs first. It expands numbers, dates, currency, phone numbers, measurements, and other non-standard words into their spoken form before the model synthesizes audio.

<Note>
  **Rime handles text normalization automatically.** Most common formats (currency with symbols, dates with years, clock times, phone numbers, and standard measurements) expand correctly without any preprocessing. Just write naturally. If something sounds wrong, [debug it with `/textnorm`](#debugging-with-the-textnorm-endpoint) before adding a pre-processing layer to your application.
</Note>

## Handled at a glance

Select a category for its full input/output reference.

| Category                                | Examples                                                                    | Reference                                                       |
| :-------------------------------------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| Numbers, currency, ranges, measurements | `$1,045.96`, `5kg`, `98°F`, `13-50`, `1/2`, `1e6`, `(213) 555-9274`         | [Numbers, currency, and measurements](/docs/numbers)            |
| Dates and times                         | `10/12/2024`, `2021-03-15`, `April 2, 2024`, `3:45pm`, `15:45`, `noon`      | [Dates and times](/docs/dates)                                  |
| Addresses, URLs, emails                 | `529 Main St., Boston, MA 02129`, `https://app.rime.ai`, `name@example.com` | [Addresses, URLs, and emails](/docs/addresses)                  |
| Abbreviations, acronyms, initialisms    | `Dr. Smith`, `e.g.`, `NASA`, `d. n. a.`                                     | [Abbreviations, acronyms, and initialisms](/docs/abbreviations) |
| Symbols and percentages                 | `&`, `$`, `%`, `100%`                                                       | [Symbols and percentages](/docs/symbols)                        |

## Forced letter-by-letter reading

For account numbers, confirmation codes, SKUs, and acronyms the normalizer doesn't recognize, wrap the string in `spell(...)` to force letter-by-letter pronunciation. It works on the Mist family; Coda's pipeline has no `spell()` stage.

```text theme={null}
Input:  Your confirmation code is spell(PRM423GDDML2354).
Output: Your confirmation code is P R M, 4 2 3, G D D, M L, 2, 3 5 4.
```

For full reference, see [Spell function](/docs/spell).

## Brand names, product names, and uncommon words

Rime's models may not nail uncommon brand or product names on the first try. Two options:

1. **Submit the word to Rime** to add to the dictionary (typically about a week). Reach out to your account manager via Slack or email, or contact [sales@rime.ai](mailto:sales@rime.ai); mention if you need faster turnaround or have an SLA.
2. **Use custom pronunciations inline** with the [Rime phonetic alphabet](/platform/rime-phonetic-alphabet) and `phonemizeBetweenBrackets: true`. See [Custom pronunciation](/docs/custom-pronunciation) for the full reference.

<Warning>
  [`phonemizeBetweenBrackets`](/docs/custom-pronunciation) works on **Mist v1, Mist v2, and English Mist v3**. It is not supported on Coda or non-English Mist v3. For brand or product name pronunciations on those models, submit the word to Rime to add to the dictionary, respell phonetically in plain English (accepting that this is approximate), or use a supported Mist model for flows where pronunciation control matters.
</Warning>

For full reference, see [Custom pronunciation](/docs/custom-pronunciation). To check whether a word is already in Rime's dictionary, use the [Coverage API](/api-reference/other/oov).

## Feature availability across models

| Feature                                                                            |                           Coda                          |          Mist          |
| :--------------------------------------------------------------------------------- | :-----------------------------------------------------: | :--------------------: |
| Native text normalization (numbers, currency, dates, etc.)                         | ❌ (handled by the model itself, not a normalizer stage) |            ✅           |
| `spell()` for forced letter-by-letter                                              |                            ❌                            |            ✅           |
| Punctuation-driven prosody                                                         |                            ✅                            |            ✅           |
| [`pauseBetweenBrackets`](/docs/custom-pauses) (custom pause tags like `<750>`)     |                            ❌                            |            ✅           |
| [`phonemizeBetweenBrackets`](/docs/custom-pronunciation) (inline phonetic strings) |                            ❌                            | ✅ (v1, v2, English v3) |
| Deterministic per-term pronunciation config                                        |                            ❌                            |            ✅           |

For flows that need precise pause durations (legal disclaimers, regulated read-backs) or guaranteed pronunciation of brand and product names, Mist is the safer choice.

## Debugging with the textnorm endpoint

The fastest way to spot-check normalization without writing code is the [Generate page in the Rime web app](https://app.rime.ai/generate/): paste any input string and it shows you the normalized version Rime will synthesize from.

For programmatic debugging, Rime also exposes a `/textnorm` endpoint that returns the grammar normalizer's output for an input string; per-model pipelines may differ (Mist v3 additionally runs a `spell` stage, and Coda runs no normalizer at all). In scripts and pipelines, use it to separate normalization issues from synthesis issues.

```bash theme={null}
curl -X POST https://optimize.rime.ai/textnorm \
    -H "Authorization: Bearer $(rime key)" \
    -H "Content-Type: application/json" \
    -d '{"text":"1234 1,2,3,4 1-800-444-4141 "}'
```

```json theme={null}
{"normalized":"twelve thirty four, one , two , three , four, one, eight hundred, four four four, four one four one"}
```

The endpoint defaults to English. For other languages, pass a language code in the `lang` field:

```bash theme={null}
curl -X POST https://optimize.rime.ai/textnorm \
    -H "Authorization: Bearer $(rime key)" \
    -H "Content-Type: application/json" \
    -d '{"text":"Tengo 2 perros","lang":"es"}'
```

See [Languages](/docs/voices#languages) for the full list of supported languages. Output is the same regardless of which model you'll synthesize with. For the full request and response reference, see the [Text Normalization API](/api-reference/other/textnorm).

### Triage workflow

When something sounds off:

1. **Capture the exact input text** that produced the bad output.
2. **POST it to `/textnorm`** and look at the normalized output.
3. **Compare** the normalized output to what you expected the model to say.
4. If normalization is wrong, you have a reproducible signal; [flag it to Rime](mailto:support@rime.ai) with the input, expected normalization, and actual normalization. Fixes ship on Rime's side.
5. If normalization looks correct but speech still sounds off, the issue is in synthesis, not normalization; try a different voice, model version, or sampling settings.

## Testing checklist

Before going to production, test the voice against realistic versions of:

1. Every date format your backend can produce (MM/DD, MM/DD/YYYY, ISO, relative like "tomorrow").
2. Every currency you'll quote, including round numbers and fractional cents.
3. The longest realistic phone number, account number, and confirmation code.
4. Your top 20 most-spoken product or brand names.
5. At least one utterance from each of: quote, greeting, confirmation, error, payment, scheduling.
6. The same utterance regenerated 5 to 10 times. Consistency across regenerations is what catches sampling variance.

For anything that sounds wrong, POST the exact input to [`/textnorm`](#debugging-with-the-textnorm-endpoint) to see what the model actually received, then [flag it to Rime](mailto:support@rime.ai) so the fix lands for everyone.

## Pre-normalizing in your application

For most applications, pre-normalizing is unnecessary and adds latency and engineering complexity. Rime's normalizer handles common patterns natively, and the fastest way to fix a pronunciation issue is to verify with [`/textnorm`](#debugging-with-the-textnorm-endpoint) and [flag any miss to Rime](mailto:support@rime.ai).

If a pattern genuinely needs to be pre-expanded, such as a domain-specific alphanumeric ID or a flow that must read identically after regeneration, see [Pre-normalizing text](/docs/pre-normalization) for guidance and a drop-in prompt template.
