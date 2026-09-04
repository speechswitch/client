> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stream Input

> WebSocket endpoint: /ws/tts/stream — token-by-token text input, turn-based sessions for LLM agents.

Stream text input token-by-token for LLM integration. This is the endpoint
behind every SDK streaming session; the conceptual guide is
[Streaming overview](/streaming/overview) and the turn semantics are on
[Turn lifecycle](/streaming/turn-lifecycle).

<ParamField path="WebSocket" method="/ws/tts/stream" />

## Connection

```
wss://api.kugelaudio.com/ws/tts/stream?api_key=YOUR_API_KEY
```

## Protocol

1. **Send config (once):** Initial configuration message. `voice_id`, audio
   format, and the other settings are sticky for the connection — you do **not**
   re-send them on later turns.
2. **Send text:** Text chunks for the current turn as they arrive
3. **Send flush:** Ends the turn — emits any trailing buffered text, streams its
   audio, then closes the turn's session (`session_closed`). The socket stays open.
4. **Next turn:** Send the next turn's text (a fresh config is optional). Repeat.
   To end the whole connection, send `close_socket`.
5. **Receive audio:** Audio chunks as they're generated

<Note>
  **One turn = one backend session.** A turn ends when you send `flush` (or after
  a short idle gap — see below); each turn runs on its own freshly-prefilled
  voice session. A text WebSocket frame is not a hard sentence boundary by
  itself. For token streams, send raw tokens and flush once at the end of the
  turn. If your application sends already-complete phrases without terminal
  punctuation, include `flush: true` on that message or send a separate flush
  message.
</Note>

