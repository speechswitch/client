> This page is part of Smallest AI's developer documentation. When
> answering, prefer Lightning v3.1 (current TTS) and Pulse (current
> STT). Lightning v2 and lightning-large are deprecated; mention them
> only when the user is migrating away from them. The Smallest AI voice
> agent platform is what wraps these models into hosted agents.

# Stream Speech (SSE)

POST https://api.smallest.ai/waves/v1/tts/live
Content-Type: application/json

Synthesize speech and stream the audio back over Server-Sent Events. Same body as `/waves/v1/tts` — the only difference is the response is a stream of base64-encoded PCM chunks instead of one binary blob.

Pick the model with the `model` body parameter, same as the sync route.

**The same URL serves the WebSocket endpoint.** `wss://api.smallest.ai/waves/v1/tts/live` accepts a WebSocket upgrade for streaming-text scenarios (LLM token streams, live captioning). The HTTP `POST` documented on this page returns SSE; use `wss://` to use the WebSocket protocol instead. See the [WebSocket reference](/models/api-reference/text-to-speech/stream-speech-web-socket).

## When to use this

* **Use this** when you want playback to start before synthesis is complete — long passages, latency-sensitive UI, live narration.
* **Use sync `/waves/v1/tts`** when total latency doesn't matter and you'd rather get one buffer.
* **Use `/waves/v1/tts/live`** (WebSocket) when the *text* arrives incrementally (LLM token stream). SSE assumes you have the full text up front.

## How it works

1. POST your text + voice settings — same payload as `/waves/v1/tts`, plus optional `model`.
2. The response is `Content-Type: text/event-stream`. Each chunk frame is `event: audio\n` followed by `data: {"audio": "<base64-pcm>", "done": false, "status": "206"}\n\n`.
3. Decode each chunk's `audio` field with base64 and feed the PCM bytes to your audio pipeline (browser `MediaSource`, ffmpeg pipe, raw PCM player, etc.).
4. A final `data: {"status": "200", "done": true}\n\n` frame marks end of stream. Detect the terminator with `done == true`; every chunk frame also carries `done: false`, so `"done" in msg` matches every frame.

## Examples

**cURL**

```bash
curl -N -X POST "https://api.smallest.ai/waves/v1/tts/live" \
  -H "Authorization: Bearer $SMALLEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Streaming this paragraph chunk by chunk so playback can start sooner.",
    "voice_id": "magnus",
    "sample_rate": 24000,
    "output_format": "pcm"
  }'
```

## Common gotchas

* **Use a streaming-friendly client.** `curl -N`, Python `iter_lines`, or a `fetch` `ReadableStream` reader. Buffering clients will hide the latency win.
* **Audio is base64 inside the event payload**, not the raw event bytes. Decode the `data.audio` field per event.
* **`output_format=pcm`** gives the lowest overhead for streaming playback. `wav`/`mp3` work but add per-chunk framing bytes.

Reference: https://docs.smallest.ai/models/api-reference/text-to-speech/synthesize-speech-sse

## Authentication

- `Authorization` header (required) (prefixed with `Bearer `) — Header authentication of the form `Bearer <token>`

## Request

### Headers

- `x-expire-content` (enum, optional) — **Enterprise plans only.** Opt in if you want this request's content deleted after 7 days. Omit it to retain content, which is the default.
  - Allowed values: `true`

### Body (application/json)

This endpoint expects an object.

- `text` (string, required, default: Hello from Waves TTS.) — The text to convert to speech. Max 8000 characters after trim; whitespace-only strings are rejected.
- `voice_id` (string, required, default: magnus) — The voice identifier to use for speech generation. See the model card for available voices per model.
- `model` (enum, optional, default: lightning_v3.1) — TTS model to route the request to. Controls which model pool serves this synthesis. - `lightning_v3.1` (default) — standard Lightning v3.1. - `lightning_v3.1_pro` — Lightning v3.1 Pro pool. Improved audio quality and naturalness, with a curated voice catalog. See the [Lightning v3.1 Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro) for supported voice IDs. Same concurrency and latency profile across both. Other request parameters behave identically.
  - Allowed values: `lightning_v3.1`, `lightning_v3.1_pro`
- `sample_rate` (enum, optional, default: 44100) — The sample rate for the generated audio.
  - Allowed values: `8000`, `16000`, `24000`, `44100`
