> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Getting Started with Flux TTS

Flux TTS brings the Flux promise to speech synthesis. Where `/v1/speak` renders a buffer of text into audio and discards everything else, `/v2/speak` is built for the realities of a voice agent pipeline: streaming text in from an LLM, speaking it to a user, getting interrupted, resuming, and doing it across dozens of turns without losing conversational coherence.

**Flux TTS is perfect for:** turn-based voice agents, customer service bots, phone assistants, and any application that streams LLM output to a speaker in real time.

**Key benefits:**

* **Streaming-first** — Stream LLM tokens straight into the socket; the server handles flush placement at sentence and clause boundaries internally.

* **Turn-based lifecycle** — Each agent response is a turn with a clean lifecycle (`SpeechStarted` → audio → `SpeechMetadata`), reported per turn.

* **Cross-turn voice consistency** — The model persists conversational state across turns, so short responses like "Of course" keep the tone established earlier.

* **Interruption-aware** — On barge-in, `Interrupt` reports exactly what the user heard (`text_spoken` / `text_remaining`) so your LLM context stays in sync.

* **Mid-stream control** — `Configure` adjusts `speed` without reconnecting.

**New endpoint, not a replacement.** `/v2/speak` ships alongside `/v1/speak`. The v1 endpoint and all Aura model strings stay available and unchanged. See [When to use /v2/speak vs /v1/speak](#when-to-use-v2speak-vs-v1speak) and the [Migration guide](/docs/flux-tts/migrating).

## Connection requirements

**Flux TTS requires the `/v2/speak` endpoint.** The `/v1/speak` endpoint does not serve Flux voices. A `model` is **required** on every connection — connections without it are rejected.

When connecting to Flux TTS, you must use:

* **Endpoint:** `/v2/speak` (not `/v1/speak`)
* **Model:** a Flux TTS model string, e.g. `flux-haley-en`
* **Authentication:** `Authorization: Token YOUR_DEEPGRAM_API_KEY`

**WebSocket URL format:**

```
wss://api.deepgram.com/v2/speak?model=flux-haley-en
```

### Connection query parameters

The streaming WebSocket produces **raw audio** (no container), so it accepts only the parameters below. Unknown or misspelled parameters are rejected, as are batch-only parameters (`container`, `bit_rate`, `callback`, `callback_method`, `priority`).

| Parameter      | Type    | Default      | Description                                                                                                                                                                                                                                                         |
| -------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`        | string  | —            | **Required.** The Flux TTS model to use (e.g. `flux-haley-en`). Must be a `flux-*` model; an Aura model returns an endpoint-specific error.                                                                                                                         |
| `encoding`     | enum    | `linear16`   | Raw audio encoding: `linear16`, `mulaw`, or `alaw`.                                                                                                                                                                                                                 |
| `sample_rate`  | integer | model native | Output sample rate. With `linear16`: `8000`, `16000`, `24000`, `32000`, `44100`, `48000`. With `mulaw`/`alaw`: `8000` or `16000`.                                                                                                                                   |
| `speed`        | number  | `1.0`        | Initial speech-rate multiplier — `0.5` to `1.5` in `0.05` increments. Not supported by every model or language; unsupported combinations return `SPEED_NOT_SUPPORTED`. Can also be changed mid-stream with [`Configure`](/docs/flux-tts/client-messages#configure). |
| `expressivity` | integer | `0`          | **Beta.** Delivery register, `-2` (calm) to `2` (animated). See [Expressivity](/docs/tts-expressivity).                                                                                                                                                             |
| `mip_opt_out`  | boolean | `false`      | Opt out of the Model Improvement Program.                                                                                                                                                                                                                           |
| `tag`          | string  | —            | Custom tag(s) for request tracking. Repeatable.                                                                                                                                                                                                                     |

**Compressed and containerized encodings are batch-only.** `opus`, `mp3`, `flac`, and `aac` (and the `container` / `bit_rate` parameters) are available on the [batch REST transport](#streaming-vs-batch), not on the streaming WebSocket, which emits raw `linear16`/`mulaw`/`alaw`.

**Streaming happens on its own.** You don't chunk text or place flush points — the server starts generating and streaming a turn's audio as soon as it has enough text, and prosody carries across turns automatically. You own turn boundaries (`Flush`); everything else is handled for you.

### Model naming

Flux TTS model strings follow the format `flux-{voice}-{language}`:

```
flux-haley-en      # English voice
```

All Flux TTS voices are English (`-en`) today. See [Voices & Languages](/docs/flux-tts/voices) for the full catalog.

## The conversation loop

A Flux TTS session is a sequence of **turns**. You stream text into a turn with `Speak` messages, then end the turn with `Flush` when the agent's response is complete. The server assigns a `speech_id` to each turn and reports lifecycle events around it.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Flux as Flux TTS (/v2/speak)

    Client->>Flux: Speak {"text": "Hello! How can I help you today?"}
    Flux-->>Client: SpeechStarted {speech_id}
    Flux-->>Client: audio frames (streaming)
    Client->>Flux: Flush
    Flux-->>Client: Flushed {speech_id}
    Flux-->>Client: remaining audio frames
    Flux-->>Client: SpeechMetadata {speech_id, duration, char counts}
```

## Build a basic agent loop

The core pattern is: stream LLM tokens in as they arrive, then flush at the end of the turn.

**SDK support is live.** The [Python](https://github.com/deepgram/deepgram-python-sdk) (`deepgram-sdk`) and [JavaScript](https://github.com/deepgram/deepgram-js-sdk) (`@deepgram/sdk`) SDKs expose a `speak.v2` client for `/v2/speak`. For a full runnable integration, start from the [template apps](/docs/flux-tts/template-apps). The **Direct WebSocket** path is available for languages without SDK support yet.

**`Python (deepgram-sdk)`**

```python Python (deepgram-sdk)
import threading

from deepgram import DeepgramClient
from deepgram.core.events import EventType
from deepgram.speak.v2.types import SpeakV2Speak

# Reads DEEPGRAM_API_KEY from the environment.
client = DeepgramClient()

with client.speak.v2.connect(model="flux-haley-en") as connection:
    # Audio arrives as binary frames; control messages (SpeechStarted,
    # SpeechMetadata, ...) arrive as JSON.
    connection.on(EventType.MESSAGE, handle_message)
    connection.on(EventType.ERROR, handle_error)

    # start_listening() blocks, so run it on a background thread.
    threading.Thread(target=connection.start_listening, daemon=True).start()

    # Stream LLM tokens into the active turn as they arrive.
    for token in llm.stream(prompt):
        connection.send_speak(SpeakV2Speak(text=token))

    # Flush ends the turn: the server generates the remaining audio
    # and emits SpeechMetadata.
    connection.send_flush()
    connection.send_close()
```

**`JavaScript (@deepgram/sdk)`**

```javascript JavaScript (@deepgram/sdk)
const { DeepgramClient } = require('@deepgram/sdk');

// Reads DEEPGRAM_API_KEY from the environment.
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

const connection = await deepgram.speak.v2.createConnection({ model: 'flux-haley-en' });

// Audio arrives as binary frames; control messages (SpeechStarted,
// SpeechMetadata, ...) arrive as JSON.
connection.on('message', handleMessage);
connection.on('error', console.error);

connection.connect();

// Stream LLM tokens into the active turn as they arrive.
for (const token of llmTokens) {
  connection.sendSpeak({ type: 'Speak', text: token });
}

// Flush ends the turn: the server generates the remaining audio
// and emits SpeechMetadata.
connection.sendFlush({ type: 'Flush' });
connection.sendClose({ type: 'Close' });
```

**`Direct WebSocket`**

```bash Direct WebSocket
# Connect with wscat for testing.
wscat -H "Authorization: Token YOUR_DEEPGRAM_API_KEY" \
  -c "wss://api.deepgram.com/v2/speak?model=flux-haley-en"

# Then send text frames, e.g.
# {"type": "Speak", "text": "Sure, I can help you cancel your subscription."}
# {"type": "Flush"}
```

## A note on streaming text

Send **plain text**. The server applies text normalization (e.g. number and date expansion) before synthesis, but it does not reorder your content or insert or strip whitespace between successive `Speak` messages — so you can stream raw LLM tokens without coordinating chunk boundaries.

**Insert a space between distinct generations.** Because text is concatenated verbatim, sending `"Hello world."` immediately followed by `"How are you?"` is synthesized as `"Hello world.How are you?"`, which can trigger sentence-boundary artifacts. When you stitch together separate LLM responses (for example, a reply, then a tool-call result, then another reply), insert a single space — or the appropriate separator for non-whitespace languages — between them.

## When to use /v2/speak vs /v1/speak

|                    | `/v1/speak` (Aura)                       | `/v2/speak` (Flux TTS)                       |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| Mental model       | Text buffer → audio stream               | Streaming-first, turn-based conversation     |
| Flushing           | Manual `Flush` + flush toggles           | Server-managed; manual `Flush` ends the turn |
| Interruption       | `Clear` discards the buffer, no feedback | `Interrupt` with spoken-text feedback        |
| Cross-turn context | None                                     | Model state persists across turns            |
| Mid-stream control | Fixed at connection                      | `Configure` speed mid-session                |
| Voices             | Aura 1 / Aura 2                          | Flux TTS voice portfolio                     |

Build new voice-agent integrations on `/v2/speak`. Stay on `/v1/speak` if you depend on the legacy manual-flush toggles, or if you are using Aura voices and don't yet need the conversational surface. See the [Migration guide](/docs/flux-tts/migrating) for a step-by-step path.

## Streaming vs. batch

`/v2/speak` is exposed over two transports against the same Flux voices:

* **Streaming (WebSocket)** — `wss://api.deepgram.com/v2/speak`. The conversational path covered throughout these docs: text streams in, audio streams back, turns are interruptible. Use it for live voice agents that need low time-to-first-byte and barge-in.
* **Batch (REST)** — `POST https://api.deepgram.com/v2/speak`. Submit a complete block of text, receive the full audio in one response. Use it for pre-generating fixed audio (IVR prompts, notifications, audiobook lines) where the whole text is known up front and interruption isn't needed.

**`Batch request`**

```bash Batch request
curl "https://api.deepgram.com/v2/speak?model=flux-haley-en" \
  -H "Authorization: Token YOUR_DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Your appointment is confirmed for 3pm tomorrow." }' \
  --output audio.mp3
```

The batch path shares `model`, `speed`, `expressivity`, and media-output settings with the streaming surface, and adds containerized/compressed encodings (`mp3` default, plus `opus`/`flac`/`aac` with `container`/`bit_rate`). Conversational constructs (`Flush`, `Interrupt`, `speech_id`, lifecycle events) do not apply to batch; per-request telemetry is returned as response headers, mirroring Aura's REST conventions.

## What's next?

* [Feature Overview](/docs/flux-tts/feature-overview)
* [Client Messages](/docs/flux-tts/client-messages)
* [Server Messages](/docs/flux-tts/server-messages)
* [The Speech Lifecycle](/docs/flux-tts/state)
* [Cross-Turn Context](/docs/flux-tts/context)
* [Voice Agent Patterns](/docs/flux-tts/voice-agent)
* [Template Apps](/docs/flux-tts/template-apps)
* [Migrating from /v1/speak](/docs/flux-tts/migrating)

---