> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# WebSocket Stream Options

> Connection initialisation flags shared by tts_realtime and stt_realtime

When using the real-time WebSocket APIs (`tts_realtime` or
`stt_realtime`), two parameters control how the connection initialises.
Both work identically across TTS and STT.

For the full protocol lifecycle, including raw WebSocket messages,
browser tokens, multiplexing, and error behavior, see
[WebSocket Lifecycle](/guides/websocket-lifecycle).

## `send_setup_on_start`

Controls whether the setup message is automatically sent when the
context manager is entered. Defaults to `True`.

Set this to `False` when you need to send setup manually, for example
when using [multiplexing](/guides/multiplexing) where each request has
its own setup with a unique `client_req_id`.

```python theme={null}
# Setup sent automatically (default)
async with client.tts_realtime(voice_id="YTpq7expH9539ERJ", output_format="pcm") as stream:
    await stream.send_text("Hello")

# Setup sent manually
async with client.tts_realtime(send_setup_on_start=False) as stream:
    await stream.send_setup({"voice_id": "YTpq7expH9539ERJ", "output_format": "pcm"})
    await stream.send_text("Hello")
```

## `wait_for_ready_on_start`

Controls whether the client blocks waiting for the server's `ready`
message after sending setup. Defaults to `False`.

When set to `False`, the `ready` message is captured lazily during the
normal receive loop. This reduces connection latency since you can
start sending data immediately after setup without waiting for a
round-trip.

When set to `True`, `stream.ready` is guaranteed to be populated before
you start sending data, which can be useful if you need
server-provided metadata (like sample rate) before proceeding.

```python theme={null}
# Non-blocking (default), ready captured lazily during recv
async with client.tts_realtime(
    voice_id="YTpq7expH9539ERJ",
    output_format="pcm"
) as stream:
    # stream.ready is None here, start sending immediately
    await stream.send_text("Hello")
    await stream.send_eos()

    async for msg in stream:
        # stream.ready gets populated when the ready message arrives
        if msg["type"] == "audio":
            process_audio(msg["audio"])

# Blocking, wait for ready before sending
async with client.tts_realtime(
    voice_id="YTpq7expH9539ERJ",
    output_format="pcm",
    wait_for_ready_on_start=True
) as stream:
    # stream.ready is populated here
    print(f"Server ready: {stream.ready}")
    await stream.send_text("Hello")
```

Both parameters work identically for `stt_realtime`:

```python theme={null}
async with client.stt_realtime(
    model_name="default",
    input_format="pcm",
    json_config={"language": "en"},
    wait_for_ready_on_start=True
) as stream:
    print(f"Server ready: {stream.ready}")
    await stream.send_audio(audio_data)
```