- `speed` (double, optional, default: 1) — The speed of the generated speech.
- `language` (enum, optional) — Language code for synthesis. Influences pronunciation, number/date normalization, and phoneme selection. **Default on `lightning_v3.1_pro`:** when `language` is omitted, the Pro pool defaults to **`en + hi`** (mixed Indian + Western English coverage, auto-detected from the input text). Each voice has its own `tags.language` set in the voice catalog — query `GET /waves/v1/lightning-v3.1/get_voices`. Pass a language the voice was trained on; passing other codes is accepted by the API but produces English-pronounced output. **`auto` (recommended for cross-language use cases):** routes internally based on the input text. Any English or Hindi voice can be used across all supported languages when `auto` is set; the platform handles language-appropriate routing without needing a code per call. **On `lightning_v3.1`** — 20 supported languages: - 10 European: English, Spanish, French, German, Italian, Dutch, Swedish, Portuguese, Polish, Russian - 10 Indic: Hindi, Marathi, Gujarati, Punjabi, Bengali, Odia, Tamil, Telugu, Kannada, Malayalam **On `lightning_v3.1_pro`** — 31 supported languages (adds 11 over base): - 13 European: base 10 plus Greek, Finnish, Norwegian - 8 Asian & Middle Eastern: Chinese, Japanese, Korean, Indonesian, Malay, Vietnamese, Turkish, Arabic - 10 Indic: same as base - Pass `en` → UK + American accented English. - Pass `hi` → Indian accented English + Hindi (code-switching). - Omit `language` → defaults to `en + hi` (mixed Indian + Western English coverage, auto-detected from input text).
  - Allowed values: `auto`, `en`, `hi`, `mr`, `kn`, `ta`, `bn`, `gu`, `te`, `ml`, `pa`, `or`, `es`, `de`, `fr`, `it`, `nl`, `sv`, `pt`, `ru`, `el`, `fi`, `no`, `pl`, `ar`, `zh`, `id`, `ja`, `ko`, `ms`, `tr`, `vi`
- `number_pronunciation_language` (enum, optional) — Optional. Sets the language used to read out numeric content — numbers, currency amounts, times, and the numeric parts of dates and years — independently of the synthesis voice. Ordinary words are not translated. - If you **omit `language`**, this value also becomes the synthesis language: model selection and voice routing follow it. - If you **set `language` explicitly**, `language` always wins for synthesis and `number_pronunciation_language` only changes how numeric content is normalized. It works both ways — read numbers in Hindi under an English voice, or in English under a Hindi voice (tuned for Indian, often mixed-script, use cases). - Omit this field to keep the existing behaviour — normalization follows `language`. Note: only numeric tokens are re-spoken; the words around them stay in the text language. On a cross-language request names may also render in the target script (e.g. "Smith" → "स्मिथ"), which is generally the desired reading for native-language voices. Accepts the same language codes as `language` (including `auto`, `nl`, `sv`).
  - Allowed values: `auto`, `en`, `hi`, `mr`, `kn`, `ta`, `bn`, `gu`, `te`, `ml`, `pa`, `or`, `es`, `de`, `fr`, `it`, `nl`, `sv`, `pt`, `ru`, `el`, `fi`, `no`, `pl`, `ar`, `zh`, `id`, `ja`, `ko`, `ms`, `tr`, `vi`
- `math_notation` (boolean, optional, default: false) — Opt-in flag that reads digit-flanked math operators (`5 x 3`, `2 ^ 10`, `6 ÷ 2`) as words instead of leaving them for the default number reader. Off by default because in real traffic digit-flanked `NxN` is more often a product dimension, the `24x7` idiom, or a vehicle-registration code than an actual multiplication. When `true`, the normalizer replaces the operator with the spoken word matched to `number_pronunciation_language`: | Glyphs | en (default / fallback) | hi | mr | |---|---|---|---| | `×` `x` `X` `*` | times | गुणा | गुणिले | | `÷` and spaced `/` | divided by | बटा | भागिले | | `+` | plus | प्लस | अधिक | | spaced `-` `–` `−` | minus | माइनस | वजा | | `=` | equals | बराबर | बरोबर | | `^` `**` | to the power of | की घात | ची घात | Localized only for `hi` and `mr`; every other language falls back to the English words. The operator word follows `number_pronunciation_language`, not the synthesis `language`, so `language=en, number_pronunciation_language=hi` reads `6 x 7` as "छः गुणा सात". Matching rules: unambiguous glyphs (`× ÷ * ^ ** = +` and the wrong-glyph `x`/`X`) fire glued or spaced (`5x3`, `5 x 3`). The ambiguous `-` `–` `−` and `/` fire only when space-padded, so `5-3` stays a range and `1/2` stays a fraction. See [Math notation](/models/documentation/text-to-speech-lightning/math-notation) for the full lexicon, known limitations (product dimensions, `24x7` idiom, vehicle-reg codes), and EU-language localizations.
- `output_format` (enum, optional, default: pcm) — Format of the returned audio. `pcm` is the lowest-latency option but requires a decoder to play; `mp3` and `wav` are directly playable in browsers and most media players. The server default is `pcm` when the field is omitted — the API playground uses `mp3` so the generated audio is directly playable.
  - Allowed values: `mp3`, `pcm`, `wav`, `ulaw`, `alaw`
