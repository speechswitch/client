> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Synthesize Speech (Streaming)

> Send text, receive audio chunks over HTTP as they are generated

You send text, the server returns audio chunks over HTTP as they are generated. Playback can begin before the full synthesis is complete, significantly reducing time-to-first-audio.

Best for real-time applications and conversational AI when you want low-latency playback without managing a persistent connection. Each request accepts up to **4,000 characters**.

<Note>
For the lowest latency, use the [WebSocket API](/tts/synthesize-speech-websocket). For long-form content such as audiobooks, podcasts, or voiceovers, use the [Async API](/tts/synthesize-speech-async). For tips on optimizing latency, see the [latency best practices guide](/tts/best-practices/latency).
</Note>

## Timestamp Transport Strategy

When using [timestamp alignment](/tts/capabilities/timestamps), you can choose how timestamps are delivered alongside audio using `timestampTransportStrategy`:

- **`SYNC`** (default): Each chunk contains both audio and timestamps together.
- **`ASYNC`**: Audio chunks arrive first, with timestamps following in separate trailing messages. This reduces time-to-first-audio.

See [Timestamps](/tts/capabilities/timestamps#streaming-behavior) for details on how each mode works.

## Code Examples

<CardGroup cols={3}>
  <Card title="Node.js SDK" icon="npm" href="/tts/node-sdk#streamoptions">
    Use `stream()` from the `@inworld/tts` SDK — async iteration over audio chunks with automatic retries.
  </Card>

  <Card title="JavaScript" icon="js" href="https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/js/example_tts_stream.js">
    View our JavaScript implementation example
  </Card>

  <Card title="Python SDK" icon="python" href="/tts/python-sdk#streamoptions">
    Use `stream()` from the `inworld-tts` SDK — async iteration over audio chunks with automatic retries.
  </Card>
</CardGroup>

## API Reference

<Card title="Synthesize Speech Stream" icon="code" href="/api-reference/ttsAPI/texttospeech/synthesize-speech-stream">
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
