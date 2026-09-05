> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Synthesize Speech (WebSocket)

> Persistent connection for lowest-latency audio streaming

You open a persistent WebSocket connection and send text messages. The server streams audio chunks back over the same connection — no per-request overhead, no repeated handshakes. This gives you the lowest possible latency.

Best for voice agents and interactive applications that send multiple synthesis requests in a session, where avoiding connection setup on every call makes a measurable difference.

<Note>
If you only need a single request-response with chunked audio, the [Streaming API](/tts/synthesize-speech-streaming) is simpler to integrate.
For tips on optimizing latency, see the [latency best practices guide](/tts/best-practices/latency).
</Note>

## Message Pipelining

Messages on a connection are processed in order, so you don't need to wait for the `contextCreated` acknowledgment before sending text. For the lowest latency, send each message as soon as it is ready — waiting for the acknowledgment adds a full network round trip before the first audio chunk arrives. If you omit `contextId`, messages are automatically routed to the connection's auto-created context.

## Text Limits

Each `send_text` message accepts up to **2,000 characters**. Text accumulates on the server and is synthesized when the buffer flushes — on an explicit `flush_context`, when `max_buffer_delay_ms` elapses, or once accumulated text reaches `buffer_char_threshold` (1,000 characters by default, configurable up to 2,000).

If you have a single block of text rather than a stream of them, the [Streaming API](/tts/synthesize-speech-streaming) takes up to 4,000 characters in one request.

## Timestamp Transport Strategy

When using [timestamp alignment](/tts/capabilities/timestamps), you can choose how timestamps are delivered alongside audio using `timestampTransportStrategy`:

- **`SYNC`** (default): Each chunk contains both audio and timestamps together.
- **`ASYNC`**: Audio chunks arrive first, with timestamps following in separate trailing messages. This reduces time-to-first-audio.

See [Timestamps](/tts/capabilities/timestamps#streaming-behavior) for details on how each mode works.

## Code Examples

<CardGroup cols={2}>
  <Card title="JavaScript" icon="js" href="https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/js/example_websocket.js">
    View our JavaScript implementation example
  </Card>

  <Card title="Python" icon="python" href="https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/python/example_websocket.py">
    View our Python WebSocket implementation example
  </Card>
</CardGroup>

## API Reference

<Card title="Synthesize Speech WebSocket" icon="code" href="/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket">
  View the complete API specification
</Card>

## Next Steps

<CardGroup cols={3}>
  <Card title="Voice Cloning Best Practices" icon="circle-check" href="/tts/best-practices/voice-cloning">
    Learn best practices for producing high-quality voice clones.
  </Card>

  <Card title="Generating Naturally Sounding Speech" icon="waveform-lines" href="/tts/best-practices/generating-speech">
    Learn best practices for synthesizing high-quality speech.
  </Card>

  <Card title="API Examples" icon="github" href="https://github.com/inworld-ai/inworld-api-examples/tree/main/tts">
    Explore Python and JavaScript code examples for TTS integration.
  </Card>
</CardGroup>
