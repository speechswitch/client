> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text Rewriting Rules

> Normalize and expand text patterns for better TTS pronunciation

The text-to-speech API supports text rewriting rules that normalize and expand certain patterns in the input text before synthesis. These rules help the TTS model properly pronounce numbers, currency amounts, email addresses, URLs, and alphanumeric codes.

## Configuration

Rewrite rules are controlled by the `rewrite_rules` field of `json_config`. Its value is a single string: either a language alias (e.g. `"en"`), a comma-delimited list of rule names (e.g. `"NumberEn,CurrencyEn,EmailEn"`), or `"none"` to disable rewriting.

`json_config` goes in the setup message for WebSocket sessions, or in the request body for the REST endpoint:

<CodeGroup>
  ```python Python (streaming) theme={null}
  import gradium

  client = gradium.client.GradiumClient(api_key="your-api-key")

  async with client.tts_realtime(
      voice_id="Bla6SbVMczYnOhfK",
      output_format="pcm",
      json_config={"rewrite_rules": "en"},
  ) as tts:
      await tts.send_text("The invoice came to $1500.")
      await tts.send_eos()
      ...
  ```

  ```python Python (one-shot) theme={null}
  import gradium

  client = gradium.client.GradiumClient(api_key="your-api-key")

  result = await client.tts(
      setup={
          "voice_id": "Bla6SbVMczYnOhfK",
          "output_format": "wav",
          "json_config": {"rewrite_rules": "NumberEn,CurrencyEn,EmailEn"},
      },
      text="The total is $1500, invoice sent to foo.bar@gmail.com.",
  )

  with open("output.wav", "wb") as f:
      f.write(result.raw_data)
  ```

  ```js JavaScript (WebSocket) theme={null}
  // Authentication uses a short-lived token; see the Browser WebSockets guide.
  const url = new URL("wss://api.gradium.ai/api/speech/tts");
  url.searchParams.set("token", token);
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      type: "setup",
      model_name: "default",
      voice_id: "Bla6SbVMczYnOhfK",
      output_format: "pcm",
      json_config: {rewrite_rules: "en"},
    }));
  });
  ```

  ```bash cURL (REST) theme={null}
  curl -L -X POST https://api.gradium.ai/api/post/speech/tts \
    -H "x-api-key: your_api_key" \
    -H "Content-Type: application/json" \
    -d '{
      "text": "Write to foo.bar@gmail.com about the 1500 euros.",
      "voice_id": "Bla6SbVMczYnOhfK",
      "output_format": "wav",
      "only_audio": true,
      "json_config": {"rewrite_rules": "en"}
    }' > output.wav
  ```
</CodeGroup>

### Default behavior

When the selected voice has a language associated with it, the API enables that language's rules by default. So a session using an English voice behaves as if you had passed `"rewrite_rules": "en"`. Setting `rewrite_rules` yourself overrides this default.

### Disabling rewriting: `none`

Pass `"rewrite_rules": "none"` to turn all rewrite rules off. Because of the language default described above, this is the only way to get unrewritten text for a voice that has a language: omitting the field enables the voice language's rules, while `"none"` disables them.

```json theme={null}
{
  "json_config": {
    "rewrite_rules": "none"
  }
}
```

With rules disabled, only minimal text normalization is applied before synthesis.

## Language Aliases

For convenience, language aliases are provided that enable all recommended rules for a specific language:

| Alias   | Enabled Rules                                               |
| ------- | ----------------------------------------------------------- |
| `en`    | AlNumEn, NumberEn, EmailEn, UrlEn, CurrencyEn               |
| `fr`    | AlNumFr, NumberFr, EmailFr, UrlFr, CurrencyFr               |
| `fr-be` | DateFrBe, AlNumFr, NumberFrBe, EmailFr, UrlFr, CurrencyFrBe |
| `fr-ch` | DateFrCh, AlNumFr, NumberFrCh, EmailFr, UrlFr, CurrencyFrCh |
| `de`    | AlNumDe, NumberDe, EmailDe, UrlDe, CurrencyDe               |
| `es`    | AlNumEs, NumberEs, EmailEs, UrlEs, CurrencyEs               |
| `pt`    | AlNumPt, NumberPt, EmailPt, UrlPt, CurrencyPt               |

