> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# WebSocket API Overview

> Stream Rime TTS in real time over WebSockets for voice agents: choose between /ws3 (recommended JSON), /ws2 (legacy JSON), and /ws (raw binary), with word-level timestamps and interruption handling.

## tl;dr: Use `/ws3`.

`/ws3` is Rime's recommended WebSocket endpoint. It supports all current and future Rime TTS models, delivers the lowest possible TTFB via direct model streaming, and returns audio as structured JSON messages. Unless you have a specific reason to use a legacy endpoint, start here.

## Authentication

All WebSocket endpoints (`/ws`, `/ws2`, `/ws3`) use the same bearer token as the rest of the Rime API. Send `Authorization: Bearer YOUR_API_KEY` as a connection header when establishing the connection, and pass synthesis arguments (`speaker`, `modelId`, `audioFormat`, `lang`, …) as query parameters on the connection URL. See [API authentication](/docs/api-authentication) for how to create a key, and the per-endpoint reference pages below for complete, runnable connection code.

<Warning>
  Send the token in the `Authorization` header; connections without valid credentials are rejected with `401`.

  Your API key is a secret: keep it out of client-side code. The browser `WebSocket` API can't set request headers, so connect from a server-side process (Node, Python, etc.), or proxy the connection through your own backend. The [voice-agent guides](/docs/voice-agent-nextjs#3-stream-over-websockets-when-latency-matters) show a complete browser ↔ server ↔ Rime bridge.
</Warning>

## Choosing an endpoint

Rime offers three WebSocket endpoints.

|                           | `/ws3`               | `/ws2` | `/ws`            |
| ------------------------- | -------------------- | ------ | ---------------- |
| **Message format**        | JSON                 | JSON   | Raw binary audio |
| **Coda**                  | ✅                    | ❌      | ✅                |
| **Mist v1**               | ✅                    | ✅      | ✅                |
| **Mist v2**               | ✅                    | ✅      | ✅                |
| **Mist v3**               | ✅                    | ❌      | ✅                |
| **Word-level timestamps** | ✅                    | ✅      | ❌                |
| **Context IDs**           | ✅                    | ✅      | ❌                |
| **TTFB optimization**     | ✅ Actively optimized | ❌      | ❌                |

***

## `/ws3`: JSON WebSocket (recommended)

```
wss://users-ws.rime.ai/ws3
```

This is the endpoint Rime actively invests in. It supports all current and upcoming Rime TTS models and streams audio as base64-encoded JSON chunks. TTFB is minimized by streaming model responses directly from the engine as they are produced.

**Supported models:**

* `coda`
* `mistv1`, `mistv2`, `mistv3`
* All future Rime TTS models

<Tip>
  If you're onboarding to Rime's WebSocket API for the first time, use `/ws3`. It's the most capable endpoint and the one Rime will continue to extend.
</Tip>

***

## `/ws2`: Legacy JSON WebSocket

```
wss://users-ws.rime.ai/ws2
```

`/ws2` supports the same JSON message format as `/ws3` but is limited to the `mist` model family (v1 and v2) running on Baseten. TTFB is not further optimized beyond what Baseten's infrastructure provides. This endpoint will not receive new model support.

**Supported models:**

* `mistv1`, `mistv2`

<Info>
  `/ws2` is functionally equivalent to `/ws3` for `mist` workloads, but `/ws3` is preferred. Existing integrations using `/ws2` will continue to work.
</Info>

***

## `/ws`: Binary WebSocket (legacy)

```
wss://users-ws.rime.ai/ws
```

`/ws` sends and receives raw audio bytes rather than JSON. It supports a broader model set than `/ws2` but does not benefit from TTFB optimization. This endpoint is suited for clients that need raw PCM/binary audio and cannot handle JSON framing.

**Supported models:**

* `mistv1`, `mistv2`, `mistv3`
* `coda`

<Warning>
  `/ws` returns raw audio bytes with no JSON framing. It does not support word-level timestamps, context IDs, or structured error events. If you need any of these features, use `/ws3` or `/ws2` instead.
