> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech (WebSocket)

> Convert text to natural-sounding speech via the Gradium SDK and WebSocket

The Gradium Text-to-Speech model produces high-quality, natural speech
with low first-byte latency. This guide covers synthesis via the
Python SDK, including streaming output, custom voices, in-text control
tags, and pronunciation dictionaries.

<Card title="One-shot from a finished text block?" icon="file-lines" href="/guides/text-to-speech-rest">
  For simple "text in, file out" use the REST POST endpoint, a single
  HTTP call with no WebSocket to manage.
</Card>

## Quickstart

Open a real-time TTS stream, send text, and read audio chunks as soon
as the model produces them.

```python theme={null}
import asyncio
import gradium

async def main():
    client = gradium.client.GradiumClient(api_key="your-api-key")
    audio_chunks = []

    async with client.tts_realtime(
        voice_id="YTpq7expH9539ERJ",
        output_format="pcm",
    ) as tts:
        async def sender():
            await tts.send_text("Hello, world.")
            await tts.send_eos()

        async def receiver():
            async for msg in tts:
                if msg["type"] == "audio":
                    audio_chunks.append(msg["audio"])
                elif msg["type"] == "end_of_stream":
                    return

        await asyncio.gather(sender(), receiver())

    with open("output.pcm", "wb") as f:
        f.write(b"".join(audio_chunks))

asyncio.run(main())
```

For a lower-level protocol view, see
[WebSocket Lifecycle](/guides/websocket-lifecycle). For LLM-generated
text, see [LLM Tokens to Streaming TTS](/guides/recipes/llm-to-tts).

## Choosing the SDK API

The Python SDK exposes three TTS shapes. All WebSocket APIs talk to
`wss://api.gradium.ai/api/speech/tts`.

| Use case                                                                   | Method         |
| -------------------------------------------------------------------------- | -------------- |
| You are producing text live and want to send/receive concurrently          | `tts_realtime` |
| You have a string, list, or async generator and want streamed audio chunks | `tts_stream`   |
| You want the complete audio bytes after generation finishes                | `tts`          |

Use `tts_realtime` for voice agents, LLM token streaming, browser
bridges, telephony bridges, or any workflow where the sending and
receiving loops run at the same time. Use `tts_stream` when your input
is shaped like an iterable and you only need to consume bytes. Use
`tts` for scripts and tests where waiting for the full result is fine.

## Buffered convenience

```python theme={null}
import gradium

client = gradium.client.GradiumClient()
result = await client.tts(
    setup={
        "model_name": "default",
        "voice_id": "YTpq7expH9539ERJ",
        "output_format": "wav"
    },
    text="Hello, world!"
)

with open("output.wav", "wb") as f:
    f.write(result.raw_data)

print(f"Sample rate: {result.sample_rate}")
print(f"Request ID: {result.request_id}")
```

`client.tts(...)` still uses the streaming protocol under the hood; it
buffers the audio chunks and returns a single `TTSResult`.

## Setup Parameters

* **`model_name`**: The TTS model to use (default: `"default"`). Set to
  `"gradium-tts-beta"` to test our newest Text-to-Speech model.
* **`voice_id`**: The voice id of the voice to be used. The voice id can be found in the voice library section of this documentation or in the studio.
* **`output_format`**: Audio format of the output data (supported: `"pcm"`,
  `"wav"`, `"opus"`, ...)
* **`json_config`**: Advanced voice settings such as temperature,
  speed, voice similarity, and rewrite rules. See
  [Voice Settings](/guides/voice-settings).
* **`pronunciation_id`**: Optional pronunciation dictionary to apply to
  this request.
* **`client_req_id`** and **`close_ws_on_eos`**: Used for reusable and
  multiplexed WebSocket connections. See
  [Multiplexing](/guides/multiplexing).

When using `"pcm"` output format, the audio will adhere to the following
specifications:

* **Sample Rate**: 48000 Hz (48kHz)
* **Format**: PCM (Pulse Code Modulation)
* **Bit Depth**: 16-bit signed integer
* **Channels**: Single channel (mono)
* **Chunk Size**: 3840 samples per chunk (80ms at 48kHz)