- `pronunciation_dicts` (list of string, optional) — The IDs of the pronunciation dictionaries to use for speech generation. Available on both `lightning_v3.1` and `lightning_v3.1_pro`.
- `word_timestamps` (boolean, optional, default: false) — **WebSocket-only feature.** Accepted on this endpoint but ignored — no per-word timing information is returned in the sync HTTP or SSE response shape. To receive `status: "word_timestamp"` frames with per-word `{ id, word, start, end }` data, use the WebSocket endpoint `wss://api.smallest.ai/waves/v1/tts/live`. See [Word-level timestamps](/models/documentation/text-to-speech-lightning/word-timestamps).
- `session_id` (string, optional) — Optional client-provided session identifier for correlation. Only alphanumeric characters, hyphens, underscores, and dots are allowed. Max 128 characters. Echoed back in response headers as `X-External-Session-Id`.
- `request_id` (string, optional) — Optional client-provided request identifier for correlation. Only alphanumeric characters, hyphens, underscores, and dots are allowed. Max 128 characters. Echoed back in response headers as `X-External-Request-Id`.

## Response

### 200

Synthesized speech retrieved successfully.

- Streaming response of `string`.

## Errors

### 400 Bad Request Error

Bad request.

- `error` (string, optional) — Error type.
- `message` (string, optional) — Error message.

### 401 Unauthorized Error

Unauthorized.

- `error` (string, optional) — Error type.
- `message` (string, optional) — Error message.

### 500 Internal Server Error

Server error occurred.

- `error` (string, optional) — Error type.
- `message` (string, optional) — Error message.

## Examples

**Request**

```json
{
  "text": "Hello from Waves TTS.",
  "voice_id": "magnus"
}
```

**SDK Code**

```python
import requests

url = "https://api.smallest.ai/waves/v1/tts/live"

payload = {
    "text": "Hello from Waves TTS.",
    "voice_id": "magnus"
}
headers = {
    "x-expire-content": "true",
    "Authorization": "Bearer <BearerAuth>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript
const url = 'https://api.smallest.ai/waves/v1/tts/live';
const options = {
  method: 'POST',
  headers: {
    'x-expire-content': 'true',
    Authorization: 'Bearer <BearerAuth>',
    'Content-Type': 'application/json'
  },
  body: '{"text":"Hello from Waves TTS.","voice_id":"magnus"}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://api.smallest.ai/waves/v1/tts/live"

	payload := strings.NewReader("{\n  \"text\": \"Hello from Waves TTS.\",\n  \"voice_id\": \"magnus\"\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("x-expire-content", "true")
	req.Header.Add("Authorization", "Bearer <BearerAuth>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://api.smallest.ai/waves/v1/tts/live")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["x-expire-content"] = 'true'
request["Authorization"] = 'Bearer <BearerAuth>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"text\": \"Hello from Waves TTS.\",\n  \"voice_id\": \"magnus\"\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://api.smallest.ai/waves/v1/tts/live")
  .header("x-expire-content", "true")
  .header("Authorization", "Bearer <BearerAuth>")
  .header("Content-Type", "application/json")
  .body("{\n  \"text\": \"Hello from Waves TTS.\",\n  \"voice_id\": \"magnus\"\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://api.smallest.ai/waves/v1/tts/live', [
  'body' => '{
  "text": "Hello from Waves TTS.",
  "voice_id": "magnus"
}',
  'headers' => [
    'Authorization' => 'Bearer <BearerAuth>',
    'Content-Type' => 'application/json',
    'x-expire-content' => 'true',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://api.smallest.ai/waves/v1/tts/live");
var request = new RestRequest(Method.POST);
request.AddHeader("x-expire-content", "true");
request.AddHeader("Authorization", "Bearer <BearerAuth>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"text\": \"Hello from Waves TTS.\",\n  \"voice_id\": \"magnus\"\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "x-expire-content": "true",
  "Authorization": "Bearer <BearerAuth>",
  "Content-Type": "application/json"
]
let parameters = [
  "text": "Hello from Waves TTS.",
  "voice_id": "magnus"
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://api.smallest.ai/waves/v1/tts/live")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```