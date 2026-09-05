> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# LLM Tokens to Streaming TTS

> Stream generated text into TTS while preserving prosody and low latency

Use this pattern when an LLM produces text incrementally and you want
the user to hear audio before the full answer is finished.

The core idea:

1. Open one TTS WebSocket before the LLM starts.
2. Buffer LLM tokens into word or phrase chunks.
3. Send each chunk as a `text` message.
4. Add `<flush>` when the LLM finishes a sentence or the whole answer.
5. Read `audio` messages concurrently and stream them to playback.

## Streaming LLM Tokens to TTS

```python theme={null}
import asyncio
import gradium


async def play_pcm(chunk: bytes):
    # Replace with your audio playback sink.
    ...


async def phrase_chunks(llm_tokens):
    buffer = []
    async for token in llm_tokens:
        buffer.append(token)
        text = "".join(buffer)
        if text.endswith((".", "?", "!", ", ")) or len(text) > 80:
            yield text
            buffer = []
    if buffer:
        yield "".join(buffer) + " <flush>"


async def speak_llm(llm_tokens):
    client = gradium.client.GradiumClient(api_key="your-api-key")

    async with client.tts_realtime(
        voice_id="YTpq7expH9539ERJ",
        output_format="pcm",
    ) as tts:
        async def sender():
            async for chunk in phrase_chunks(llm_tokens):
                await tts.send_text(chunk)
            await tts.send_eos()

        async def receiver():
            async for msg in tts:
                if msg["type"] == "audio":
                    await play_pcm(msg["audio"])
                elif msg["type"] == "end_of_stream":
                    return

        await asyncio.gather(sender(), receiver())
```

## Chunking Rules

* Send complete words, phrases, or sentences.
* Keep punctuation attached to the preceding word.
* Avoid sending one token per message unless tokens are already clean
  word chunks.
* Add `<flush>` at natural boundaries, especially when the LLM has
  completed the response.
* Avoid frequent flushes; they reduce the model's context and can make
  prosody choppy.

## Handling Interruptions

If the user interrupts the agent:

1. Stop sending new text.
2. Stop playback locally.
3. Close the current WebSocket.
4. Open a fresh WebSocket for the next answer.

For several independent replies on one connection, use
[Multiplexing](/guides/multiplexing) and route audio by
`client_req_id`.

## Related

<CardGroup cols={2}>
  <Card title="Text-to-Speech WebSocket" icon="waveform-lines" href="/guides/text-to-speech">
    Full TTS streaming guide.
  </Card>

  <Card title="WebSocket Lifecycle" icon="diagram-project" href="/guides/websocket-lifecycle">
    Setup, ready, input, flush, end, and errors.
  </Card>
</CardGroup>