When using the `"wav"` output format, the audio chunks are in WAV format,
at 48kHz, 16-bit signed integer mono.

When using the `"opus"` output format, the audio chunks use the Opus codec
wrapped in an Ogg container.

Alternative output formats include `"ulaw_8000"`, `"alaw_8000"`, `"pcm_8000"`,
`"pcm_16000"`, and `"pcm_24000"`.

## Streaming TTS

Use `tts_stream` when you have a string, list, or async generator and
want an async iterator of audio bytes.

```python theme={null}
stream = await client.tts_stream(
    setup={
        "model_name": "default",
        "voice_id": "LFZvm12tW_z0xfGo",
        "output_format": "pcm"
    },
    text="This is a longer text that will be streamed."
)

async for audio_chunk in stream.iter_bytes():
    print(f"Received {len(audio_chunk)} bytes")
```

## Using Custom Voices

```python theme={null}
result = await client.tts(
    setup={
        "model_name": "default",
        "voice_id": "YTpq7expH9539ERJ",
        "output_format": "wav"
    },
    text="Hello with my custom voice!"
)
```

## Output Formats

```python theme={null}
# WAV format
result = await client.tts(setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "wav"}, text="Hello")

# PCM format: the data is sampled at 48kHz, 16-bit signed integer, mono
result = await client.tts(setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "pcm"}, text="Hello")

# Get numpy array from PCM
pcm_array = result.pcm()
pcm16_array = result.pcm16()
```

## Flushing and Pauses

The model only generates audio when it has enough context to do so, so generally
the audio lags a few words behind the text input. The `<flush>` tag can be
used to force the model to output the audio for all the text that has been
input so far.

```python theme={null}
sample_text = "Hello, this is a test from the Gradium Text to Speech system. <flush> We are testing the flush."
test_audio = await client.tts(
    setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav'},
    text=sample_text,
)
```

Pauses can be generated by inserting a "break time" tag as shown below.
The break time is specified in seconds and should be between 0.1 and 2.0s.
The tag must be preceded and followed by a space.

```python theme={null}
sample_text = 'Hello, this is a test from the Gradium Text to Speech system. <break time="1.5s" /> We are testing the pause.'

test_audio = await client.tts(
    setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav'},
    text=sample_text,
)
```

## Text with Timestamps

The model returns timestamps for each emitted text segment (typically
aligned to word boundaries).

```python theme={null}
result = await client.tts(
    setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "wav"},
    text="Hello, world!"
)

for item in result.text_with_timestamps:
    print(f"{item.text}: {item.start_s:.2f}s - {item.stop_s:.2f}s")
```

Each item carries `text`, `start_s`, and `stop_s`: the start and end
times in seconds within the generated audio. Over a streaming session
the same information is delivered as `text` messages on the wire (see
the [TTS WebSocket reference](/api-reference/endpoint/tts-websocket)).

Timestamps are emitted at **segment** granularity (typically aligned
to word boundaries). For finer-grained character offsets, derive them
from the segment text.

## Async Generator Input

Use an async generator when text is produced incrementally, for
example by an LLM or another streaming service.

```python theme={null}
async def text_generator():
    yield "Hello, "
    yield "this is "
    yield "a streaming "
    yield "example."

stream = await client.tts_stream(
    setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "pcm"},
    text=text_generator()
)

async for chunk in stream.iter_bytes():
    pass
```

<Note>
  **Split text chunks on whitespace, never in the middle of a word or
  immediately before a punctuation mark.** When text is sent incrementally
  (whether through successive `send_text` calls on the Python realtime
  stream, through an async generator as shown above, or through multiple
  `{"type": "text"}` messages over the WebSocket API), the server inserts
  a single whitespace between the contents of consecutive messages.

  So sending `"foo"` followed by `"bar"` is equivalent to sending
  `"foo bar"` (a whitespace is added between them), **not** `"foobar"`.
  Splitting a single word across two messages will change its pronunciation.

  For the same reason, do not split punctuation into its own message:
  sending `"foo"` followed by `"."` produces `"foo ."` rather than `"foo."`.
  Keep trailing punctuation attached to the preceding word (e.g. send
  `"foo."` as one message, or `"foo. "` followed by the next chunk).