Belgian and Swiss French reuse the `AlNumFr`, `EmailFr` and `UrlFr` rules; only the
date, number and currency rules have locale-specific variants.

## Available Rewrite Rules

### Date Rules

**Rule names:** `DateFrBe`, `DateFrCh`

Numeric dates are handled by the model on their own, so no date rule is enabled for
`en`, `fr`, `de`, `es` or `pt`. Belgian and Swiss French keep a dedicated rule because
their spoken date conventions differ from metropolitan French; both are enabled by the
`fr-be` and `fr-ch` aliases.

### Number Rules

Number rules expand large numbers into word-based representations for better pronunciation. Years (1900-2100) and small numbers (\< 1000) are kept as-is. The Belgian and Swiss rules are the exception: they also rewrite the tens that differ from metropolitan French, so those stay correct below 1000.

**Rule names:** `NumberEn`, `NumberFr`, `NumberFrBe`, `NumberFrCh`, `NumberDe`, `NumberEs`, `NumberPt`

**English examples:**

* `123` → `123` (small numbers unchanged)
* `1234` → `1 thousand 234`
* `1000000` → `1 million`
* `2500000` → `2 million 500 thousand`
* `1002003004` → `1 billion 2 million 3 thousand 4`
* `-4500` → `minus 4 thousand 500`

**French examples:**

* `1234` → `mille 234` (singular form for 1)
* `2234` → `2 mille 234`
* `2000000` → `2 millions`
* `-4500` → `moins 4 mille 500`
* `123456000789` → `123 milliards 456 millions 789`

**Belgian French examples (`NumberFrBe`):**

* `70` → `septante`
* `75` → `septante-cinq`
* `80` → `quatre-vingts` (as in metropolitan French)
* `90` → `nonante`
* `95` → `nonante-cinq`

**Swiss French examples (`NumberFrCh`):**

* `70` → `septante`
* `75` → `septante-cinq`
* `80` → `huitante`
* `85` → `huitante-cinq`
* `90` → `nonante`
* `95` → `nonante-cinq`

Swiss French is the only locale that rewrites 80: `NumberFrBe` keeps quatre-vingts.

**Language-specific separators:**

* **English:** thousand, million, billion
* **French:** mille, million(s), milliard(s)
* **German:** Tausend, Million(en), Milliarde(n)
* **Spanish:** mil, millón/millones, mil millones
* **Portuguese:** mil, milhão/milhões, bilhão/bilhões

### Currency Rules

Gradium expands currency amounts into words using the number expansion and the currency's name in the rule's language: dollars, euros, and pounds in English; euros and livres in French; Euro, Dollar, and Pfund in German, and so on. The symbol can come before or after the amount (`$1500` or `1500$`), and decimal amounts are read with the language's decimal word ("point" in English, "virgule" in French, "Komma" in German).

**Rule names:** `CurrencyEn`, `CurrencyFr`, `CurrencyFrBe`, `CurrencyFrCh`, `CurrencyDe`, `CurrencyEs`, `CurrencyPt`

`CurrencyFrBe` and `CurrencyFrCh` expand the amount with their locale's number rule, so a Swiss session reads `70€` as `septante euros`.

**Examples:**

* `It costs $1500 today.` → `It costs 1 thousand 500 dollars today.` (CurrencyEn)
* `Ça coûte 500€ aujourd'hui.` → `Ça coûte 500 euros aujourd'hui.` (CurrencyFr)

### Email Rules

Email rules spell out email addresses with language-specific words for special characters.

