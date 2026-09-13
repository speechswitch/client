> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Speed, Pause, Pronunciation

**This page covers Aura-2 (`/v1/speak`) controls.** Flux TTS (`/v2/speak`) supports `speed` (`0.5`–`1.5` in `0.05` steps) and beta [Expressivity](/docs/tts-expressivity); pause and pronunciation are coming soon.

Aura-2 Controls enable fine-grained adjustments to speech output, allowing you to modify speaking speed and override pronunciation for specific words. These controls are designed for enterprise use cases requiring precise voice quality for industry-specific terminology, brand names, and complex content.

## Availability

| Control               | [REST](/reference/text-to-speech/speak-request) | [WebSocket](/reference/text-to-speech/speak-streaming) | Languages                  |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------ | -------------------------- |
| Speed control         | Yes                                             | Yes                                                    | English (en), Spanish (es) |
| Pronunciation control | Yes                                             | Yes                                                    | English (en), Spanish (es) |

## Speed control

Adjust the speaking rate of generated audio. Speed control modifies the pace of speech while maintaining natural prosody and voice quality.

### Parameters

| Parameter | Location | Type  | Default | Range         | Description              |
| --------- | -------- | ----- | ------- | ------------- | ------------------------ |
| `speed`   | query    | float | `1.0`   | `0.7` - `1.5` | Speaking rate multiplier |

For Spanish voices, the recommended speed range is `0.9` - `1.5`. Values below `0.9` may introduce disfluencies.

### Example request

```bash
curl --request POST \
     --header "Content-Type: application/json" \
     --header "Authorization: Token DEEPGRAM_API_KEY" \
     --output your_output_file.mp3 \
     --data '{"text":"Hello, how can I help you today?"}' \
     --url "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&speed=0.9"
```

### Speed values

| Value | Effect       | Use Case                                           |
| ----- | ------------ | -------------------------------------------------- |
| `0.7` | 30% slower   | Language learning, accessibility, legal compliance |
| `0.8` | 20% slower   | Complex instructions, elderly users                |
| `0.9` | 10% slower   | Clear explanations, training content               |
| `1.0` | Normal speed | Default conversational pace                        |
| `1.1` | 10% faster   | Efficient notifications                            |
| `1.2` | 20% faster   | Quick alerts, time-sensitive content               |
| `1.5` | 50% faster   | Rapid playback, content preview                    |

Speed values outside the 0.7x–1.5x range will return an error.

## Pronunciation control

Override the default pronunciation of specific words using International Phonetic Alphabet (IPA) notation.

### Syntax

Pronunciation overrides are specified inline within the text using escaped JSON objects:

```text
\{"word": "dupilumab", "pronounce": "duːˈpɪljuːmæb"\}
```

Where:

* `word` is the original text (used for billing and display)
* `pronounce` is the IPA phonetic transcription
* Curly braces must be escaped with backslashes (`\{` and `\}`)

### Example request

```bash
curl -X POST "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&speed=0.8" \
     -H "Authorization: token DEEPGRAM_API_KEY" \
     -H "Content-Type: application/json" \
     --output your_output_file.mp3 \
     -d '{"text": "Take \\{\"word\": \"Azathioprine\", \"pronounce\": \"æzəˈθaɪəpriːn\"\\} twice daily with \\{\"word\": \"dupilumab\", \"pronounce\": \"duːˈpɪljuːmæb\"\\}."}'
```

The curly braces must be escaped with `\\{` and `\\}` in the cURL command.

### Common use cases

| Category      | Word         | IPA             | Spoken As              |
| ------------- | ------------ | --------------- | ---------------------- |
| Medical       | dupilumab    | `duːˈpɪljuːmæb` | "doo-PIL-yoo-mab"      |
| Medical       | azathioprine | `æzəˈθaɪəpriːn` | "az-uh-THIGH-oh-preen" |
| Brand         | Hermès       | `ɛərˈmɛz`       | "air-MEZ"              |
| Personal name | Nguyen       | `ˈwɪn`          | "win"                  |
| Technical     | SQL          | `ˈsiːkwəl`      | "sequel"               |

### Sourcing IPA transcriptions

A few rules of thumb for producing IPA for your own vocabulary:

* **Short lists (\<20 words):** generate with an LLM and validate by ear.
* **Longer lists:** use authoritative dictionaries that publish IPA directly:
  * [Cambridge Dictionary](https://dictionary.cambridge.org/)
  * [Collins Dictionary](https://www.collinsdictionary.com/)
  * [Oxford English Dictionary](https://www.oed.com/?tl=true)

**Best practices:**

* **Always validate by ear.** IPA that looks correct on the page can still sound off when synthesized — listen to the output before shipping.
* **Match the dialect.** UK and US pronunciations differ (e.g., *schedule*, *aluminum*). Make sure the IPA you choose matches the voice and audience you're targeting.

### Validation rules

| Rule                           | Limit                                                     |
| ------------------------------ | --------------------------------------------------------- |
| Max pronunciations per request | 500                                                       |
| Max IPA string length          | 128 characters                                            |
| IPA length ratio               | Cannot exceed 10x the source word length (min floor = 15) |
| Max input text length          | 2000 characters                                           |

## Combining controls

Speed and pronunciation controls can be used together in the same request.

### Healthcare example

**`Python`**

```python Python
from deepgram import DeepgramClient
from deepgram.core.request_options import RequestOptions

client = DeepgramClient(api_key="YOUR_API_KEY")

# Speed control via request_options
request_opts = RequestOptions(additional_query_parameters={"speed": "0.8"})

# Inline IPA replacements with escaped curly braces
text = r'Take \{"word": "Azathioprine", "pronounce": "æzəˈθaɪəpriːn"\} twice daily with \{"word": "dupilumab", "pronounce": "duːˈpɪljuːmæb"\}.'

response = client.speak.v1.audio.generate(
    text=text,
    model="aura-2-thalia-en",
    encoding="mp3",
    request_options=request_opts
)

audio_bytes = b"".join(response)
with open("medical_instructions.mp3", "wb") as f:
    f.write(audio_bytes)
```

**`Java`**

```java Java
import com.deepgram.DeepgramClient;
import com.deepgram.resources.speak.v1.audio.requests.SpeakV1Request;
import com.deepgram.core.RequestOptions;

import java.io.InputStream;
import java.io.FileOutputStream;
import java.util.Map;

DeepgramClient client = DeepgramClient.builder().build();

// Inline IPA replacements with escaped curly braces
String text = "Take \\{\"word\": \"Azathioprine\", \"pronounce\": \"æzəˈθaɪəpriːn\"\\} twice daily with \\{\"word\": \"dupilumab\", \"pronounce\": \"duːˈpɪljuːmæb\"\\}.";

// Speed control via additional query parameters
RequestOptions requestOpts = RequestOptions.builder()
    .additionalQueryParameters(Map.of("speed", "0.8"))
    .build();

InputStream audioStream = client.speak().v1().audio().generate(
    SpeakV1Request.builder()
        .text(text)
        .model("aura-2-thalia-en")
        .encoding("mp3")
        .build(),
    requestOpts
);

try (FileOutputStream fos = new FileOutputStream("medical_instructions.mp3")) {
    audioStream.transferTo(fos);
}
```

**`cURL`**

```curl cURL
curl -X POST "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&speed=0.8" \
     -H "Authorization: token DEEPGRAM_API_KEY" \
     -H "Content-Type: application/json" \
     --output medical_instructions.mp3 \
     -d '{"text": "Take \\{\"word\": \"Azathioprine\", \"pronounce\": \"æzəˈθaɪəpriːn\"\\} twice daily with \\{\"word\": \"dupilumab\", \"pronounce\": \"duːˈpɪljuːmæb\"\\}."}'
```

Use raw string (`r'...'`) with escaped braces `\{` and `\}` for pronunciation control in Python.

### Brand consistency example

**`Python`**

```python Python
from deepgram import DeepgramClient

client = DeepgramClient(api_key="YOUR_API_KEY")

# Ensure consistent brand pronunciation with escaped braces
text = 'Visit \\{"word": "Hermès", "pronounce": "ɛərˈmɛz"\\} for the latest collection.'

response = client.speak.v1.audio.generate(
    text=text,
    model="aura-2-thalia-en",
    encoding="mp3"
)

audio_bytes = b"".join(response)
with open("brand_pronunciation.mp3", "wb") as f:
    f.write(audio_bytes)
```

**`Java`**

```java Java
import com.deepgram.DeepgramClient;
import com.deepgram.resources.speak.v1.audio.requests.SpeakV1Request;

import java.io.InputStream;
import java.io.FileOutputStream;

DeepgramClient client = DeepgramClient.builder().build();

// Ensure consistent brand pronunciation with escaped braces
String text = "Visit \\{\"word\": \"Hermès\", \"pronounce\": \"ɛərˈmɛz\"\\} for the latest collection.";

InputStream audioStream = client.speak().v1().audio().generate(
    SpeakV1Request.builder()
        .text(text)
        .model("aura-2-thalia-en")
        .encoding("mp3")
        .build()
);

try (FileOutputStream fos = new FileOutputStream("brand_pronunciation.mp3")) {
    audioStream.transferTo(fos);
}
```

## IPA reference

### Vowels (American English)

| Symbol | Example  | As in  |
| ------ | -------- | ------ |
| `iː`   | /biːt/   | beat   |
| `ɪ`    | /bɪt/    | bit    |
| `eɪ`   | /beɪt/   | bait   |
| `ɛ`    | /bɛt/    | bet    |
| `æ`    | /bæt/    | bat    |
| `ɑː`   | /fɑːðər/ | father |
| `ɔː`   | /kɔːt/   | caught |
| `oʊ`   | /boʊt/   | boat   |
| `ʊ`    | /pʊt/    | put    |
| `uː`   | /buːt/   | boot   |
| `ʌ`    | /kʌt/    | cut    |
| `ə`    | /əˈbaʊt/ | about  |

### Consonants

| Symbol | Example  | As in  |
| ------ | -------- | ------ |
| `p`    | /pɪn/    | pin    |
| `b`    | /bɪn/    | bin    |
| `t`    | /tɪn/    | tin    |
| `d`    | /dɪn/    | din    |
| `k`    | /kæt/    | cat    |
| `ɡ`    | /ɡɛt/    | get    |
| `f`    | /fɪn/    | fin    |
| `v`    | /væn/    | van    |
| `θ`    | /θɪŋk/   | think  |
| `ð`    | /ðæt/    | that   |
| `s`    | /sɪt/    | sit    |
| `z`    | /zɪp/    | zip    |
| `ʃ`    | /ʃɪp/    | ship   |
| `ʒ`    | /ˈvɪʒən/ | vision |
| `h`    | /hæt/    | hat    |
| `tʃ`   | /tʃɪp/   | chip   |
| `dʒ`   | /dʒʌmp/  | jump   |
| `m`    | /mæn/    | man    |
| `n`    | /nɛt/    | net    |
| `ŋ`    | /sɪŋ/    | sing   |
| `l`    | /lɛt/    | let    |
| `r`    | /rɛd/    | red    |
| `w`    | /wɪn/    | win    |
| `j`    | /jɛs/    | yes    |

### Stress markers

| Symbol | Meaning          | Example                         |
| ------ | ---------------- | ------------------------------- |
| `ˈ`    | Primary stress   | /ˈæp.əl/ (apple)                |
| `ˌ`    | Secondary stress | /ˌɪn.fərˈmeɪ.ʃən/ (information) |

## Billing

| Control       | Billing behavior                                    |
| ------------- | --------------------------------------------------- |
| Speed         | Not billed - adjusting rate doesn't affect billing  |
| Pronunciation | Billed by underlying word - IPA input is not billed |

**Example**: `Hello, \{"word": "Mr.", "pronounce": "ˈmɪstɚ"\} Bond.` is billed as `Hello, Mr. Bond.` (16 characters)

## Response headers

```text
HTTP/1.1 200 OK
content-type: audio/mpeg
dg-request-id: req_xyz789
dg-model-name: aura-2-thalia-en
dg-char-count: 47
dg-pronunciations-applied: 2
dg-speed-used: 0.8
```

| Header                      | Description                               |
| --------------------------- | ----------------------------------------- |
| `dg-pronunciations-applied` | Number of pronunciation overrides applied |
| `dg-speed-used`             | Effective speaking rate used              |
| `dg-pronunciation-warnings` | Non-fatal warnings for invalid IPA        |

## Error handling

### Speed out of range

```json
{"err_code": "speed_out_of_range", "err_msg": "Speed must be between 0.7 and 1.5"}
```

### Invalid pronunciation

```json
{"err_code": "pronunciation_invalid", "err_msg": "Invalid IPA notation for 'azathioprine'"}
```

## Limits

| Limit                          | Value           |
| ------------------------------ | --------------- |
| Max input text length          | 2000 characters |
| Speed range                    | 0.7 - 1.5       |
| Max pronunciations per request | 500             |
| Max IPA string length          | 128 characters  |