</Note>

## Pronunciation Dictionaries

Pronunciation dictionaries allow you to customize how specific words or phrases are pronounced in your TTS output. This is particularly useful for:

* Brand names, technical terms, or proper nouns
* Acronyms that should be pronounced in a specific way
* Words with non-standard pronunciations in your use case

The easiest way to create and manage pronunciation dictionaries is through the Gradium Studio, on the pronunciation page.
Once you have created a dictionary and obtained its ID, you can use it in your TTS requests by passing the `pronunciation_id` parameter in the setup message, similar to the way we pass the voice\_id:

```python theme={null}
import gradium

client = gradium.client.GradiumClient()

result = await client.tts(
    setup={
        "voice_id": "YTpq7expH9539ERJ",
        "output_format": "wav",
        "pronunciation_id": "bb1ckYhNHCcIJjdK",  # Whatever your ID is.
    },
    text="The text you want to generate."
)

with open("output.wav", "wb") as f:
    f.write(result.raw_data)
```

## Direct WebSocket

If you don't want the gradium SDK, for example you're calling from a
non-Python runtime, or you want full control over the wire, you can
talk to the WebSocket protocol directly. The message shapes are
identical to what the SDK sends.

For interactive poking from a terminal, [`wscat`](https://github.com/websockets/wscat)
is the quickest way to confirm reachability and step through messages
by hand:

```bash theme={null}
wscat -c "wss://api.gradium.ai/api/speech/tts" \
  -H "x-api-key: your_api_key"
# After connection, type:
# {"type":"setup","voice_id":"YTpq7expH9539ERJ","model_name":"default","output_format":"wav"}
# {"type":"text","text":"Hello, world!"}
# {"type":"end_of_stream"}
```

For a client without the SDK, use any WebSocket library
(here Python's [`websockets`](https://websockets.readthedocs.io/)):

```python theme={null}
import asyncio
import base64
import json

import websockets


async def synthesise(api_key: str, voice_id: str, text: str) -> bytes:
    setup = {
        "type": "setup",
        "voice_id": voice_id,
        "model_name": "default",
        "output_format": "wav",
    }
    audio_chunks = []

    async with websockets.connect(
        "wss://api.gradium.ai/api/speech/tts",
        additional_headers={"x-api-key": api_key},
    ) as ws:
        await ws.send(json.dumps(setup))
        ready = json.loads(await ws.recv())
        assert ready["type"] == "ready"

        await ws.send(json.dumps({"type": "text", "text": text}))
        await ws.send(json.dumps({"type": "end_of_stream"}))

        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "audio":
                audio_chunks.append(base64.b64decode(msg["audio"]))
            elif msg["type"] == "end_of_stream":
                break
            elif msg["type"] == "error":
                raise RuntimeError(msg["message"])

    return b"".join(audio_chunks)


audio = asyncio.run(synthesise("your_api_key", "YTpq7expH9539ERJ", "Hello, world!"))
with open("output.wav", "wb") as f:
    f.write(audio)
```

For the full message schema (every field, every error code), see the
[TTS WebSocket reference](/api-reference/endpoint/tts-websocket).

## Next steps

<CardGroup cols={2}>
  <Card title="TTS WebSocket reference" icon="code" href="/api-reference/endpoint/tts-websocket">
    Complete wire-level schema: every message type, every field, every
    error code.
  </Card>

  <Card title="One-shot REST" icon="file-lines" href="/guides/text-to-speech-rest">
    Synthesise a complete text block in a single HTTP request.
  </Card>

  <Card title="Multiplexing" icon="layer-group" href="/guides/multiplexing">
    Run multiple concurrent synthesis requests over a single WebSocket
    session.
  </Card>

  <Card title="Voice settings" icon="sliders" href="/guides/voice-settings">
    Speed, temperature, voice similarity, and rewrite rules.
  </Card>
</CardGroup>
