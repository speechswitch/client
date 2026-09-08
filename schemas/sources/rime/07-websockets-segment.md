> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Segmentation and behavior settings

> Control when synthesis fires over the WebSocket API using segment=never, bySentence, and immediate.

Use `segment=never` for production voice agents that need deterministic synthesis timing. Choose `segment=bySentence` for well-formed prose when automatic punctuation-based buffering is sufficient. Use `segment=immediate` only when your application already sends complete, pre-segmented phrases.

The `segment` query parameter controls how Rime buffers incoming text and when synthesis begins:

| Setting              | Default?           | Best for                                         |
| -------------------- | ------------------ | ------------------------------------------------ |
| `segment=never`      | No *(recommended)* | Full control; you decide when to synthesize      |
| `segment=bySentence` | **Yes**            | Sentence-structured text streamed token by token |
| `segment=immediate`  | No                 | Pre-segmented phrases or real-time pass-through  |

```
wss://users-ws.rime.ai/ws3?speaker=<voice>&modelId=<model>&segment=<setting>
```

<Info>
  All three settings are available on `/ws`, `/ws2`, and `/ws3`. On `/ws` (binary WebSocket), send the plain-text `<FLUSH>` and `<EOS>` tokens instead of JSON operations.
</Info>

***

## `segment=never`: Recommended

<Tip>
  This is the recommended setting for production voice agents and conversational AI applications. It gives you precise control over synthesis timing and avoids the edge cases and heuristics associated with automatic segmentation.
</Tip>

### How it works

Under `segment=never`, Rime **never synthesizes audio automatically**. It accumulates every token you send into a buffer and waits. Audio is only produced when your client explicitly sends a `flush` operation.

```json theme={null}
{ "operation": "flush" }
```

Once flushed, Rime synthesizes the entire accumulated buffer as a single utterance. If synthesis from a previous flush is still in progress when a new flush arrives, Rime will hold the newly accumulated text and synthesize it as soon as the current synthesis finishes.

### What you are responsible for

1. **Sending well-formed, concatenable tokens.** If someone concatenated every token you send, the result should be a properly spaced, punctuated utterance. For example:

   ```
   ["Hello, ", "how ", "can ", "I ", "help ", "you ", "today?"]
   → "Hello, how can I help you today?"  ✅
   ```

   Avoid sending tokens that, when joined, produce malformed text:

   ```
   ["Hello,", "how", "can"]
   → "Hello,howcan"  ❌  (missing spaces)
   ```

2. **Sending `flush` when you're done with an utterance.** This is your signal to Rime that the buffer contains a complete, speakable phrase.

### What Rime is responsible for

* Synthesizing audio whenever a `flush` is received.
* Queuing the buffer for synthesis if the previous utterance is still being produced.
* Never synthesizing mid-stream without your explicit instruction.
* Sending a `done` event after all audio for a `flush` has been delivered. A `flush` on an empty buffer produces nothing, and flushes that arrive while synthesis is still running are coalesced into a single synthesis with a single `done`, so do not count `done` events against `flush` events. `eos` also emits `done` for any content remaining in the buffer.

### Example

```python theme={null}
import asyncio
import json
import websockets
import base64

API_KEY = "your-api-key"
URL = "wss://users-ws.rime.ai/ws3?speaker=astra&modelId=coda&segment=never"

async def run():
    async with websockets.connect(URL, additional_headers={"Authorization": f"Bearer {API_KEY}"}) as ws:
        # Stream an LLM response token by token
        tokens = ["Sure, ", "I'd ", "be ", "happy ", "to ", "help ", "with ", "that."]
        for token in tokens:
            await ws.send(json.dumps({"text": token}))

        # Tell Rime to synthesize everything accumulated so far
        await ws.send(json.dumps({"operation": "flush"}))

        # Receive and play audio chunks
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "chunk":
                audio = base64.b64decode(msg["data"])
                # stream audio to your player...
            elif msg["type"] == "timestamps":
                print("Timestamps:", msg["word_timestamps"])

asyncio.run(run())
```

### Handling interruptions

If your user interrupts the assistant while audio is playing, send a `clear` operation to discard text that has not yet been submitted for synthesis. `clear` does not cancel an in-flight synthesis and does not drop text already queued by an earlier `flush`; stop playback client-side, and close the connection if you need a hard stop:

```json theme={null}
{ "operation": "clear" }
```

Then begin streaming your new response tokens immediately.

***

## `segment=bySentence`: Default

This is the default behavior when `segment` is not specified. Rime buffers tokens and synthesizes audio each time it detects a sentence or phrase boundary in the accumulated text.

### How it works

Rime watches the incoming token stream for sentence-ending punctuation: `.`, `?`, `!`. When one is encountered and no audio is currently being synthesized, Rime synthesizes everything up to that boundary and sends the audio back.

### What you are responsible for

1. **Separating sentences with spaces.** Tokens sent without trailing spaces can cause words to run together after concatenation.

