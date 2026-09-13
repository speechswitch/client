> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Server Messages

The server replies to your [Client Messages](/docs/flux-tts/client-messages) with JSON text frames interleaved with binary audio frames. This page documents every server-to-client message and the error/warning code reference.

**Cadence at a glance:** `SpeechStarted` marks the start of a turn and `SpeechMetadata` marks its end — **every audio frame for a turn arrives between the two.** `Flush` is your signal that all of the turn's text has been sent; once it arrives, `SpeechMetadata` is our signal that all of the turn's audio has been sent.

## Connected

Sent immediately on a successful connection. Successor to v1/speak's `Metadata` message.

```json
{
  "type": "Connected",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "model_name": "flux-haley-en",
  "model_version": "2026.06.01",
  "model_uuids": ["b3e47c20-9f81-4a2e-bd15-8d7c6e2a1f09"]
}
```

| Field           | Type                   | Description                                                                                             |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `request_id`    | string (UUID)          | ID of the `/v2/speak` request.                                                                          |
| `model_name`    | string                 | Resolved model name (e.g. `flux-haley-en`).                                                             |
| `model_version` | string                 | Resolved model version.                                                                                 |
| `model_uuids`   | array of string (UUID) | Resolved model UUIDs. A list, because a resolved model may be backed by more than one underlying model. |

## SpeechStarted

Emitted at the **start of each new turn**, before audio streaming begins. Carries the server-assigned `speech_id`. Fires **once per turn**.

```json
{
  "type": "SpeechStarted",
  "speech_id": "dg_sp_a1b2c3d4e5f6"
}
```

The `speech_id` is a server-minted identifier of the form `dg_sp_<12 hex digits>`. It is informational — useful for correlating logs.

**When a turn becomes active.** A `Speak` received while idle (the first `Speak`, or the first after a `SpeechMetadata`) starts a new active turn, and we emit `SpeechStarted`. There is only ever **one active turn**: a `Speak` received *after* you've `Flush`ed the active turn but *before* its `SpeechMetadata` starts a **pending** turn. The active turn stays active until its `SpeechMetadata` — if you haven't received `SpeechMetadata`, the turn is still being synthesized — at which point the next pending turn becomes active and gets its own `SpeechStarted`.

## SpeechMetadata

Emitted once per turn, after we've sent **all** of the turn's audio — our signal that synthesis for the turn is complete and no more audio is coming for it. It follows your `Flush`, which tells us no more text is coming for the turn. Reports billing and timing for the completed turn.

```json
{
  "type": "SpeechMetadata",
  "speech_id": "dg_sp_a1b2c3d4e5f6",
  "audio_duration_ms": 3200,
  "input_character_count": 47,
  "billable_character_count": 47,
  "controls_applied": {
    "pronunciations_applied": 0,
    "breaks_applied": 0,
    "pronunciation_warnings": 0
  }
}
```