**Rule names:** `EmailEn`, `EmailFr`, `EmailDe`, `EmailEs`, `EmailPt`

**English examples:**

* `foo.bar@gmail.com` → `foo dot bar at gmail dot com`

**French examples:**

* `foo@gmail.com` → `foo arobaze gmail point com`

**Special character translations:**

* `@` → "at" (en), "arobaze" (fr), "at" (de), "arroba" (es), "arroba" (pt)
* `.` → "dot" (en), "point" (fr), "Punkt" (de), "punto" (es), "ponto" (pt)
* `-` → "dash" (en), "tiret" (fr), "Bindestrich" (de), "guión" (es), "hífen" (pt)

### URL Rules

Gradium reads a URL the way a person would dictate it. Abbreviations that aren't real words (the protocol, `www`, two-letter top-level domains like `.uk` or `.fr`) are spelled out letter by letter, recognizable words are kept whole, and the punctuation (`.`, `/`, `-`, `:`) is turned into words in the rule's language: "dot", "slash", "dash", "colon" in English; "point", "slash", "tiret", "deux-points" in French; and so on for German, Spanish, and Portuguese.

**Rule names:** `UrlEn`, `UrlFr`, `UrlDe`, `UrlEs`, `UrlPt`

**Examples:**

* `www.example.com` → `W-W-W dot example dot com` (English)
* `http://sub.domain.co.uk` → `H-T-T-P colon slash slash sub dot domain dot C-O dot U-K` (English)
* `https://www.kyutai.fr` → `H-T-T-P-S deux-points slash slash W-W-W point kyutai point F-R` (French)

### AlNum (Alphanumeric)

**Rule names:** `AlNumEn` (alias `AlNum`), `AlNumFr`, `AlNumDe`, `AlNumEs`, `AlNumPt`

Handles mixed uppercase letters and digits (e.g., license plates, product codes). The language variants control how the digit groups are read out.

**Examples:**

* `AB12CD34!` → `A-B 1-2 C-D 3-4!`

Characters are grouped by type (letters vs. digits) and joined with hyphens within each group.

## Custom Rewrites: Pronunciation Dictionaries

Rewrite rules handle general patterns (numbers, currency amounts, emails, URLs). To rewrite specific words or phrases of your own (brand names, acronyms, domain jargon), use a [pronunciation dictionary](/guides/text-to-speech#pronunciation-dictionaries) instead.

The dictionary is not part of `rewrite_rules` or `json_config`: create it in the Gradium Studio (or via the [pronunciations API](/api-reference/endpoint/list-pronunciations)) and pass its ID as `pronunciation_id` at the top level of the setup message, next to `voice_id`:

```python theme={null}
result = await client.tts(
    setup={
        "voice_id": "Bla6SbVMczYnOhfK",
        "output_format": "wav",
        "pronunciation_id": "bb1ckYhNHCcIJjdK",   # top level, not in json_config
        "json_config": {"rewrite_rules": "en"},   # pattern rules still apply
    },
    text="The text you want to generate.",
)
```

Dictionary entries are applied to the text first, then the pattern rules run on the result. The two combine freely. For example, a dictionary that expands your product's acronym, plus `"en"` rules to read out prices and product codes. Pronunciation dictionaries apply to WebSocket sessions only; REST requests cannot use them, and only the pattern-based `rewrite_rules` are available there.

## Best Practices

1. **Use language aliases** when possible for comprehensive coverage in a single language
2. **Combine specific rules** when you need fine-grained control or multi-language support
3. **Preserve punctuation** - rules preserve trailing punctuation (periods, commas, etc.)
4. **Year detection** - numbers between 1900-2100 are kept as-is and not expanded

## Implementation Notes

* Rules are applied word-by-word to the input text
* Only the first matching rule is applied to each word
* Special characters like quotes, dashes, and brackets are normalized before processing
* Colons (`:`) are handled specially to support URL formats
* When no rules are specified, minimal text normalization is applied
