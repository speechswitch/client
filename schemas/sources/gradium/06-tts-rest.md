> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech (REST)

> One-shot synthesis of a complete text block via HTTP POST

Use the REST endpoint when you have a finished text block and want a
single HTTP request, no WebSocket to manage. The response can either
be raw audio bytes (for direct file writes) or a JSON stream that
mirrors the WebSocket protocol.

<Card title="Streaming use case?" icon="waveform-lines" href="/guides/text-to-speech">
  For low-latency synthesis of long or generated text, streaming TTS
  via the SDK gives you audio chunks as they're produced.
</Card>

## Quickstart

`only_audio=true` returns the raw audio bytes directly, easiest for
"text in, file out".

<CodeGroup>
  ```bash cURL theme={null}
  curl -L -X POST https://api.gradium.ai/api/post/speech/tts \
    -H "x-api-key: your_api_key" \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello, world!", "voice_id": "YTpq7expH9539ERJ", "output_format": "wav", "only_audio": true}' \
    > output.wav
  ```

  ```python Python theme={null}
  import requests

  resp = requests.post(
      "https://api.gradium.ai/api/post/speech/tts",
      json={
          "text": "Hello, world!",
          "voice_id": "YTpq7expH9539ERJ",
          "output_format": "wav",
          "only_audio": True,
      },
      headers={"x-api-key": "your_api_key"},
  )
  resp.raise_for_status()
  with open("output.wav", "wb") as f:
      f.write(resp.content)
  ```
</CodeGroup>

## Response modes

The `only_audio` field in the request body picks one of two response
shapes:

* **`only_audio: true`**: the response body is the raw audio in the
  requested `output_format` (WAV, PCM, Opus, …). Save it directly to a
  file or pipe it to a player. The `Content-Type` reflects the format
  (`audio/wav`, `audio/ogg`, `audio/pcm`).
* **`only_audio: false`** (or omitted): the response is a JSON stream
  using the same message format as the WebSocket endpoint, including
  `audio` (base64), `text` (with timestamps), and `error`. Read the
  body line-by-line until it closes.

### Streaming the JSON response

Pass `only_audio: false` and read the body as it arrives. With cURL,
the `-N` (`--no-buffer`) flag prints each line as soon as the server
sends it.

<CodeGroup>
  ```bash cURL theme={null}
  curl -N -L -X POST https://api.gradium.ai/api/post/speech/tts \
    -H "x-api-key: your_api_key" \
    -H "Content-Type: application/json" \
    -d '{"text": "Hello, world!", "voice_id": "YTpq7expH9539ERJ", "output_format": "wav", "only_audio": false}'
  ```

  ```python Python theme={null}
  import base64
  import json

  import requests

  audio_chunks = []
  text_segments = []

  with requests.post(
      "https://api.gradium.ai/api/post/speech/tts",
      json={
          "text": "Hello, world!",
          "voice_id": "YTpq7expH9539ERJ",
          "output_format": "wav",
          "only_audio": False,
      },
      headers={"x-api-key": "your_api_key"},
      stream=True,
  ) as resp:
      resp.raise_for_status()
      for line in resp.iter_lines(decode_unicode=True):
          if not line:
              continue
          msg = json.loads(line)
          if msg["type"] == "audio":
              audio_chunks.append(base64.b64decode(msg["audio"]))
          elif msg["type"] == "text":
              text_segments.append(msg)

  with open("output.wav", "wb") as f:
      f.write(b"".join(audio_chunks))
  ```
</CodeGroup>

For the full request schema, supported output formats, and error
shapes, see the [TTS POST Endpoint reference](/api-reference/endpoint/tts-post).

## Next steps

<CardGroup cols={2}>
  <Card title="TTS POST API reference" icon="code" href="/api-reference/endpoint/tts-post">
    Full request body schema, output formats, error contracts.
  </Card>

  <Card title="Streaming with the SDK" icon="waveform-lines" href="/guides/text-to-speech">
    Chunked audio output, custom voices, flush, timestamps.
  </Card>
</CardGroup>