| Field                      | Type    | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech_id`                | string  | Server-assigned turn identifier. Informational.                                                                                                                                                                                                                                                                                                                                                                                     |
| `audio_duration_ms`        | integer | Total audio duration produced for this turn, in milliseconds.                                                                                                                                                                                                                                                                                                                                                                       |
| `input_character_count`    | integer | Raw input character count for this turn, before text normalization.                                                                                                                                                                                                                                                                                                                                                                 |
| `billable_character_count` | integer | Billable character count for this turn — the input minus stripped inline-control characters; always ≤ `input_character_count`.                                                                                                                                                                                                                                                                                                      |
| `controls_applied`         | object  | Counts of the inline controls the server acted on this turn: `pronunciations_applied` (pronunciation overrides that took effect), `breaks_applied` (pauses that took effect), and `pronunciation_warnings` (entries that failed validation). A control that was rejected or dropped is reported through a `Warning` and not counted here. Inline controls are coming soon on Flux TTS; all three counts report `0` until they ship. |

**Per-turn vs. cumulative.** Per-turn counts are reported here, once per turn (at `Flush`). Cumulative totals are reported once, at session end, in [`SessionMetadata`](#sessionmetadata) as `total_*`.

## SpeechInterrupted

Sent in response to an [`Interrupt`](/docs/flux-tts/client-messages#interrupt). Reports exactly what the user heard and what they didn't, plus a nested `metadata` block carrying the same shape as a standalone `SpeechMetadata` body.

```json
{
  "type": "SpeechInterrupted",
  "audio_played_ms": 2340,
  "text_spoken": "Sure, I can help you cancel your subscription.",
  "text_remaining": " Let me pull up your account.",
  "metadata": {
    "speech_id": "dg_sp_a1b2c3d4e5f6",
    "audio_duration_ms": 2340,
    "input_character_count": 47,
    "billable_character_count": 47,
    "controls_applied": {
      "pronunciations_applied": 0,
      "breaks_applied": 0,
      "pronunciation_warnings": 0
    }
  }
}
```

| Field             | Type              | Description                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio_played_ms` | integer           | How much audio the client had played when the interrupt landed, in milliseconds **from the start of the session**. Echoes `Interrupt.playback_offset` when supplied; otherwise the server's own count of audio generated so far. When you interrupt without an offset, use this as the baseline your next `playback_offset` must advance past. |
| `text_spoken`     | string (optional) | The portion of the turn's text the user heard, aligned against `audio_played_ms`. **Omitted when the `Interrupt` carried no `playback_offset`.**                                                                                                                                                                                               |
| `text_remaining`  | string (optional) | The portion the user did not hear. Omitted under the same condition.                                                                                                                                                                                                                                                                           |
| `metadata`        | object            | Per-turn billing/timing for the interrupted turn — the same body as a standalone [`SpeechMetadata`](#speechmetadata).                                                                                                                                                                                                                          |

**One event per interrupted turn.** On `Interrupt`, only `SpeechInterrupted` fires — the server does not also emit a standalone `SpeechMetadata`. Read `SpeechMetadata.<field>` for completed turns and `SpeechInterrupted.metadata.<field>` for interrupted ones. Feed `text_spoken` back into your LLM context so the next turn doesn't repeat what the user already heard.

## Flushed

Emitted when the turn's buffer has actually been flushed after a manual [`Flush`](/docs/flux-tts/client-messages#flush) — **not** on receipt of the `Flush`, and it can be held back behind earlier pending turns. The turn's `SpeechMetadata` follows.

```json
{
  "type": "Flushed",
  "speech_id": "dg_sp_a1b2c3d4e5f6"
}
```

## SessionMetadata

Final server message before the WebSocket closes. Reports cumulative session totals — the sum across all turns.

```json
{
  "type": "SessionMetadata",
  "total_audio_duration_ms": 184500,
  "total_input_character_count": 4280,
  "total_billable_character_count": 4280
}
```

An `Interrupt` rebases `total_audio_duration_ms` onto the audio the client actually played — audio generated past the interrupt point stops counting toward the session, so the total can decrease after a barge-in.

This is the one place cumulative totals are reported. Combined with the per-turn numbers in `SpeechMetadata`, you get clean reconciliation: per-turn for granular tracking, plus a final authoritative total.

## ConfigureSuccess / ConfigureFailure

### ConfigureSuccess

Sent when a [`Configure`](/docs/flux-tts/client-messages#configure) message is accepted. Echoes the applied configuration. Fires on receipt and validation, not on application — the change takes effect at the next segment boundary.

```json
{
  "type": "ConfigureSuccess",
  "applied": {
    "speed": 1.15
  }
}
```

### ConfigureFailure

Sent when a `Configure` message is rejected. The failing message has no effect — the prior configuration is retained and synthesis continues uninterrupted.

```json
{
  "type": "ConfigureFailure",
  "code": "SPEED_OUT_OF_RANGE",
  "field": "speed",
  "value": 3.5,
  "description": "speed must be between 0.5 and 1.5 in 0.05 increments"
}
```

`field` and `value` identify the rejected field and the value you sent; they are present only when the failure is tied to a specific field/value. See the [ConfigureFailure codes](#configurefailure-codes) below.

## Warning

Informational message; synthesis continues and the connection is unaffected. Every warning carries a `code` and a human-readable `description`.

```json
{
  "type": "Warning",
  "code": "NO_ACTIVE_SPEECH",
  "description": "There is no active turn. The request will be ignored."
}
```

See the [warning codes](#warning-codes) below. Warnings are not rate-limited — every occurrence is emitted.

## Error

A fatal, server-originated error. Unlike a `Warning`, an `Error` is always followed by a WebSocket close.

```json
{
  "type": "Error",
  "code": "MESSAGE-0000",
  "description": "The message could not be parsed."
}
```

See the [error codes](#error-codes) below.

## Warning codes

All warning codes follow Deepgram's `SCREAMING_SNAKE_CASE` convention; the session stays open in every case.

**Turn-scoped:**

| Code                    | Trigger                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_ACTIVE_SPEECH`      | A `Flush` arrived with no active turn. The request is ignored.                                                                              |
| `NO_SYNTHESIZABLE_TEXT` | The turn's text was entirely whitespace or punctuation. No audio is produced; the turn completes with a zero-duration `SpeechMetadata`.     |
| `SYNTHESIS_RETRYING`    | A synthesis request to the model failed and is being retried. The session continues; a fatal `Error` is sent only if retries are exhausted. |

**Inline controls and markup** (inline pause and pronunciation controls are coming soon; their codes take effect when they ship):

| Code                                   | Trigger                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INPUT_MARKUP_STRIPPED`                | Recognized SSML / competitor markup was stripped from `Speak.text` before synthesis. See [Markup handling](/docs/flux-tts/client-messages#markup-handling). |
| `PRONUNCIATION_WARNINGS`               | One or more inline pronunciation strings failed IPA validation. Failing entries are dropped; valid entries still apply.                                     |
| `PRONUNCIATION_TOO_LONG`               | A pronunciation's IPA string exceeded the maximum length and was dropped.                                                                                   |
| `PRONUNCIATIONS_LIMIT_EXCEEDED`        | More than 500 pronunciation controls in one request. The offending text is dropped.                                                                         |
| `BREAKS_LIMIT_EXCEEDED`                | More than 50 pause controls in one request, or two pauses with no intervening text. The offending text is dropped.                                          |
| `BREAK_TOKENS_OUT_OF_RANGE`            | One or more pause tokens specified an out-of-range duration and were ignored.                                                                               |
| `BREAK_TOKENS_WITH_INVALID_INCREMENTS` | One or more pause tokens specified a duration off the `0.1s` increment and were ignored.                                                                    |

**Interrupt-scoped** (in every case the `Interrupt` is ignored and no `SpeechInterrupted` is sent):

| Code                       | Trigger                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `NO_AUDIO_GENERATED`       | The `Interrupt` arrived before the session produced any audio — there is nothing to interrupt. |
| `INTERRUPT_IN_PROGRESS`    | An earlier `Interrupt` is still being processed. At most one is handled at a time.             |
| `INVALID_INTERRUPT_OFFSET` | The `playback_offset` did not advance past the position a prior interrupt established.         |

## ConfigureFailure codes

| Code                      | Trigger                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `SPEED_OUT_OF_RANGE`      | `speed` is outside the supported range (`0.5`–`1.5`). Prior config retained.     |
| `SPEED_INCREMENT_INVALID` | `speed` is inside the range but off the `0.05` increment. Prior config retained. |
| `SPEED_NOT_SUPPORTED`     | `speed` sent on a model/language that does not support runtime speed control.    |

## Connection rejection codes

An invalid `expressivity` value rejects the connection with an HTTP `400` before the WebSocket upgrade completes — no `Connected` message is sent. See [Expressivity](/docs/tts-expressivity).

| Code                             | Trigger                                             |
| -------------------------------- | --------------------------------------------------- |
| `EXPRESSIVITY_OUT_OF_RANGE`      | `expressivity` was outside the `-2` to `2` range.   |
| `EXPRESSIVITY_INCREMENT_INVALID` | `expressivity` was not a whole number (e.g. `1.5`). |

## Error codes

Every error is fatal and is followed by a WebSocket close frame. Codes use Deepgram's `DOMAIN-NNNN` convention.

| Code           | Error                      | Trigger                                                                                                                                          |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MESSAGE-0000` | Unparseable client message | A client message could not be parsed.                                                                                                            |
| `DATA-0000`    | Invalid command            | A message contained an invalid command.                                                                                                          |
| `DATA-0002`    | Malformed inline control   | `Speak.text` carried a malformed inline control. A control that is merely out of range or over a limit produces a `Warning` instead.             |
| `BIG-0000`     | Message too large          | A message was too large to process.                                                                                                              |
| `NET-0000`     | Internal server error      | The server hit an unexpected condition.                                                                                                          |
| `NET-0001`     | Failed to receive message  | The server failed to receive a message.                                                                                                          |
| `NET-0002`     | Failed to send message     | The server failed to send a message. In practice you won't observe this — if the server can't send messages, it can't deliver this error either. |
| `NET-0003`     | Time limit exceeded        | The session time limit (1 hour) was exceeded.                                                                                                    |
| `NET-0004`     | Inactive client            | No client message arrived within the 60s inactivity window; the session was closed. Send a WebSocket Ping or Pong to keep an idle session alive. |

## Related resources

* [Client Messages](/docs/flux-tts/client-messages) — the messages these respond to
* [The Speech Lifecycle](/docs/flux-tts/state) — how these events sequence across a turn
* [Cross-Turn Context](/docs/flux-tts/context) — voice consistency across turns

---