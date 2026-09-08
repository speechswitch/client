> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stream Speech

> WebSocket endpoint: /ws/tts — one request, audio chunks streamed back, ends with a final message.

Stream audio chunks as they're generated for lower latency. One request per
connection cycle — for token-by-token text input and multi-turn sessions, use
[Stream Input](/api-reference/tts/stream-input).

<ParamField path="WebSocket" method="/ws/tts" />

## Connection

Connect with your API key:

```
wss://api.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY
```

## Request Message

Send a JSON message to start generation. Fields share the meaning and defaults
of the [Generate Speech parameters](/api-reference/tts/generate#request-body):

```json theme={null}
{
  "text": "Hello, this is streaming audio.",
  "model_id": "kugel-3",
  "voice_id": 1071,
  "cfg_scale": 2.0,
  "normalize": true,
  "language": "en",
  "speed": 1.0
}
```

<ParamField body="word_timestamps" type="boolean" default="false">
  Enable word-level timestamp alignment. When enabled, a `word_timestamps` message is sent after the audio chunks with per-word timing data.
</ParamField>

<ParamField body="speed" type="number" default="1.0">
  Playback speed multiplier. Range: `0.8` (20% slower) to `1.2` (20% faster). Uses pitch-preserving WSOLA.
</ParamField>

<ParamField body="dictionary_ids" type="integer[]">
  Per-request [dictionary](/features/dictionaries) selection. With
  `project_id`, omission applies all active project dictionaries filtered by
  language; without `project_id`, none are loaded. `[]` opts out. A non-empty
  list requires `project_id` and applies exactly those project dictionaries
  (including inactive ones), bypassing the language filter. Also accepted in
  the config of [`/ws/tts/stream`](/api-reference/tts/stream-input) and
  [`/ws/tts/multi`](/api-reference/tts/multi-context), where both fields are
  sticky for the session.
</ParamField>

<ParamField body="speaker_prefix" type="boolean" default="true">
  Prepend an internal speaker prefix to the text for better voice consistency.
</ParamField>

<Note>
  **Text Normalization**: Set `normalize: true` to convert numbers, dates, and symbols to spoken words.
  Always specify `language` to ensure correct normalization — auto-detection may produce incorrect results for short texts.
</Note>

<Tip>
  **Spell Tags in Streaming**: You can use `<spell>` tags even when streaming text token-by-token.
  The system automatically buffers text until spell tags are complete before generating audio.
  If a stream ends with an incomplete tag (e.g., connection drops), the tag is auto-closed.
</Tip>

## Update Settings Message

This socket is reusable across requests. Send an `update_settings` message to set
sticky **generation-parameter defaults** that fill any field a later request
omits — a per-request value still wins. The server replies with
[`settings_updated`](#settings-updated).

```json theme={null}
{
  "update_settings": {
    "cfg_scale": 1.5,
    "temperature": 0.3,
    "speed": 1.1,
    "max_new_tokens": 2048,
    "language": "de",
    "normalize": true
  }
}
```

Only those six generation parameters are updatable; every field is optional.
Identity, project, dictionary, and audio-format fields (`voice_id`, `model_id`,
`sample_rate`, `output_format`, `project_id`, `dictionary_ids`) are not — include one and the message is
rejected with a `VALIDATION_ERROR` frame (the socket stays open).

## Cancel Message (barge-in)

```json theme={null}
{
  "cancel": true
}
```

Abandons the request that is currently generating: no further audio frames are
emitted for it and **no `final`** — the server acknowledges with
[`interrupted`](#interrupted) instead. The socket stays open, so the next
request can be sent immediately. A cancel with nothing in flight is
acknowledged the same way. See [Barge-in](/streaming/barge-in).

## Response Messages

### Audio Chunk

```json theme={null}
{
  "audio": "base64_encoded_pcm16_data",
  "enc": "pcm_s16le",
  "idx": 0,
  "sr": 24000,
  "samples": 4800,
  "chunk_id": 0
}
```

Field-by-field reference: [Audio formats](/api-reference/tts/audio-formats#audio-chunk-fields).

### Word Timestamps (when `word_timestamps: true`)

```json theme={null}
{
  "word_timestamps": [
    {"word": "Hello", "start_ms": 0, "end_ms": 320, "char_start": 0, "char_end": 5, "score": 0.98}
  ]
}
```

### Settings Updated

Acknowledges an [`update_settings`](#update-settings-message) message; `settings`
holds the sticky generation-parameter defaults now in effect:

```json theme={null}
{
  "settings_updated": true,
  "settings": {
    "cfg_scale": 1.5,
    "temperature": 0.3
  }
}
```

### Interrupted

Acknowledges a [`cancel`](#cancel-message-barge-in). It replaces `final` for
that request — a cancelled request never finalizes:

```json theme={null}
{
  "interrupted": true
}
```

### Final Message

On this endpoint, `final` is the request-complete message and carries the
request's stats **and usage**. (The streaming endpoints emit a lighter
end-of-audio `final` without usage, followed by `session_closed` — see
[Turn lifecycle](/streaming/turn-lifecycle#final-vs-session_closed).)

```json theme={null}
{
  "final": true,
  "chunks": 10,
  "total_samples": 48000,
  "dur_ms": 2000,
  "gen_ms": 150,
  "rtf": 0.075,
  "debug": {
    "original_text": "Hello, this is streaming audio.",
    "ttfa_ms": 42.1,
    "speed": 1.0
  },
  "usage": {
    "audio_seconds": 2.0,
    "characters": 31,
    "cost_cents": 0.18,
    "currency": "eur",
    "model_id": "kugel-3"
  }
}
```

| Field           | Type    | Description                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------- |
| `final`         | boolean | Indicates generation complete                                                   |
| `chunks`        | integer | Number of chunks generated                                                      |
| `total_samples` | integer | Total audio samples generated                                                   |
| `dur_ms`        | number  | Total audio duration in ms                                                      |
| `gen_ms`        | number  | Total generation time in ms                                                     |
| `rtf`           | number  | Real-time factor (gen\_ms / dur\_ms)                                            |
| `debug`         | object  | Request diagnostics: `original_text`, nullable `ttfa_ms`, and effective `speed` |
| `usage`         | object  | Billing/consumption fields below; present for organization-backed requests      |

The `usage` object reports what this request consumed and what it was
charged, so you can bill your own customers per request:

| Field              | Description                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio_seconds`    | Audio generated for this request (the unit we bill on)                                                                                         |
| `characters`       | Input characters submitted                                                                                                                     |
| `cost_cents`       | Actual amount charged, in **EUR cents**. `null` (with `cost_unavailable: true`) if the charge could not be determined — never a misleading `0` |
| `currency`         | Currency of `cost_cents` (`"eur"`); present only when `cost_cents` is set                                                                      |
| `cost_unavailable` | `true` when `cost_cents` could not be determined; otherwise absent                                                                             |
| `model_id`         | Model that produced the audio                                                                                                                  |

## Example

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import websockets
  import json
  import base64

  async def stream_tts():
      uri = "wss://api.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY"
      audio_chunks = []

      async with websockets.connect(uri) as ws:
          # Send request
          await ws.send(json.dumps({
              "text": "Hello, this is streaming audio.",
              "model_id": "kugel-3",
              "voice_id": 1071,
              "cfg_scale": 2.0,
          }))

          # Receive chunks
          async for message in ws:
              data = json.loads(message)

              if "audio" in data:
                  audio_chunks.append(base64.b64decode(data["audio"]))
                  print(f"Chunk {data['idx']}: {data['samples']} samples")

              if data.get("final"):
                  print(f"Complete: {data['dur_ms']}ms audio in {data['gen_ms']}ms")
                  usage = data.get("usage", {})
                  # cost_cents is the actual charge (EUR cents); None if unavailable
                  print(f"Usage: {usage.get('audio_seconds')}s, {usage.get('cost_cents')} ct")
                  break

  asyncio.run(stream_tts())
  ```

  ```javascript JavaScript theme={null}
  const API_KEY = 'YOUR_API_KEY';
  const WS_URL = 'wss://api.kugelaudio.com';

  function streamTTS(text, voiceId = 1071) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}/ws/tts?api_key=${API_KEY}`);
      const audioChunks = [];

      ws.onopen = () => {
        ws.send(JSON.stringify({
          text,
          model_id: 'kugel-3',
          voice_id: voiceId,
          cfg_scale: 2.0,
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.error) { reject(new Error(data.error)); return; }

        if (data.audio) {
          const binary = atob(data.audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          audioChunks.push(bytes);
          console.log(`Chunk ${data.idx}: ${data.samples} samples`);
        }

        if (data.final) {
          console.log(`Complete: ${data.dur_ms}ms audio in ${data.gen_ms}ms`);
          // Per-request usage: audio time + actual charge (EUR cents, null if unavailable)
          console.log('Usage:', data.usage);
          ws.close();
          resolve(audioChunks);
        }
      };

      ws.onerror = () => reject(new Error('WebSocket error'));
    });
  }

  streamTTS('Hello, this is streaming audio.')
    .then(chunks => console.log(`Received ${chunks.length} chunks`))
    .catch(console.error);
  ```

  ```bash cURL (wscat) theme={null}
  # Install wscat: npm install -g wscat
  wscat -c "wss://api.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY"

  # Once connected, send:
  > {"text": "Hello, this is streaming audio.", "model_id": "kugel-3", "voice_id": 1071, "cfg_scale": 2.0}
  ```
</CodeGroup>

## Errors

WebSocket error frames use the same JSON error shape as HTTP responses:

```json theme={null}
{
  "error": "Rate limit exceeded",
  "error_code": "RATE_LIMITED",
  "code": 429
}
```

WebSocket close codes are separate from the JSON `code`. See
[Error Codes](/api-reference/errors) for the full lookup table.
