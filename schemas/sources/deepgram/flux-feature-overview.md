> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Flux TTS Feature Overview

This page summarizes what the Flux TTS `/v2/speak` WebSocket supports. For the full wire protocol, see [Client Messages](/docs/flux-tts/client-messages) and [Server Messages](/docs/flux-tts/server-messages).

## Model Selection

| Feature      | Value                                            |
| ------------ | ------------------------------------------------ |
| Endpoint     | `/v2/speak` (WebSocket and REST)                 |
| Model format | `flux-{voice}-{language}` (e.g. `flux-haley-en`) |
| Model string | **Required** on every connection                 |

## Media Output Settings (streaming)

The streaming WebSocket emits **raw audio** (no container), so it supports raw PCM and G711 encodings only:

| Feature                          | Supported Values                                    |
| -------------------------------- | --------------------------------------------------- |
| `encoding`                       | `linear16` (default), `mulaw`, `alaw`               |
| `sample_rate` (`linear16`)       | `8000`, `16000`, `24000`, `32000`, `44100`, `48000` |
| `sample_rate` (`mulaw` / `alaw`) | `8000`, `16000`                                     |

Compressed/containerized encodings (`opus`, `mp3`, `flac`, `aac`) and the `container` / `bit_rate` parameters are reserved for the batch REST transport (see [Transports](#transports)), not the streaming WebSocket. The streaming connection rejects unknown or batch-only parameters.

## Conversational Surface

The streaming WebSocket only — the batch REST transport is a single request/response (see [Transports](#transports)).

| Feature            | Description                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Turn lifecycle     | Server-assigned `speech_id`; `SpeechStarted` / `SpeechMetadata` events scoped to each turn                  |
| Streaming audio    | The server streams a turn's audio back as text comes in — no client-side chunking or flush placement needed |
| Manual flush       | `Flush` ends a turn: generates the remaining audio and emits `SpeechMetadata`                               |
| Cross-turn context | Prosody persists across turns for tonal consistency (no API surface)                                        |

## Transports

| Transport | Endpoint                                 | Use case                                                                                                                                                                                                           |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Streaming | `wss://api.deepgram.com/v2/speak`        | Live voice agents: low time-to-first-byte, turn-based synthesis                                                                                                                                                    |
| Batch     | `POST https://api.deepgram.com/v2/speak` | Pre-generating fixed audio (IVR prompts, notifications) where the whole text is known up front. Supports containerized/compressed encodings (`mp3` default, plus `opus`/`flac`/`aac` with `container`/`bit_rate`). |

## Session Limits

| Limit                | Value  | Notes                                                                                                              |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Max session duration | 1 hour | Server closes the WebSocket at the 1-hour mark.                                                                    |
| Inactivity timeout   | 60s    | Session closes after 60s with no inbound client message (`NET-0004`). A WebSocket Ping (or Pong) resets the timer. |

## Interruption & Control

| Feature                 | Description                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interruption / barge-in | `Interrupt` cancels the active turn; `SpeechInterrupted` reports `text_spoken` / `text_remaining`. See [Interruption Handling](/docs/flux-tts/interrupt-handling).                  |
| Mid-stream `Configure`  | Adjust `speed` (`0.5`–`1.5` in `0.05` steps) without reconnecting; applies at the next segment boundary.                                                                            |
| `expressivity` (beta)   | Integer delivery-register dial, `-2` (calm) to `2` (animated), default `0`. Available on both transports. See [Expressivity](/docs/tts-expressivity).                               |
| Inline controls         | Inline pause and pronunciation (IPA) controls are coming soon; the `controls_applied` tallies and warning codes are reserved for them.                                              |
| Markup stripping        | Recognized SSML / competitor tags are stripped with an `INPUT_MARKUP_STRIPPED` warning; synthesis continues. See [Markup handling](/docs/flux-tts/client-messages#markup-handling). |

## Rate Limits

For information on Deepgram's concurrency rate limits, see the [API Rate Limits documentation](/reference/api-rate-limits).

---