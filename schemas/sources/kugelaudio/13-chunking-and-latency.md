> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Chunking & per-segment latency

> How server-side chunking works and why client-side flushing increases TTFA.

`/ws/tts/stream` is one logical TTS request per turn, regardless of how many
`send` calls you make. The server's text buffer accumulates tokens and hands a
complete chunk to the model when it confirms a natural boundary (normally
after the next fragment arrives, with a 500 ms default stale-buffer fallback). Inside a
single turn, model state (KV cache, voice conditioning) is preserved across
chunks so prosody stays natural.

Calling `flush=true` mid-turn breaks that flow: the server treats the flush as
a hard segment boundary, runs another full model prefill on whatever has been
buffered, and only then emits audio. The cost of that prefill is the full
model time-to-first-audio (see [Latency](/latency)) — the same cost you pay on
the very first chunk of a turn. Do it on every word and you pay model TTFA on
every word.

## Chunk-size ordering — pick the largest you can

If you're driving the session from a layer above raw LLM tokens (for example,
a translation pipeline that emits clauses, or a router that batches output
before sending), use the largest chunks you can. The ordering, from best to
worst time-to-first-audio per emitted segment, is:

| Chunk granularity                  | Verdict                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| **Full turn in one `send`**        | Best possible. Use when the full text is available before TTS starts. |
| **Sentence-level chunks**          | Recommended for streamed LLM output.                                  |
| **≥20-character chunks**           | Acceptable fallback when sentence boundaries aren't yet available.    |
| **Clause-level (comma/semicolon)** | Avoid. Each chunk pays model TTFA.                                    |
| **Word-level or sub-word**         | Don't. Each chunk pays model TTFA — by far the most expensive shape.  |

Two important nuances:

* **Raw LLM tokens are fine** as long as you `send` them without
  `flush=true` — the server's text buffer reassembles them and only
  hands sentence-sized work to the model. The "word-level is bad" row
  above applies when you *flush* after each word, not when you
  *send* one word at a time without flushing.
* We deliberately don't publish exact ms figures here — they depend on
  region, voice, and deployment. The ordering is stable; the absolute
  numbers aren't. To reproduce the comparison for your own deployment, run
  `TTFABench.chunkingStrategyBench` in
  `packages/public/java-sdk/benchmark/src/main/java/com/kugelaudio/bench/TTFABench.java`
  against your endpoint — see
  [Measuring TTFA correctly](/latency#measuring-ttfa-correctly).

## Server-side chunking

Native streaming sessions use the server's sentence-aware text buffer. Send
tokens as they arrive and let that buffer decide when a complete unit is ready.
The native API does not expose diffusion-step or client-defined chunk-schedule
controls; unknown WebSocket fields are ignored with a warning.

```python theme={null}
async with client.tts.streaming_session(
    voice_id=1071,
    model_id="kugel-3",
    language="en",
) as session:
    async for token in llm_stream:
        async for chunk in session.send(token):
            play_audio(chunk.audio)
    async for chunk in session.flush():
        play_audio(chunk.audio)
```

## Handle backpressure

If audio arrives faster than you can play it, bound your buffer instead of
letting it grow:

```python theme={null}
import asyncio

async def stream_with_backpressure():
    buffer = asyncio.Queue(maxsize=10)  # Limit buffer size

    async def producer():
        async for chunk in client.tts.stream_async(
            text=text,
            model_id="kugel-3",
            voice_id=1071,
        ):
            if hasattr(chunk, 'audio'):
                await buffer.put(chunk.audio)
        await buffer.put(None)  # Signal end

    async def consumer():
        while True:
            audio = await buffer.get()
            if audio is None:
                break
            play_audio(audio)
            await asyncio.sleep(len(audio) / 2 / 24000)  # Simulate playback time

    await asyncio.gather(producer(), consumer())
```

## Common mistakes

* **Per-segment `flush=true`.** Every flush is a fresh TTS request that pays
  the full model TTFA. If you flush after every sentence, you pay it N times
  per turn instead of once.
* **One session per sentence.** A new WebSocket handshake plus a fresh model
  prefill, every sentence. Keep the same session open for the whole assistant
  turn; only end it when the turn ends — see
  [Turn lifecycle](/streaming/turn-lifecycle).
* **Client-side sentence buffering before `send`.** Unnecessary — the server
  already buffers tokens and chunks at sentence boundaries. Pre-buffering on
  the client just adds latency.
* **Calling `send(text, flush=true)` per word "for lower latency."** It is
  the opposite: each flush is a separate model call. Word-granular flushing
  produces the worst possible TTFA.

If you're migrating from ElevenLabs, the flush semantics are the biggest
behavioral difference — see the
[ElevenLabs migration guide](/integrations/elevenlabs-proxy#migrating-a-streaming-integration).

## Next steps

<CardGroup cols={2}>
  <Card title="Latency" icon="gauge-high" href="/latency">
    How to measure TTFA correctly on your deployment
  </Card>

  <Card title="Turn lifecycle" icon="arrows-rotate" href="/streaming/turn-lifecycle">
    Flush semantics, the 5 s idle auto-flush, session reuse
  </Card>
</CardGroup>