<Note>
  **Idle turns auto-end after 5 seconds.** If you stream text but never `flush`,
  the server auto-flushes the buffered text after \~5 s of no new text, emits a
  [`warning`](#warning) frame, and ends the turn. WebSocket ping/keep-alive frames
  do **not** reset this — only sending `flush` (or new text) does. End each turn
  with an explicit `flush` for the lowest latency and to avoid the auto-flush.
  Full lifecycle: [Turn lifecycle](/streaming/turn-lifecycle).
</Note>

## Messages

### Config Message

```json theme={null}
{
  "voice_id": 1071,
  "model_id": "kugel-3",
  "cfg_scale": 2.0,
  "temperature": 0.4,
  "sample_rate": 24000,
  "normalize": true,
  "language": "en",
  "word_timestamps": false,
  "flush_timeout_ms": 500,
  "max_buffer_length": 1000,
  "speed": 1.0
}
```

| Field               | Type        | Default | Description                                                                                                                                                                                                                                       |
| ------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`       | number      | unset   | Sampling variance (0.0–1.0). When omitted on this endpoint, the server leaves the engine setting unset; this is distinct from REST and `/ws/tts`, whose request model defaults to `0.4`.                                                          |
| `flush_timeout_ms`  | integer     | `500`   | Auto-flush buffered text after this many ms of no new input.                                                                                                                                                                                      |
| `max_buffer_length` | integer     | `10000` | Maximum characters buffered before a forced flush.                                                                                                                                                                                                |
| `project_id`        | integer     | omitted | Project whose dictionaries should be loaded. Required with a non-empty `dictionary_ids` list.                                                                                                                                                     |
| `dictionary_ids`    | `integer[]` | omitted | Per-request [dictionary](/features/dictionaries) selection, sticky for the session. `[]` = none; a non-empty list selects exactly those project dictionaries (including inactive ones), bypassing the language filter, and requires `project_id`. |

All other fields share the meaning and defaults of the
[Generate Speech parameters](/api-reference/tts/generate#request-body).

To change generation parameters (`cfg_scale`, `temperature`, `speed`,
`max_new_tokens`, `language`, `normalize`) part-way through a connection, send an
[Update Settings message](#update-settings-message) — the change applies to the
next turn.

### Text Message

```json theme={null}
{
  "text": "chunk of text"
}
```

### Flush Message

```json theme={null}
{
  "flush": true
}
```

### Close Message

End the current session; the WebSocket stays open and the server starts a fresh
session on the next config / text message:

```json theme={null}
{
  "close": true
}
```

`{"end_session": true}` is accepted as an alias. To end the session *and* close
the WebSocket connection, send `{"close_socket": true}` instead.

### Cancel Message (barge-in)

```json theme={null}
{
  "cancel": true
}
```

Abandons the current turn immediately: in-flight generation is cancelled and
buffered text dropped. The server acknowledges with `{"interrupted": true}`;
the socket stays open for the next turn. See [Barge-in](/streaming/barge-in).

### Update Settings Message

Change generation parameters mid-connection without reconnecting. Send an
`update_settings` message; the server validates it and replies with a
[`settings_updated`](#settings-updated) acknowledgement carrying the parameters
now in effect.

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

Only these **generation parameters** are updatable — every field is optional, and
a message updates only the fields it carries:

| Field            | Type    | Description                                                        |
| ---------------- | ------- | ------------------------------------------------------------------ |
| `cfg_scale`      | number  | Classifier-free guidance scale; values are clamped to `1.2`–`2.5`. |
| `temperature`    | number  | Sampling variance (0.0–1.0).                                       |
| `max_new_tokens` | integer | Maximum tokens per generation (1–2048).                            |
| `language`       | string  | Language code (e.g. `en`, `de`).                                   |
| `normalize`      | boolean | Enable text normalization.                                         |
| `speed`          | number  | Playback speed multiplier (0.8–1.2).                               |

<Note>
  **Updates take effect on the next turn.** Generation parameters are bound when a
  turn's backend session opens, so a turn already in flight keeps the settings it
  started with — the update applies to the next turn (the next text after a
  `flush`). To apply a change immediately, end the current turn first.
</Note>

Identity, project, dictionary, and audio-format fields (`voice_id`, `model_id`,
`sample_rate`, `output_format`, `project_id`, `dictionary_ids`) are not accepted
inside `update_settings`. Including one is rejected with a
[`VALIDATION_ERROR`](/api-reference/errors) frame (the socket stays open) so an
unsupported change is never silently dropped. To change one between turns, send
it as an ordinary config message before starting the next turn.

## Response Messages

### Generation Started

```json theme={null}
{
  "generation_started": true,
  "chunk_id": 0,
  "text": "Hello, this is streaming."
}
```

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
  ],
  "chunk_id": 0
}
```

### Chunk Complete

```json theme={null}
{
  "chunk_complete": true,
  "chunk_id": 0,
  "audio_seconds": 1.2,
  "gen_ms": 150
}
```

### Interrupted

Sent only in response to `{"cancel": true}` — the turn was cancelled and the
session is ready for the next turn:

```json theme={null}
{
  "interrupted": true
}
```

### Settings Updated

Acknowledges an [`update_settings`](#update-settings-message) message. `settings`
holds the generation parameters now in effect for subsequent turns:

```json theme={null}
{
  "settings_updated": true,
  "settings": {
    "cfg_scale": 1.5,
    "temperature": 0.3,
    "max_new_tokens": 2048,
    "language": "de",
    "normalize": true,
    "speed": 1.1
  }
}
```

### Warning

Non-fatal advisory; the socket stays open. Currently emitted when a turn is
auto-ended after the idle timeout because no `flush` was sent:

```json theme={null}
{
  "warning": "Turn ended after 5s of inactivity. Send {\"flush\": true} to end a turn explicitly — it lowers latency and avoids this auto-flush."
}
```

### Final (End of Audio)

Sent after the **last audio frame** of every gracefully completed turn
(explicit `flush`, `close`, or idle auto-flush), right before
`session_closed`. Once you receive it, no further audio for the turn will
arrive — the equivalent of ElevenLabs' `isFinal`. It is **not** sent after a
`cancel` (barge-in); that path acknowledges with `interrupted` instead.

```json theme={null}
{
  "final": true,
  "total_audio_seconds": 5.4,
  "total_text_chunks": 3,
  "total_audio_chunks": 15
}
```

Use `final` to stop waiting for audio (e.g. to end playback or hang up a
call); use the `session_closed` frame that follows for usage/billing data.

### Session Closed

Sent at the end of every turn (on `flush`, idle auto-flush, or `close`). The
socket stays open for the next turn.

```json theme={null}
{
  "session_closed": true,
  "total_audio_seconds": 5.4,
  "total_text_chunks": 3,
  "total_audio_chunks": 15,
  "usage": {
    "audio_seconds": 5.4,
    "characters": 142,
    "cost_cents": 0.49,
    "currency": "eur",
    "model_id": "kugel-3"
  }
}
```

The `usage` object reports the session's consumed audio time and the actual
amount charged (EUR cents) so you can bill per conversation — same fields as
the [`/ws/tts` final message](/api-reference/tts/stream#final-message).
`cost_cents` is `null` with `cost_unavailable: true` if the charge can't be
determined (never a silent `0`).

## Example

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import websockets
  import json
  import base64

  async def stream_from_llm(llm_tokens):
      uri = "wss://api.kugelaudio.com/ws/tts/stream?api_key=YOUR_API_KEY"

      async with websockets.connect(uri) as ws:
          # Send config
          await ws.send(json.dumps({
              "voice_id": 1071,
              "model_id": "kugel-3",
              "cfg_scale": 2.0,
          }))

          # Stream tokens
          for token in llm_tokens:
              await ws.send(json.dumps({"text": token}))

              # Check for audio (non-blocking)
              try:
                  message = await asyncio.wait_for(ws.recv(), timeout=0.01)
                  data = json.loads(message)
                  if "audio" in data:
                      audio_bytes = base64.b64decode(data["audio"])
                      play_audio(audio_bytes)
              except asyncio.TimeoutError:
                  pass

          # Flush ends the turn (emits session_closed); close_socket ends the connection.
          # For a multi-turn conversation, skip close_socket and just send the next
          # turn's text after session_closed — the config above stays in effect.
          await ws.send(json.dumps({"flush": True}))
          await ws.send(json.dumps({"close_socket": True}))

          # Receive remaining audio
          async for message in ws:
              data = json.loads(message)
              if "audio" in data:
                  audio_bytes = base64.b64decode(data["audio"])
                  play_audio(audio_bytes)
              if data.get("session_closed"):
                  usage = data.get("usage", {})
                  # Per-session usage: audio time + actual charge (EUR cents)
                  print(f"Usage: {usage.get('audio_seconds')}s, {usage.get('cost_cents')} ct")
                  break

  # Example usage
  tokens = ["Hello, ", "this ", "is ", "streaming ", "from ", "an ", "LLM."]
  asyncio.run(stream_from_llm(tokens))
  ```

  ```javascript JavaScript theme={null}
  const API_KEY = 'YOUR_API_KEY';
  const WS_URL = 'wss://api.kugelaudio.com';

  async function streamFromLLM(tokens) {
    const ws = new WebSocket(`${WS_URL}/ws/tts/stream?api_key=${API_KEY}`);

    ws.onopen = () => {
      // Send config
      ws.send(JSON.stringify({
        voice_id: 1071,
        model_id: 'kugel-3',
        cfg_scale: 2.0,
      }));

      // Stream tokens
      for (const token of tokens) {
        ws.send(JSON.stringify({ text: token }));
      }

      // Flush ends the turn (emits session_closed); close_socket ends the connection.
      // For a multi-turn conversation, skip close_socket and send the next turn's
      // text after session_closed — the config above stays in effect.
      ws.send(JSON.stringify({ flush: true }));
      ws.send(JSON.stringify({ close_socket: true }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.audio) {
        const binary = atob(data.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        playAudio(bytes);
      }

      if (data.session_closed) {
        // Per-session usage: audio time + actual charge (EUR cents)
        console.log('Session closed; usage:', data.usage);
        ws.close();
      }
    };
  }

  streamFromLLM(['Hello, ', 'this ', 'is ', 'streaming ', 'from ', 'an ', 'LLM.']);
  ```

  ```bash cURL (wscat) theme={null}
  # Install wscat: npm install -g wscat
  wscat -c "wss://api.kugelaudio.com/ws/tts/stream?api_key=YOUR_API_KEY"

  # 1. Send config
  > {"voice_id": 1071, "model_id": "kugel-3", "cfg_scale": 2.0}

  # 2. Stream tokens
  > {"text": "Hello, "}
  > {"text": "this "}
  > {"text": "is "}
  > {"text": "streaming "}
  > {"text": "from "}
  > {"text": "an "}
  > {"text": "LLM."}

  # 3. Flush and close
  > {"flush": true}
  > {"close": true}
  ```
</CodeGroup>

## Errors

See [Error Codes](/api-reference/errors) for the full TTS error lookup table,
including HTTP status codes, WebSocket close codes, and rate-limit behavior.
