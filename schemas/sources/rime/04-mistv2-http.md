> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Streaming HTTP

> Mist v2 streaming HTTP endpoint.

The Rime API authenticates every request with a bearer token in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`. See [API authentication](/docs/api-authentication) for how to create a key.

The streaming endpoint returns audio bytes in the format specified by the `Accept` header.

## Audio formats

Set the `Accept` header to one of the following values:

| Format      | Accept Header | Default Sampling Rate | Notes                                       |
| ----------- | ------------- | --------------------- | ------------------------------------------- |
| MP3         | `audio/mpeg`  | 22050                 |                                             |
| PCM         | `audio/L16`   | 16000                 | Headerless 16-bit little-endian linear PCM. |
| G.711 μ-law | `audio/PCMU`  | 8000                  | Headerless stream of audio bytes.           |

### Deprecated aliases

Still accepted for backwards compatibility; new code should use the RFC types above.

| Deprecated      | Use instead  |
| --------------- | ------------ |
| `audio/mp3`     | `audio/mpeg` |
| `audio/pcm`     | `audio/L16`  |
| `audio/x-mulaw` | `audio/PCMU` |

## Variable parameters

<ParamField body="speaker" type="string" required>
  Must be a voice from the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="text" type="string" required>
  The text you'd like spoken. Character limit per request is 1,000 via the API and in the dashboard UI.
</ParamField>

<ParamField body="modelId" type="string">
  Set to `mistv2`.
</ParamField>

<ParamField body="lang" type="string" default="eng">
  If provided, the language must match the language spoken by the selected speaker. Verify the pairing in the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="pauseBetweenBrackets" type="bool" default="false">
  When set to true, adds pauses between words enclosed in angle brackets. The number inside the brackets specifies the pause duration in milliseconds. <br />
  Example: "Hi. \<200> I'd love to have a conversation with you." adds a 200ms pause between the first and second sentences.
</ParamField>

<ParamField body="phonemizeBetweenBrackets" type="bool" default="false">
  When set to true, you can specify the phonemes for a word enclosed in curly brackets. <br />
  Example: "\{h'El.o} World" will pronounce "Hello" as expected. Learn more about <a href="/docs/custom-pronunciation">custom pronunciation</a>.
</ParamField>

<ParamField body="inlineSpeedAlpha" type="string">
  Comma-separated list of speed values applied to words in square brackets. Values \< 1.0 speed up speech, > 1.0 slow it down.
  Example: "This is \[slow] and \[fast]", use "3, 0.5" to make "slow" slower and "fast" faster.
</ParamField>

<ParamField body="samplingRate" type="int">
  The value, if provided, must be between 4000 and 44100. Default depends on format (see table above).
</ParamField>

<ParamField body="speedAlpha" type="float" default="1.0">
  Adjusts the speed of speech. Lower than 1.0 is faster and higher than 1.0 is slower.

  *Note: this is the legacy Mist v2 convention. Coda and Mist v3 invert it; for those, higher than 1.0 is faster.*
</ParamField>

<ParamField body="noTextNormalization" type="bool" default="false">
  **mist/mistv2 only.** Skips text normalization of the input text prior to synthesizing audio. This will reduce latency at the cost of some possible mispronunciation of digits and abbreviations.
</ParamField>

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://users.rime.ai/v1/rime-tts \
    --header 'Accept: audio/mpeg' \
    --header 'Authorization: Bearer YOUR_API_KEY' \
    --header 'Content-Type: application/json' \
    --output output.mp3 \
    --fail \
    --data '{
    "text": "Hello from Rime!",
    "modelId": "mistv2",
    "speaker": "astra",
    "lang": "eng",
    "samplingRate": 22050,
    "speedAlpha": 1.0
  }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://users.rime.ai/v1/rime-tts"

  payload = {
      "speaker": "astra",
      "text": "Hello from Rime!",
      "modelId": "mistv2",
      "lang": "eng",
      "samplingRate": 22050,
      "speedAlpha": 1.0
  }
  headers = {
      "Accept": "audio/mpeg",
      "Authorization": "Bearer YOUR_API_KEY",
      "Content-Type": "application/json"
  }

  with requests.post(url, headers=headers, json=payload, stream=True) as response:
      response.raise_for_status()
      with open("output.mp3", "wb") as f:
          for chunk in response.iter_content(chunk_size=4096):
              if chunk:
                  f.write(chunk)
  ```

  ```javascript JavaScript theme={null}
  const options = {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      Authorization: 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: '{"speaker":"astra","text":"Hello from Rime!","modelId":"mistv2","lang":"eng","samplingRate":22050,"speedAlpha":1.0}'
  };

  fetch('https://users.rime.ai/v1/rime-tts', options)
    .then(response => response.arrayBuffer())
    .then(buffer => {
      require("fs").writeFileSync("output.mp3", Buffer.from(buffer));
      console.log("Audio saved to output.mp3");
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
    CURLOPT_POSTFIELDS => "{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"mistv2\",\n  \"lang\": \"eng\",\n  \"samplingRate\": 22050,\n  \"speedAlpha\": 1.0\n}",
    CURLOPT_HTTPHEADER => [
      "Accept: audio/mpeg",
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

    payload := strings.NewReader("{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"mistv2\",\n  \"lang\": \"eng\",\n  \"samplingRate\": 22050,\n  \"speedAlpha\": 1.0\n}")

    req, _ := http.NewRequest("POST", url, payload)

    req.Header.Add("Accept", "audio/mpeg")
    req.Header.Add("Authorization", "Bearer YOUR_API_KEY")
    req.Header.Add("Content-Type", "application/json")

    res, _ := http.DefaultClient.Do(req)

    defer res.Body.Close()
    body, _ := io.ReadAll(res.Body)

    _ = os.WriteFile("output.mp3", body, 0644)
  }
  ```

  ```java Java theme={null}
  HttpResponse<String> response = Unirest.post("https://users.rime.ai/v1/rime-tts")
    .header("Accept", "audio/mpeg")
    .header("Authorization", "Bearer YOUR_API_KEY")
    .header("Content-Type", "application/json")
    .body("{\n  \"speaker\": \"astra\",\n  \"text\": \"Hello from Rime!\",\n  \"modelId\": \"mistv2\",\n  \"lang\": \"eng\",\n  \"samplingRate\": 22050,\n  \"speedAlpha\": 1.0\n}")
    .asString();
  ```
</RequestExample>