2. **Not splitting tokens at sentence-ending punctuation.** Rime's heuristics fire on received tokens. If a single token ends with sentence-ending punctuation in the middle of what should be a larger phrase (e.g., `"2."` in `"2.5ml"`), it may trigger an early synthesis.

   ```
   ❌  tokens = ["take ", "2.", "5ml ", "of ", "the ", "solution."]
   ✅  tokens = ["take ", "2.5ml ", "of ", "the ", "solution."]
   ```

### What Rime is responsible for

* Accumulating tokens until a sentence boundary is detected.
* Synthesizing the buffer at that boundary, **only if no audio is currently being produced**.
* Using heuristics to determine whether a given punctuation mark constitutes a sentence end.
* Sending a `done` event once per synthesis run, after the last segment has been delivered and the text buffer is empty. Intermediate sentence boundaries within a run do **not** emit `done`.

### When to use this

`segment=bySentence` works well when you're streaming text with clean sentence boundaries and no numbers or abbreviations that could confuse the period heuristic. It requires less client-side coordination than `segment=never` but is less predictable in edge cases.

<Warning>
  `segment=bySentence` relies on heuristics. Text with decimal numbers, abbreviations (e.g. `Dr.`, `2.5ml`), or mid-sentence ellipses can cause early synthesis. For production voice agents, consider `segment=never` for more reliable control.
</Warning>

### Example

```python theme={null}
import asyncio
import json
import websockets
import base64

API_KEY = "your-api-key"
# segment=bySentence is the default, but shown explicitly here for clarity
URL = "wss://users-ws.rime.ai/ws3?speaker=cove&modelId=mistv3&segment=bySentence"

async def run():
    async with websockets.connect(URL, additional_headers={"Authorization": f"Bearer {API_KEY}"}) as ws:
        sentences = [
            "The weather today is sunny. ",
            "Temperatures will reach the mid-seventies. ",
            "Enjoy the sunshine!",
        ]
        for sentence in sentences:
            await ws.send(json.dumps({"text": sentence}))

        await ws.send(json.dumps({"operation": "eos"}))

        while True:
            try:
                msg = json.loads(await ws.recv())
            except websockets.exceptions.ConnectionClosedOK:
                break
            if msg["type"] == "chunk":
                audio = base64.b64decode(msg["data"])
                # stream to player...

asyncio.run(run())
```

***

## `segment=immediate`: Synthesize on receipt

Under `segment=immediate`, Rime synthesizes audio as soon as text arrives in the buffer, provided no audio is currently being produced.

### How it works

Each time Rime receives a text message and the synthesis pipeline is idle, it synthesizes whatever is in the buffer immediately. If synthesis is already in progress, incoming tokens continue to accumulate. Once the current synthesis finishes, Rime flushes the entire accumulated buffer as a single utterance.

### What you are responsible for

1. **Sending complete, speakable phrases.** Because Rime may synthesize on the very first token it receives, each message, or the concatenation of messages received while synthesis is busy, should form something that sounds natural when spoken on its own.

2. **Ensuring concatenated tokens are properly spaced and formatted.** When multiple tokens arrive during an active synthesis, they'll be joined and synthesized together. The same concatenation rules apply as in `segment=never`.

### What Rime is responsible for

* Synthesizing immediately upon receiving text when the pipeline is idle.
* Accumulating tokens while synthesis is active, then synthesizing the full buffer once idle again.
* Sending a `done` event once per synthesis run, after the last segment has been delivered and the buffer is empty.

### When to use this

`segment=immediate` is useful when your client sends complete, pre-segmented utterances and you want Rime to synthesize each one without punctuation-based logic.

### Example

```python theme={null}
import asyncio
import json
import websockets
import base64

API_KEY = "your-api-key"
URL = "wss://users-ws.rime.ai/ws3?speaker=astra&modelId=coda&segment=immediate"

async def run():
    async with websockets.connect(URL, additional_headers={"Authorization": f"Bearer {API_KEY}"}) as ws:
        # Each message is already a complete phrase
        phrases = [
            "Your order has been confirmed.",
            "It will arrive within three to five business days.",
            "Is there anything else I can help you with?",
        ]
        for phrase in phrases:
            await ws.send(json.dumps({"text": phrase}))
            await asyncio.sleep(0.05)  # small delay to allow synthesis to start

        await ws.send(json.dumps({"operation": "eos"}))

        while True:
            try:
                msg = json.loads(await ws.recv())
            except websockets.exceptions.ConnectionClosedOK:
                break
            if msg["type"] == "chunk":
                audio = base64.b64decode(msg["data"])
                # stream to player...

asyncio.run(run())
```

***

## Related

<Columns cols={2}>
  <Card title="WebSocket API Overview" icon="plug" href="/docs/websockets">
    Compare `/ws3`, `/ws2`, and `/ws` endpoints and understand their capabilities.
  </Card>

  <Card title="Latency" icon="gauge-simple-max" href="/docs/latency">
    Understand the factors that affect TTFB and how to minimize them.
  </Card>
</Columns>
