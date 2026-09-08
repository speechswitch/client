> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# WebSocket Lifecycle

> Connection setup, ready messages, input, flush, end-of-stream, multiplexing, and errors

Gradium's real-time APIs use the same WebSocket lifecycle for TTS and
STT:

1. Connect with authentication.
2. Send a `setup` message.
3. Wait for, or lazily receive, `ready`.
4. Send input messages (`text` for TTS, `audio` for STT).
5. Optionally flush buffered input.
6. Send `end_of_stream`.
7. Read output until the server sends `end_of_stream` or `error`.

The Python SDK handles the connection for you, but the lifecycle is the
same if you use the wire protocol directly.

## Endpoints

| Product | WebSocket endpoint                    | Input                     | Output                                                                   |
| ------- | ------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| TTS     | `wss://api.gradium.ai/api/speech/tts` | `text` messages           | `audio`, `text`, `ready`, `end_of_stream`, `error`                       |
| STT     | `wss://api.gradium.ai/api/speech/asr` | `audio`, `flush` messages | `text`, `end_text`, `step`, `flushed`, `ready`, `end_of_stream`, `error` |

## Authentication

Server-side clients should send the API key in the `x-api-key` header:

```bash theme={null}
wscat -c "wss://api.gradium.ai/api/speech/tts" \
  -H "x-api-key: your_api_key"
```

Browser clients should not expose API keys. Generate a short-lived,
single-use token on your server and connect with `?token=...`; see
[Browser WebSockets](/guides/browser-websockets).

## Setup

The first logical message for every request is `setup`.

```json TTS setup theme={null}
{
  "type": "setup",
  "model_name": "default",
  "voice_id": "YTpq7expH9539ERJ",
  "output_format": "pcm"
}
```

```json STT setup theme={null}
{
  "type": "setup",
  "model_name": "default",
  "input_format": "pcm",
  "json_config": {"language": "en", "delay_in_frames": 16}
}
```

Shared setup fields:

| Field             | Applies to | Purpose                                                                                                    |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `model_name`      | TTS, STT   | Model alias. Use `"default"` unless support gives you another value.                                       |
| `json_config`     | TTS, STT   | Advanced model settings. SDK calls accept a dict; raw WebSocket clients may send an object or JSON string. |
| `client_req_id`   | TTS, STT   | Correlates messages when running multiple requests on one socket.                                          |
| `close_ws_on_eos` | TTS, STT   | Defaults to `true`. Set `false` to keep the socket open after a request.                                   |
| `retry_for_s`     | TTS, STT   | Optional setup retry window for transient worker allocation failures.                                      |

TTS-specific setup fields:

| Field              | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `voice_id`         | Voice library or custom voice ID. Prefer this for production.                              |
| `voice`            | Voice name fallback, defaulting to `"default"` when no `voice_id` is provided.             |
| `output_format`    | `wav`, `pcm`, `opus`, `ulaw_8000`, `alaw_8000`, or explicit PCM rates such as `pcm_16000`. |
| `pronunciation_id` | Pronunciation dictionary to apply to this request.                                         |

STT-specific setup fields:

| Field          | Purpose                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| `input_format` | `pcm`, `wav`, `opus`, `ulaw_8000`, `alaw_8000`, or explicit PCM rates such as `pcm_16000`. |

## Ready

After setup, the server sends `ready`. You can wait for this before
sending input, or start sending immediately and let the SDK capture it
while receiving.

```json TTS ready theme={null}
{
  "type": "ready",
  "request_id": "req_...",
  "model_name": "default",
  "model_ext": "resolved-model",
  "sample_rate": 48000,
  "frame_size": 3840,
  "audio_stream_names": [],
  "text_stream_names": []
}
```

```json STT ready theme={null}
{
  "type": "ready",
  "request_id": "req_...",
  "model_name": "default",
  "sample_rate": 24000,
  "frame_size": 1920,
  "delay_in_frames": 16,
  "text_stream_names": []
}
```

Use `request_id` in logs and support tickets. For STT, use
`delay_in_frames` when tuning turn-taking or forced flush behavior.

## Input

TTS accepts text messages:

```json theme={null}
{"type": "text", "text": "Hello, world."}
```

When streaming text from an LLM, split on whitespace or sentence
boundaries. Do not split inside a word or separate punctuation into a
standalone message; the server treats successive text messages as
separate chunks and inserts spacing between them.

STT accepts base64-encoded audio messages:

```json theme={null}
{"type": "audio", "audio": "base64_encoded_audio"}
```

For raw PCM, use 80 ms chunks when possible:

| Format      | Sample rate | Samples per 80 ms | Bytes per chunk |
| ----------- | ----------: | ----------------: | --------------: |
| `pcm`       |      24 kHz |              1920 |            3840 |
| `pcm_8000`  |       8 kHz |               640 |            1280 |
| `pcm_16000` |      16 kHz |              1280 |            2560 |
| `pcm_48000` |      48 kHz |              3840 |            7680 |

## Flush

TTS supports model-level flushing with the `<flush>` tag inside text:

```json theme={null}
{"type": "text", "text": "The answer is ready. <flush>"}
```

Use this when an upstream LLM has finished a thought and you want the
model to emit remaining buffered audio without waiting for more text.
Avoid flushing after every token; small text fragments reduce prosody.

STT supports a `flush` message:

```json theme={null}
{"type": "flush", "flush_id": 1}
```

The server processes outstanding audio and responds with:

```json theme={null}
{"type": "flushed", "flush_id": 1}
```

Use STT flush when your application has detected a turn boundary and
needs any pending transcript before passing the turn to an agent.

## End

Send `end_of_stream` when you are done sending input for a request:

```json theme={null}
{"type": "end_of_stream"}
```

For a single-use connection, the server sends final output and closes
the WebSocket. For a reusable or multiplexed connection, set
`close_ws_on_eos: false` in setup and keep sending new setup/input
groups.

## Multiplexing

To run multiple logical requests over one socket:

1. Set `close_ws_on_eos: false`.
2. Attach a unique `client_req_id` to every message for a request.
3. Route every response by its matching `client_req_id`.

See [Multiplexing](/guides/multiplexing) for full examples.

## Errors

WebSocket errors are sent as JSON and then the socket closes:

```json theme={null}
{"type": "error", "message": "Session not found. Send setup first.", "code": 1002}
```

Treat `error` as terminal for that socket. Open a new connection when
retrying. Common codes:

|   Code | Meaning                                                                                  |
| -----: | ---------------------------------------------------------------------------------------- |
| `1002` | Protocol error, such as sending input before setup or reusing an active `client_req_id`. |
| `1008` | Policy violation, such as invalid auth, missing subscription, or invalid request policy. |
| `1011` | Internal server error or unexpected session failure.                                     |

For REST and WebSocket error contracts, see [Errors](/guides/errors).

## Next steps

<CardGroup cols={2}>
  <Card title="Text-to-Speech WebSocket" icon="waveform-lines" href="/guides/text-to-speech">
    Stream text in and receive audio chunks back.
  </Card>

  <Card title="Speech-to-Text WebSocket" icon="microphone" href="/guides/speech-to-text">
    Stream audio in and receive text, VAD, and flush events.
  </Card>

  <Card title="Multiplexing" icon="layer-group" href="/guides/multiplexing">
    Run several logical requests on one WebSocket.
  </Card>

  <Card title="Browser WebSockets" icon="browser" href="/guides/browser-websockets">
    Use short-lived tokens without exposing API keys.
  </Card>
</CardGroup>
