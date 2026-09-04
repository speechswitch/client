> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Streaming HTTP

> Coda streaming HTTP endpoint: synthesize speech with Rime's flagship model and stream audio back.

The Rime API authenticates every request with a bearer token in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`. See [API authentication](/docs/api-authentication) for how to create a key.

The streaming endpoint returns audio bytes in the format specified by the `Accept` header.

## Audio formats

Set the `Accept` header to one of the following values:

| Format      | Accept Header            | Notes                                                                                                      |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Opus (WebM) | `audio/webm;codecs=opus` | Recommended. Smaller files than MP3 at comparable quality. WebM streams natively in browsers.              |
| Opus (OGG)  | `audio/ogg;codecs=opus`  | Opus in an OGG container. Smaller files than MP3 at comparable quality.                                    |
| MP3         | `audio/mpeg`             | Lower compression rate than Opus. Highest compatibility across devices and players.                        |
| WAV         | `audio/wav`              | Uncompressed. RIFF WAVE header with 16-bit little-endian linear PCM samples. Streams natively in browsers. |
| PCM         | `audio/L16`              | Headerless 16-bit little-endian linear PCM.                                                                |
| G.711 μ-law | `audio/PCMU`             | Headerless stream of audio bytes.                                                                          |

### Deprecated aliases

Still accepted for backwards compatibility; new code should use the RFC types above.

| Deprecated      | Use instead  |
| --------------- | ------------ |
| `audio/mp3`     | `audio/mpeg` |
| `audio/pcm`     | `audio/L16`  |
| `audio/x-mulaw` | `audio/PCMU` |

## Variable parameters

<ParamField body="speaker" type="string" required>
  Must be a voice available on coda. See the <a href="/docs/voices">voice catalog</a>.
</ParamField>

<ParamField body="text" type="string" required>
  The text you'd like spoken. The API accepts up to 1,000 characters per request.
</ParamField>

<ParamField body="modelId" type="string">
  Set to `coda` to select the Coda voice lineup.
</ParamField>

<ParamField body="lang" type="string" default="en">
  If provided, the language must match the language spoken by the provided speaker. Pass a BCP 47 language tag:

  | Tag  | Language   |
  | ---- | ---------- |
  | `en` | English    |
  | `es` | Spanish    |
  | `fr` | French     |
  | `pt` | Portuguese |
  | `de` | German     |
  | `ja` | Japanese   |
  | `ar` | Arabic     |
  | `hi` | Hindi      |
  | `it` | Italian    |

  The 3-letter ISO 639-2 codes that older integrations send (`eng`, `spa`, `fra`, `por`, `ger`, `jpn`, `ara`, `hin`, `ita`) remain accepted, and will stay accepted.

  See <a href="/docs/voices">the voices documentation</a> for which speakers support each language.
</ParamField>

<ParamField body="samplingRate" type="number" default="24000">
  The sampling rate (Hz).
</ParamField>

<ParamField body="timeScaleFactor" type="number" default="1.0">
  The time scaling factor. Accepted range is 0.4 to 2.5; values outside it are clamped without an error.

  A value above 1.0 slows down the audio, a value below 1.0 speeds up the audio.
</ParamField>

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://users.rime.ai/v1/rime-tts \
    --header 'Accept: audio/webm;codecs=opus' \
    --header 'Authorization: Bearer YOUR_API_KEY' \
    --header 'Content-Type: application/json' \
    --output output.webm \
    --fail \
    --data '{
    "text": "Hello from Rime!",
    "modelId": "coda",
    "speaker": "astra",
    "lang": "en",
    "samplingRate": 24000
  }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://users.rime.ai/v1/rime-tts"

  payload = {
      "speaker": "astra",
      "text": "Hello from Rime!",
      "modelId": "coda",
      "samplingRate": 24000
  }
  headers = {
      "Accept": "audio/webm;codecs=opus",
      "Authorization": "Bearer YOUR_API_KEY",
      "Content-Type": "application/json"
  }

  with requests.post(url, headers=headers, json=payload, stream=True) as response:
      response.raise_for_status()
      with open("output.webm", "wb") as f:
          for chunk in response.iter_content(chunk_size=4096):
              if chunk:
                  f.write(chunk)
  ```

  ```javascript JavaScript theme={null}
  const fs = require("fs");

  const options = {
    method: 'POST',
    headers: {
      Accept: 'audio/webm;codecs=opus',
      Authorization: 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: '{"speaker":"astra","text":"Hello from Rime!","modelId":"coda","samplingRate":24000}'
  };

  fetch('https://users.rime.ai/v1/rime-tts', options)
    .then(response => response.arrayBuffer())
    .then(buffer => {
      fs.writeFileSync("output.webm", Buffer.from(buffer));
      console.log("Audio saved to output.webm");
    })
    .catch(err => console.error(err));
  ```

  ```php PHP theme={null}
  <?php

  $curl = curl_init();

  curl_setopt_array($curl, [
    CURLOPT_URL => "https://users.rime.ai/v1/rime-tts",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_ENCODING => "",
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_CUSTOMREQUEST => "POST",
    CURLOPT_POSTFIELDS => "{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"coda\",\n  \"samplingRate\": 24000\n}",
    CURLOPT_HTTPHEADER => [
      "Accept: audio/webm;codecs=opus",
      "Authorization: Bearer YOUR_API_KEY",
      "Content-Type: application/json"
    ],
  ]);

  $response = curl_exec($curl);
  $err = curl_error($curl);

  curl_close($curl);

  if ($err) {
    echo "cURL Error #:" . $err;
  } else {
    echo $response;
  }
  ```

  ```go Go theme={null}
  package main

  import (
    "io"
    "net/http"
    "os"
    "strings"
  )

  func main() {

    url := "https://users.rime.ai/v1/rime-tts"

    payload := strings.NewReader("{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"coda\",\n  \"samplingRate\": 24000\n}")

    req, _ := http.NewRequest("POST", url, payload)

    req.Header.Add("Accept", "audio/webm;codecs=opus")
    req.Header.Add("Authorization", "Bearer YOUR_API_KEY")
    req.Header.Add("Content-Type", "application/json")

    res, _ := http.DefaultClient.Do(req)

    defer res.Body.Close()
    body, _ := io.ReadAll(res.Body)

    _ = os.WriteFile("output.webm", body, 0644)
  }
  ```

  ```java Java theme={null}
  HttpResponse<byte[]> response = Unirest.post("https://users.rime.ai/v1/rime-tts")
    .header("Accept", "audio/webm;codecs=opus")
    .header("Authorization", "Bearer YOUR_API_KEY")
    .header("Content-Type", "application/json")
    .body("{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"coda\",\n  \"samplingRate\": 24000\n}")
    .asBytes();
  Files.write(Paths.get("output.webm"), response.getBody());
  ```
</RequestExample>
