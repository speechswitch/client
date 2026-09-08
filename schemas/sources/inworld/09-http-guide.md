> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Synthesize Speech

> Send up to 2,000 characters and receive the complete audio in a single HTTP response

The non-streaming API is the simplest way to synthesize a short piece of text: send one request and receive the complete audio in one HTTP response. It accepts up to **2,000 characters** per request.

The server generates the entire audio before returning it, so playback starts later than with a streaming method. Use this API when a simple, one-shot integration matters more than latency or input size. For most other use cases, choose one of the methods below.

## Choose a synthesis method

| If you need | Use | Why |
| --- | --- | --- |
| The lowest possible latency | [WebSocket API](/tts/synthesize-speech-websocket) | Reuses a persistent connection and streams audio chunks as they are generated. |
| Low latency with a simpler integration | [Streaming API](/tts/synthesize-speech-streaming) | Streams audio over HTTP and accepts up to **4,000 characters** per request. |
| Long-form audio such as audiobooks, podcasts, or voiceovers | [Async API](/tts/synthesize-speech-async) | Accepts up to **100,000 characters** per job and returns the result after background generation. On-Demand accounts are capped at 10,000 characters per job. |
| Lower-cost generation that can finish later | [Batch API](/tts/synthesize-speech-batch) | Costs 20% less per character and processes many independent requests in the background. |
| The simplest integration for short text | Synthesize Speech | Returns the complete audio in one response, with a **2,000-character** request limit. |

See the [latency best practices](/tts/best-practices/latency) for more ways to reduce time to first audio.

## Code Examples

<CardGroup cols={3}>
  <Card title="Node.js SDK" icon="npm" href="/tts/node-sdk#generateoptions">
    Use `generate()` from the `@inworld/tts` SDK — handles chunking, retries, and encoding automatically.
  </Card>

  <Card title="JavaScript" icon="js" href="https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/js/example_tts.js">
    View our JavaScript implementation example
  </Card>

  <Card title="Python SDK" icon="python" href="/tts/python-sdk#generateoptions">
    Use `generate()` from the `inworld-tts` SDK — handles chunking, retries, and encoding automatically.
  </Card>
</CardGroup>

## API Reference

<Card title="Synthesize Speech" icon="code" href="/api-reference/ttsAPI/texttospeech/synthesize-speech">
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
