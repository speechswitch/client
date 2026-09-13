> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Client Messages

All client-to-server traffic on `/v2/speak` is JSON text frames. You stream synthesis text with `Speak`, end a turn with `Flush` (or `Interrupt` on barge-in), adjust delivery mid-stream with `Configure`, and shut down with `Close`. The server replies on a parallel set of [Server Messages](/docs/flux-tts/server-messages).

A **turn** is one complete agent response, bounded by `Flush` or `Interrupt`. The server streams a turn's audio as text arrives; `Flush` completes the turn and `Interrupt` cancels it. For how these messages drive turn state, see [The Speech Lifecycle](/docs/flux-tts/state).

## Speak

Send text to be synthesized into the active turn. The `Speak` shape is unchanged from `/v1/speak`. The server tracks the active turn internally and assigns it a **`speech_id`** — a server-generated turn identifier, included in `SpeechStarted` (the start of a turn) and `SpeechMetadata` (the completion of the turn's synthesis). Binary audio frames aren't labeled with the `speech_id`, but all of a turn's audio — and only that turn's audio — arrives between those two messages. Clients do **not** specify one.

```json
{
  "type": "Speak",
  "text": "Sure, I can help you cancel your subscription."
}
```

| Field  | Type      | Required | Description                                                     |
| ------ | --------- | -------- | --------------------------------------------------------------- |
| `type` | `"Speak"` | yes      | Message type identifier.                                        |
| `text` | string    | yes      | Text to synthesize — see [Text handling](#text-handling) below. |

### Streaming LLM tokens

Streaming is just sending `Speak` messages as tokens arrive, then flushing at the end of the turn:

```json
{"type": "Speak", "text": "Sure, "}
{"type": "Speak", "text": "I can "}
{"type": "Speak", "text": "help you "}
{"type": "Speak", "text": "cancel your "}
{"type": "Speak", "text": "subscription."}
{"type": "Flush"}
```

You may send `Speak` at any time. Text sent while the current turn is still generating **appends to that turn**. Once you `Flush`, though, the turn is closed — a later `Speak` starts a **new** turn, which the server queues as *pending* behind any turn still being synthesized. Only `Flush` ends a turn.

### Text handling

Send **plain text**. The server applies text normalization (for example, expanding numbers and dates) before synthesis, but it does not reorder your content or insert or strip whitespace between successive `Speak` messages — so you can stream LLM tokens directly without coordinating chunk boundaries.

**Insert whitespace between distinct generations.** Because the server doesn't add whitespace between `Speak` messages, sending `"Hello world."` immediately followed by `"How are you?"` is processed as `"Hello world.How are you?"`, which can trigger sentence-boundary artifacts. When you concatenate separate LLM responses (a reply, a tool-call result, another reply), insert a single space — or the appropriate separator for non-whitespace languages — between them.

### Markup handling

The model synthesizes **plain text** — SSML and competitor audio tags aren't interpreted. Rather than reject the connection or pass markup through (which causes artifacts), the server **strips a defined set of known markup patterns and continues synthesis**; the WebSocket stays open. The detector matches a closed list — W3C SSML core elements and vendor namespaces, ElevenLabs v3 bracketed audio tags (a curated allowlist), and Cartesia Sonic-3 inline tags. Anything outside that list (Markdown, HTML, custom XML) is forwarded verbatim.

For each `Speak` that contains detected markup, the server strips it, synthesizes the cleaned text, and emits one [`Warning`](/docs/flux-tts/server-messages#warning) with code `INPUT_MARKUP_STRIPPED` (one per `Speak`, not per tag).

**Billing and reporting use the cleaned text.** Markup stripping runs before normalization and billing, so `billable_character_count` and an interrupt's `text_spoken` reflect the cleaned text, never the original markup. `Configure` adjusts `speed` only; inline pause and pronunciation controls are coming soon.

## Flush

End the active turn. The server drains the buffer, generates the remaining audio, and reports the turn. `Flush` is how you signal "the agent's response is complete."

```json
{"type": "Flush"}
```

On `Flush`, the server generates any remaining audio for the active turn and emits [`Flushed`](/docs/flux-tts/server-messages#flushed) **when the turn's buffer has actually been flushed** — not on receipt, and it can be held back behind earlier pending turns — followed by [`SpeechMetadata`](/docs/flux-tts/server-messages#speechmetadata) with the turn's billing and timing. The next `Speak` begins a new turn with a new `speech_id`.

**`Flush` is what ends a turn.** The server may already be streaming a turn's audio before you flush, but only `Flush` closes the turn and produces `Flushed` + `SpeechMetadata`. A `Flush` with no active turn is a no-op and produces a `NO_ACTIVE_SPEECH` warning.

## Interrupt

The user has barged in. Cancel the active turn and report what was actually spoken. `Interrupt` stops synthesis and clears the audio buffer — it does **not** reset model state, so the voice stays consistent into the next turn.

```json
{
  "type": "Interrupt",
  "playback_offset": {"type": "time_ms", "value": 2340}
}
```

| Field             | Type          | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`            | `"Interrupt"` | yes      | Message type identifier.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `playback_offset` | object        | no       | Playback position in milliseconds, measured from the start of the **session's** audio (not the current turn), as `{"type": "time_ms", "value": <number>}`. Required for the `text_spoken` / `text_remaining` split — when omitted, `SpeechInterrupted` omits both and reports `audio_played_ms` from the server's own totals. Each interrupt's offset must advance past the position the previous interrupt established. |

`Interrupt` always cancels the **active** turn — there is no per-turn targeting, and unknown fields are rejected. The server responds with [`SpeechInterrupted`](/docs/flux-tts/server-messages#speechinterrupted), reporting `audio_played_ms`, the text split (when a `playback_offset` was provided), and a nested `metadata` block. The next `Speak` begins a new turn.

An `Interrupt` the server cannot act on — no audio generated yet, an earlier interrupt still in flight, or a non-advancing offset — is answered with a `Warning` instead of `SpeechInterrupted`. See the [warning codes](/docs/flux-tts/server-messages#warning-codes).

**Stop playback locally, then `Interrupt`.** The instant you detect barge-in, stop playback client-side; the round-trip is for context reconciliation, not for stopping audio. Any frames that arrive after you send `Interrupt` but before `SpeechInterrupted` were already in flight — discard them. See [Interruption Handling](/docs/flux-tts/interrupt-handling) for the full pattern.

## Configure

Update synthesis configuration mid-conversation without reconnecting.

```json
{
  "type": "Configure",
  "speed": 1.15
}
```

| Field   | Type          | Required | Description                                                                                                                                                                         |
| ------- | ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`  | `"Configure"` | yes      | Message type identifier.                                                                                                                                                            |
| `speed` | number        | no       | Speech-rate multiplier. `0.5` to `1.5` in `0.05` increments, defaulting to `1.0`. Not supported for every language; an unsupported model or language returns `SPEED_NOT_SUPPORTED`. |

Updates apply at the **next segment boundary** — the active segment finishes under the prior configuration, and audio already synthesized is never re-generated. The server replies with [`ConfigureSuccess`](/docs/flux-tts/server-messages#configuresuccess--configurefailure) on receipt and validation (not on application), or [`ConfigureFailure`](/docs/flux-tts/server-messages#configuresuccess--configurefailure) (`SPEED_OUT_OF_RANGE` / `SPEED_INCREMENT_INVALID` / `SPEED_NOT_SUPPORTED`), which leaves the prior configuration active. Omitted fields keep their current values.

## Close

Gracefully close the connection. The server finishes draining all queued audio, emits a final [`SessionMetadata`](/docs/flux-tts/server-messages#sessionmetadata) with cumulative totals, then closes the socket.

```json
{"type": "Close"}
```

## Keeping a session alive

The server closes an idle session after **60 seconds** with no inbound client message ([`NET-0004`](/docs/flux-tts/server-messages#error-codes)). If your agent may go quiet longer than that between turns, send a WebSocket **Ping** or **Pong** to reset the timer.

## Related resources

* [Server Messages](/docs/flux-tts/server-messages) — the responses to everything on this page
* [The Speech Lifecycle](/docs/flux-tts/state) — how these messages drive turn state
* [Build a Flux TTS Voice Agent](/docs/flux-tts/voice-agent) — these messages in a full agent loop
* [Getting Started](/docs/flux-tts/quickstart) — connect and send your first turn

---