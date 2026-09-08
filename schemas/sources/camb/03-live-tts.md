> ## Documentation Index
> Fetch the complete documentation index at: https://docs.camb.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Live TTS (WebSocket)

> Stream text in, receive synthesized speech audio + optional word-level timestamps in real time over a single WebSocket connection.

Bidirectional WebSocket endpoint for real-time text-to-speech. Push text as you have it; receive audio as it's synthesized, in strict segment order. Designed for live captions, narration over streaming LLM output, interactive voice apps — anywhere you want playback to start before the writer is finished writing.

```
wss://client.camb.ai/apis/live-tts/ws
```

Authenticate with your CambAI API key via the `x-api-key` header (or `?api_key=...` query parameter for clients that can't set headers).

## Quickstart

A complete, copy-pasteable client. Connect → configure → stream text → write the audio to a file.

```python expandable theme={null}
import asyncio
import json
import websockets


async def synthesize(api_key: str, text: str, out_path: str = "out.mp3") -> None:
    url = "wss://client.camb.ai/apis/live-tts/ws"
    async with websockets.connect(
        url,
        additional_headers=[("x-api-key", api_key)],
    ) as ws:
        # 1. First frame: session config.
        await ws.send(json.dumps({
            "type": "session.start",
            "voice_id": 6460,
            "language": "en-us",
            "output_format": "mp3",
            "word_timestamps": True,
        }))

        # 2. Server confirms with session.ready.
        ready = json.loads(await ws.recv())
        assert ready["type"] == "session.ready", ready
        print(f"session {ready['session_id']} run_id={ready['run_id']}")

        # 3. Stream text. You can call text.chunk many times; the server
        #    segments based on content (and on a 1s idle flush).
        await ws.send(json.dumps({"type": "text.chunk", "text": text}))
        await ws.send(json.dumps({"type": "text.done"}))

        # 4. Receive ordered audio + json frames until the session ends.
        with open(out_path, "wb") as f:
            async for msg in ws:
                if isinstance(msg, bytes):
                    f.write(msg)
                    continue

                frame = json.loads(msg)
                kind = frame["type"]
                if kind == "segment.start":
                    print(f"  segment {frame['segment_id']}: {frame['text']!r}")
                    for w in frame.get("word_timestamps", []):
                        print(f"    {w['start']:6.2f}s → {w['end']:6.2f}s  {w['word']}")
                elif kind == "segment.skipped":
                    print(f"  ! skipped segment {frame['segment_id']}: {frame['text']!r}")
                elif kind == "session.done":
                    print("done")
                    break
                elif kind == "session.error":
                    raise RuntimeError(frame["error"])


asyncio.run(synthesize(
    api_key="your-camb-api-key",
    text="Hello, world. This is a streaming text-to-speech demo.",
))
```

That's the whole integration surface. Everything below is reference for the four message types you'll exchange.

## Integration in 4 steps

<Steps>
  <Step title="Open the socket with your API key">
    ```python theme={null}
    async with websockets.connect(
        "wss://client.camb.ai/apis/live-tts/ws",
        additional_headers=[("x-api-key", "your-camb-api-key")],
    ) as ws:
        ...
    ```

    Missing or invalid key → server closes with code `4401`.
  </Step>

  <Step title="Send `session.start` as the first frame">
    ```json theme={null}
    {
      "type": "session.start",
      "voice_id": 6460,
      "language": "en-us",
      "output_format": "mp3",
      "word_timestamps": true,
      "idle_timeout": 1.0,

      "enhance_named_entities_pronunciation": false,
      "apply_enhancement": null,
      "enhance_reference_audio_quality": false,
      "maintain_source_accent": false,
      "speaking_rate": null,
      "inference_steps": null
    }
    ```

    `voice_id` is the only required field — everything else has a sensible default. The tuning knobs mirror the regular `POST /tts-stream` API one-for-one (`enhance_named_entities_pronunciation`, `apply_enhancement`, `enhance_reference_audio_quality`, `maintain_source_accent`, `speaking_rate`), so you can port a working `/tts-stream` payload directly. See the full reference at the top of the page for types and defaults.

    Wait for the `session.ready` reply (carries `session_id` and `run_id`). A malformed first frame, forbidden voice, or unsupported language → `session.error` then close `4400`.
  </Step>

  <Step title="Stream text in">
    ```json theme={null}
    {"type": "text.chunk", "text": "Hello, "}
    {"type": "text.chunk", "text": "world."}
    ```

    Push as fast or as slowly as you like. The server segments by content (sentence boundaries), and **idle-flushes after `idle_timeout` seconds of silence** (default `1.0`) — so for live use cases (LLM token stream, transcribed mic input) you don't need to send `text.done` until the session is truly over.

    `idle_timeout` is only a *fallback* flush for trailing fragments without a boundary. **A complete sentence (terminal punctuation, paragraph break, etc.) is flushed immediately — it never waits on `idle_timeout`.** Bump the value on `session.start` (e.g. `2.5`) if your producer routinely stalls *mid*-sentence — slower LLMs, token-level jitter — to avoid splitting one sentence across two segments.

    <Warning>
      **Slow producers fragment sentences.** If your LLM (or other source) is not producing text fast enough to land consecutive chunks within `idle_timeout` (default `1s`), each chunk will be flushed as its own segment — even if together they would have formed a single sentence. The result is choppier audio and prosody that resets at each fragment boundary. Raise `idle_timeout` to cover the worst-case gap between your producer's tokens.
    </Warning>
  </Step>

  <Step title="Read ordered audio + lifecycle frames">
    For each segment N, the server emits, in order:

    ```
    segment.start N → <binary audio chunks> → segment.done N
    ```

    Segment N's frames are completely emitted before any of segment N+1's, even though synthesis runs concurrently behind the scenes. Concatenate the binary frames per `segment_id` and you have playable audio.

    When everything is done you'll receive `session.done`, followed by a clean close.
  </Step>
</Steps>

## Common patterns

### Stream from an LLM

Push tokens straight from the model. Don't call `text.done` — let the idle flush handle in-flight buffering, then close when the LLM is done.

```python theme={null}
async for token in llm_stream():
    await ws.send(json.dumps({"type": "text.chunk", "text": token}))

# LLM finished; flush any tail and end cleanly.
await ws.send(json.dumps({"type": "text.done"}))
```

### Play audio while it's still synthesizing

Hand each segment to your player as soon as `segment.done` arrives:

```python theme={null}
buffers: dict[int, bytearray] = {}
current_segment: int | None = None

async for msg in ws:
    if isinstance(msg, bytes):
        if current_segment is not None:
            buffers.setdefault(current_segment, bytearray()).extend(msg)
        continue

    frame = json.loads(msg)
    if frame["type"] == "segment.start":
        current_segment = frame["segment_id"]
    elif frame["type"] == "segment.done":
        sid = frame["segment_id"]
        player.enqueue(bytes(buffers.pop(sid)))   # play this segment
        current_segment = None
    elif frame["type"] == "session.done":
        break
```

### Recover from a skipped segment

`segment.skipped` means TTS retries (3 by default, exponential backoff) were exhausted for that segment. The session keeps running — re-send the text in a new `text.chunk` if you need the audio:

```python theme={null}
if frame["type"] == "segment.skipped":
    await ws.send(json.dumps({"type": "text.chunk", "text": frame["text"]}))
```

### Word-level timestamps

Set `"word_timestamps": true` in `session.start`. When resolution succeeds, `segment.start` carries a `word_timestamps` array:

```json theme={null}
{
  "type": "segment.start",
  "segment_id": 0,
  "text": "Hello, world.",
  "word_timestamps": [
    {"word": "Hello", "start": 0.04, "end": 0.32},
    {"word": "world", "start": 0.38, "end": 0.71}
  ]
}
```

Word-timestamp failures (timeout, 5xx, network) are silently swallowed; the segment is still delivered without the `word_timestamps` field. Treat it as **best-effort** — don't block playback on it.

## Reference

The AsyncAPI spec above documents every message type and field. Quick lookup:

### Close codes

| Code   | Reason                                                     |
| :----- | :--------------------------------------------------------- |
| `4400` | Bad first frame, forbidden voice, or unsupported language. |
| `4401` | Missing or invalid API key.                                |
| `4402` | Insufficient credits.                                      |

### Auth & billing

* API key auth is identical to the rest of `/apis/*`.
* A `TTS_API` Run is created on `session.start`; its `run_id` is in `session.ready` and can be queried later via the standard run endpoints.
* **Credits are deducted per segment**, immediately before that segment is synthesized. If you run out mid-session, the server emits a single `session.error` and closes with `4402`.

### Voice & language

Voice access uses the same rules as `/tts-stream`. The session is pinned to the `mars-8.1-flash-beta` speech model — see the [streaming TTS docs](/api-reference/endpoint/create-tts-stream) for the supported BCP-47 locales. For best results, supply a reference voice in the same language/accent as `language`.

### Server-side TTS retries

`ConnectionError` / `TimeoutError` / `OSError` / `aiohttp.ClientError` against the underlying TTS engine trigger up to 3 retries per segment with exponential backoff. On exhaustion the segment becomes `segment.skipped` (see *Recover from a skipped segment* above) and the rest of the session continues normally.


## AsyncAPI

````yaml api-reference/websockets/live-tts-asyncapi.json liveTts
id: liveTts
title: Live tts
description: ''
servers:
  - id: production
    protocol: wss
    host: client.camb.ai
    bindings: []
    variables: []
address: /apis/live-tts/ws
parameters: []
bindings: []
operations:
  - &ref_2
    id: clientSend
    title: Client send
    description: Client sends session config + streaming text
    type: send
    messages:
      - &ref_10
        id: SessionStart
        contentType: application/json
        payload:
          - name: Start Session (first frame)
            description: >-
              Must be the very first message sent on the WebSocket. Configures
              the synthesis run.
            type: object
            properties:
              - name: type
                type: string
                description: session.start
                required: true
              - name: voice_id
                type: integer
                description: >-
                  CambAI voice ID. Validated using the same rules as
                  `/tts-stream`.
                required: true
              - name: language
                type: string
                description: >-
                  BCP-47 locale (e.g. `en-us`, `hi-in`, `zh-cn`). Must be
                  supported by `mars-8.1-flash-beta`.
                required: false
              - name: output_format
                type: string
                enumValues:
                  - mp3
                  - wav
                  - flac
                  - aac
                required: false
              - name: word_timestamps
                type: boolean
                description: >-
                  When true, the server includes per-word timing data
                  (`word_timestamps`) on each `segment.start`.
                required: false
              - name: idle_timeout
                type: number
                description: >-
                  Fallback flush, in seconds, for trailing text fragments that
                  don't end in a sentence boundary. Complete sentences (terminal
                  punctuation, paragraph break, etc.) are flushed immediately
                  and never wait on this timer. Bump up (e.g. `2.5`) when the
                  producer stalls *mid*-sentence — slower LLMs, token-level
                  jitter — to avoid splitting a sentence across two segments.
                  Lower it for tighter tail-latency on live captioning / mic
                  input.
                required: false
              - name: enhance_named_entities_pronunciation
                type: boolean
                description: >-
                  If true, improves pronunciation of names, brands, and other
                  named entities. Mirrors `/tts-stream`.
                required: false
              - name: apply_enhancement
                type: boolean
                description: >
                  If true, applies output audio enhancement (loudness,
                  denoising, polish). Defaults to the

                  speech-model's per-engine default when omitted (off for the
                  speed-oriented `mars-flash`

                  and `mars-8.1-flash-beta` models, on otherwise). Mirrors
                  `/tts-stream`

                  `output_configuration.apply_enhancement`.
                required: false
              - name: enhance_reference_audio_quality
                type: boolean
                description: >-
                  If true, removes noise/compression from the reference audio
                  before cloning. Mirrors `/tts-stream`
                  `voice_settings.enhance_reference_audio_quality`.
                required: false
              - name: maintain_source_accent
                type: boolean
                description: >-
                  If true, preserves the accent of the reference voice. Mirrors
                  `/tts-stream` `voice_settings.maintain_source_accent`.
                required: false
              - name: speaking_rate
                type: number
                description: >-
                  Speech pace multiplier (e.g. `1.5`). Mirrors `/tts-stream`
                  `voice_settings.speaking_rate`. Pass-through to the TTS
                  engine.
                required: false
              - name: sample_rate
                type: integer
                description: >-
                  Output sample rate in Hz. Mirrors `/tts-stream`
                  `output_configuration.sample_rate`.
                required: false
              - name: inference_steps
                type: integer
                description: TTS quality/latency knob.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: session.start
              x-parser-schema-id: <anonymous-schema-2>
            voice_id:
              type: integer
              description: >-
                CambAI voice ID. Validated using the same rules as
                `/tts-stream`.
              example: 6460
              x-parser-schema-id: <anonymous-schema-3>
            language:
              type: string
              description: >-
                BCP-47 locale (e.g. `en-us`, `hi-in`, `zh-cn`). Must be
                supported by `mars-8.1-flash-beta`.
              default: en-us
              x-parser-schema-id: <anonymous-schema-4>
            output_format:
              type: string
              enum:
                - mp3
                - wav
                - flac
                - aac
              default: mp3
              x-parser-schema-id: <anonymous-schema-5>
            word_timestamps:
              type: boolean
              description: >-
                When true, the server includes per-word timing data
                (`word_timestamps`) on each `segment.start`.
              default: false
              x-parser-schema-id: <anonymous-schema-6>
            idle_timeout:
              type: number
              format: float
              description: >-
                Fallback flush, in seconds, for trailing text fragments that
                don't end in a sentence boundary. Complete sentences (terminal
                punctuation, paragraph break, etc.) are flushed immediately and
                never wait on this timer. Bump up (e.g. `2.5`) when the producer
                stalls *mid*-sentence — slower LLMs, token-level jitter — to
                avoid splitting a sentence across two segments. Lower it for
                tighter tail-latency on live captioning / mic input.
              default: 1
              x-parser-schema-id: <anonymous-schema-7>
            enhance_named_entities_pronunciation:
              type: boolean
              description: >-
                If true, improves pronunciation of names, brands, and other
                named entities. Mirrors `/tts-stream`.
              default: false
              x-parser-schema-id: <anonymous-schema-8>
            apply_enhancement:
              type: boolean
              nullable: true
              description: >
                If true, applies output audio enhancement (loudness, denoising,
                polish). Defaults to the

                speech-model's per-engine default when omitted (off for the
                speed-oriented `mars-flash`

                and `mars-8.1-flash-beta` models, on otherwise). Mirrors
                `/tts-stream`

                `output_configuration.apply_enhancement`.
              x-parser-schema-id: <anonymous-schema-9>
            enhance_reference_audio_quality:
              type: boolean
              description: >-
                If true, removes noise/compression from the reference audio
                before cloning. Mirrors `/tts-stream`
                `voice_settings.enhance_reference_audio_quality`.
              default: false
              x-parser-schema-id: <anonymous-schema-10>
            maintain_source_accent:
              type: boolean
              description: >-
                If true, preserves the accent of the reference voice. Mirrors
                `/tts-stream` `voice_settings.maintain_source_accent`.
              default: false
              x-parser-schema-id: <anonymous-schema-11>
            speaking_rate:
              type: number
              format: float
              description: >-
                Speech pace multiplier (e.g. `1.5`). Mirrors `/tts-stream`
                `voice_settings.speaking_rate`. Pass-through to the TTS engine.
              nullable: true
              x-parser-schema-id: <anonymous-schema-12>
            sample_rate:
              type: integer
              description: >-
                Output sample rate in Hz. Mirrors `/tts-stream`
                `output_configuration.sample_rate`.
              nullable: true
              x-parser-schema-id: <anonymous-schema-13>
            inference_steps:
              type: integer
              description: TTS quality/latency knob.
              nullable: true
              x-parser-schema-id: <anonymous-schema-14>
          required:
            - type
            - voice_id
          x-parser-schema-id: <anonymous-schema-1>
        title: Start Session (first frame)
        description: >-
          Must be the very first message sent on the WebSocket. Configures the
          synthesis run.
        example: |-
          {
            "type": "<string>",
            "voice_id": 123,
            "language": "<string>",
            "output_format": "<string>",
            "word_timestamps": true,
            "idle_timeout": 123,
            "enhance_named_entities_pronunciation": true,
            "apply_enhancement": true,
            "enhance_reference_audio_quality": true,
            "maintain_source_accent": true,
            "speaking_rate": 123,
            "sample_rate": 123,
            "inference_steps": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SessionStart
      - &ref_11
        id: TextChunk
        contentType: application/json
        payload:
          - name: Append Text
            description: >-
              Push more text into the synthesis buffer. The server segments
              based on content, not chunk boundaries.
            type: object
            properties:
              - name: type
                type: string
                description: text.chunk
                required: true
              - name: text
                type: string
                required: true
              - name: index
                type: integer
                description: Optional informational ordering hint.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: text.chunk
              x-parser-schema-id: <anonymous-schema-16>
            text:
              type: string
              x-parser-schema-id: <anonymous-schema-17>
            index:
              type: integer
              description: Optional informational ordering hint.
              nullable: true
              x-parser-schema-id: <anonymous-schema-18>
          required:
            - type
            - text
          x-parser-schema-id: <anonymous-schema-15>
        title: Append Text
        description: >-
          Push more text into the synthesis buffer. The server segments based on
          content, not chunk boundaries.
        example: |-
          {
            "type": "<string>",
            "text": "<string>",
            "index": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: TextChunk
      - &ref_12
        id: TextDone
        contentType: application/json
        payload:
          - name: End of Input
            description: >-
              Flush whatever is buffered and finish. Optional — the server also
              flushes after `LIVE_TTS_IDLE_FLUSH_SECONDS` (default 1s) of
              silence.
            type: object
            properties:
              - name: type
                type: string
                description: text.done
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: text.done
              x-parser-schema-id: <anonymous-schema-20>
          required:
            - type
          x-parser-schema-id: <anonymous-schema-19>
        title: End of Input
        description: >-
          Flush whatever is buffered and finish. Optional — the server also
          flushes after `LIVE_TTS_IDLE_FLUSH_SECONDS` (default 1s) of silence.
        example: |-
          {
            "type": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: TextDone
    bindings: []
    extensions: &ref_0
      - id: x-parser-unique-object-id
        value: liveTts
  - &ref_1
    id: serverSend
    title: Server send
    description: Server sends ordered segment audio + lifecycle events
    type: receive
    messages:
      - &ref_3
        id: SessionReady
        contentType: application/json
        payload:
          - name: Session Accepted
            description: Sent immediately after `session.start` is accepted.
            type: object
            properties:
              - name: type
                type: string
                description: session.ready
                required: true
              - name: session_id
                type: string
                required: true
              - name: run_id
                type: integer
                description: ID of the `TTS_API` Run created for this session.
                required: true
              - name: config
                type: object
                description: >-
                  Echo of the resolved session configuration (without
                  `reference_audio`).
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: session.ready
              x-parser-schema-id: <anonymous-schema-22>
            session_id:
              type: string
              x-parser-schema-id: <anonymous-schema-23>
            run_id:
              type: integer
              description: ID of the `TTS_API` Run created for this session.
              x-parser-schema-id: <anonymous-schema-24>
            config:
              type: object
              description: >-
                Echo of the resolved session configuration (without
                `reference_audio`).
              x-parser-schema-id: <anonymous-schema-25>
          required:
            - type
            - session_id
            - run_id
            - config
          x-parser-schema-id: <anonymous-schema-21>
        title: Session Accepted
        description: Sent immediately after `session.start` is accepted.
        example: No examples found
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SessionReady
      - &ref_4
        id: SegmentStart
        contentType: application/json
        payload:
          - name: Segment Start
            description: >-
              Marks the beginning of a synthesized segment. Followed by one or
              more binary audio frames and then `segment.done`.
            type: object
            properties:
              - name: type
                type: string
                description: segment.start
                required: true
              - name: segment_id
                type: integer
                required: true
              - name: text
                type: string
                description: The exact text that produced this segment's audio.
                required: true
              - name: word_timestamps
                type: array
                description: >-
                  Per-word timing data. Present only when `word_timestamps=true`
                  was set on `session.start` and resolution succeeded.
                required: false
                properties:
                  - name: word
                    type: string
                    required: true
                  - name: start
                    type: number
                    description: Start time in seconds, relative to the segment.
                    required: true
                  - name: end
                    type: number
                    description: End time in seconds, relative to the segment.
                    required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: segment.start
              x-parser-schema-id: <anonymous-schema-27>
            segment_id:
              type: integer
              x-parser-schema-id: <anonymous-schema-28>
            text:
              type: string
              description: The exact text that produced this segment's audio.
              x-parser-schema-id: <anonymous-schema-29>
            word_timestamps:
              type: array
              nullable: true
              description: >-
                Per-word timing data. Present only when `word_timestamps=true`
                was set on `session.start` and resolution succeeded.
              items:
                type: object
                properties:
                  word:
                    type: string
                    x-parser-schema-id: <anonymous-schema-32>
                  start:
                    type: number
                    format: float
                    description: Start time in seconds, relative to the segment.
                    x-parser-schema-id: <anonymous-schema-33>
                  end:
                    type: number
                    format: float
                    description: End time in seconds, relative to the segment.
                    x-parser-schema-id: <anonymous-schema-34>
                required:
                  - word
                  - start
                  - end
                x-parser-schema-id: <anonymous-schema-31>
              x-parser-schema-id: <anonymous-schema-30>
          required:
            - type
            - segment_id
            - text
          x-parser-schema-id: <anonymous-schema-26>
        title: Segment Start
        description: >-
          Marks the beginning of a synthesized segment. Followed by one or more
          binary audio frames and then `segment.done`.
        example: |-
          {
            "type": "<string>",
            "segment_id": 123,
            "text": "<string>",
            "word_timestamps": {
              "word": "<string>",
              "start": 123,
              "end": 123
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SegmentStart
      - &ref_5
        id: AudioChunk
        contentType: application/octet-stream
        payload:
          - type: string
            format: binary
            x-parser-schema-id: <anonymous-schema-35>
            name: Binary Audio Frame
            description: >-
              Raw audio bytes for the current segment. Up to
              `LIVE_TTS_AUDIO_FRAME_MAX_BYTES` (default 65536) per frame.
        headers: []
        jsonPayloadSchema:
          type: string
          format: binary
          x-parser-schema-id: <anonymous-schema-35>
        title: Binary Audio Frame
        description: >-
          Raw audio bytes for the current segment. Up to
          `LIVE_TTS_AUDIO_FRAME_MAX_BYTES` (default 65536) per frame.
        example: '{}'
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: AudioChunk
      - &ref_6
        id: SegmentDone
        contentType: application/json
        payload:
          - name: Segment Done
            description: All audio for the current segment has been emitted.
            type: object
            properties:
              - name: type
                type: string
                description: segment.done
                required: true
              - name: segment_id
                type: integer
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: segment.done
              x-parser-schema-id: <anonymous-schema-37>
            segment_id:
              type: integer
              x-parser-schema-id: <anonymous-schema-38>
          required:
            - type
            - segment_id
          x-parser-schema-id: <anonymous-schema-36>
        title: Segment Done
        description: All audio for the current segment has been emitted.
        example: |-
          {
            "type": "<string>",
            "segment_id": 123
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SegmentDone
      - &ref_7
        id: SegmentSkipped
        contentType: application/json
        payload:
          - name: Segment Skipped
            description: >-
              TTS retries were exhausted for this segment. The session
              continues; resend the text via `text.chunk` if needed.
            type: object
            properties:
              - name: type
                type: string
                description: segment.skipped
                required: true
              - name: segment_id
                type: integer
                required: true
              - name: text
                type: string
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: segment.skipped
              x-parser-schema-id: <anonymous-schema-40>
            segment_id:
              type: integer
              x-parser-schema-id: <anonymous-schema-41>
            text:
              type: string
              x-parser-schema-id: <anonymous-schema-42>
          required:
            - type
            - segment_id
            - text
          x-parser-schema-id: <anonymous-schema-39>
        title: Segment Skipped
        description: >-
          TTS retries were exhausted for this segment. The session continues;
          resend the text via `text.chunk` if needed.
        example: |-
          {
            "type": "<string>",
            "segment_id": 123,
            "text": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SegmentSkipped
      - &ref_8
        id: SessionDone
        contentType: application/json
        payload:
          - name: Session Done
            description: >-
              Pipeline drained, all segments emitted. Followed by a normal
              close.
            type: object
            properties:
              - name: type
                type: string
                description: session.done
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: session.done
              x-parser-schema-id: <anonymous-schema-44>
          required:
            - type
          x-parser-schema-id: <anonymous-schema-43>
        title: Session Done
        description: Pipeline drained, all segments emitted. Followed by a normal close.
        example: |-
          {
            "type": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SessionDone
      - &ref_9
        id: SessionError
        contentType: application/json
        payload:
          - name: Session Error
            description: >-
              Fatal session-level error. Followed by a close with code 4400 /
              4401 / 4402.
            type: object
            properties:
              - name: type
                type: string
                description: session.error
                required: true
              - name: error
                type: string
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            type:
              type: string
              const: session.error
              x-parser-schema-id: <anonymous-schema-46>
            error:
              type: string
              x-parser-schema-id: <anonymous-schema-47>
          required:
            - type
            - error
          x-parser-schema-id: <anonymous-schema-45>
        title: Session Error
        description: >-
          Fatal session-level error. Followed by a close with code 4400 / 4401 /
          4402.
        example: |-
          {
            "type": "<string>",
            "error": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: SessionError
    bindings: []
    extensions: *ref_0
sendOperations:
  - *ref_1
receiveOperations:
  - *ref_2
sendMessages:
  - *ref_3
  - *ref_4
  - *ref_5
  - *ref_6
  - *ref_7
  - *ref_8
  - *ref_9
receiveMessages:
  - *ref_10
  - *ref_11
  - *ref_12
extensions:
  - id: x-parser-unique-object-id
    value: liveTts
securitySchemes: []

````