</Warning>

***

## Features available on JSON endpoints (`/ws3` and `/ws2`)

### Word-level timestamps

Both JSON endpoints return word-level timing data alongside audio. This is useful for tracking which words have already been spoken, for example, when an end-user interrupts the assistant mid-sentence.

```typescript theme={null}
type TimestampsEvent = {
  type: "timestamps",
  word_timestamps: {
    words: string[],
    start: number[],
    end: number[],
  },
  contextId: string | null,
}
```

### Context IDs

On `/ws3` and `/ws2`, you can attach a `contextId` to any text message and it will be echoed back on the corresponding audio chunk event. This is useful for correlating audio output to specific turns or requests in a multi-turn conversation.

```json theme={null}
{
  "text": "Hello, how can I help you today?",
  "contextId": "turn-001"
}
```

<Info>
  Rime does not maintain multiple simultaneous context IDs. The audio chunk event will carry the most recent context ID that was active at the time the audio was requested. If you send two messages before any audio is synthesized, only the later context ID will be reflected on the first audio chunk. Once set, a context ID also persists across subsequent messages that don't provide one; events keep carrying the previous ID until you send a new one.
</Info>

***

## Operations

In addition to sending text, your client can send structured operation messages to control the synthesis pipeline.

### `flush`

Synthesizes the current text buffer immediately and sends the resulting audio.

```json theme={null}
{ "operation": "flush" }
```

Use `flush` explicitly in `segment=never` mode. See the [Segmentation guide](/docs/websockets-segment) for details.

### `clear`

Discards the accumulated text buffer without synthesizing it. Useful when the user interrupts the assistant and you want to cancel queued speech.

```json theme={null}
{ "operation": "clear" }
```

### `eos` (end of stream)

Synthesizes whatever remains in the buffer, sends a `done` event for that audio, then immediately closes the connection. If the buffer is already empty, the server closes without a `done` event.

```json theme={null}
{ "operation": "eos" }
```

***

## Synthesis completion (`done`)

After all audio for a synthesis batch has been sent, the server emits a `done` event. This is the signal that the current utterance is fully delivered. If the client triggers further synthesis, another `done` will follow.

```typescript theme={null}
type DoneEvent = {
  type: "done",
  contextId: string | null,
}
```

On `/ws2`, the event additionally carries a boolean `done: true` field; match on `type === "done"` to handle both endpoints uniformly.

`done` fires at different points depending on the `segment` setting:

* **`segment=never`**: fires once per `flush`, after all audio for that flush has been sent. `eos` also fires `done` for any content remaining in the buffer.
* **`segment=bySentence` / `segment=immediate`**: fires once per synthesis run, after the last segment completes and the buffer is empty. Intermediate sentence boundaries do not emit `done`.
* **`eos` (all modes)**: emits `done` for any remaining buffered content before closing the connection. If the buffer is empty, the server closes without a `done`; treat socket close as terminal, not just `done`.

See [Segmentation and behavior settings](/docs/websockets-segment) for details on each mode.

***

## Reference & code examples

Each endpoint has a reference page with full message schemas and runnable connection code (Python `websockets`):

| Endpoint           | Coda                                        | Mist v3                                          | Mist v2                                          |
| ------------------ | ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| **`/ws3`** (JSON)  | [Coda](/api-reference/coda/websockets-json) | [Mist v3](/api-reference/mistv3/websockets-json) | Not supported                                    |
| **`/ws2`** (JSON)  | Not supported                               | Not supported                                    | [Mist v2](/api-reference/mistv2/websockets-json) |
| **`/ws`** (binary) | [Coda](/api-reference/coda/websockets)      | [Mist v3](/api-reference/mistv3/websockets)      | [Mist v2](/api-reference/mistv2/websockets)      |

## Control synthesis timing

The `segment` parameter controls how text is buffered and when synthesis begins.

<Card title="Segmentation & behavior settings" icon="sliders" href="/docs/websockets-segment">
  Compare `segment=never`, `segment=bySentence`, and `segment=immediate`.
</Card>
