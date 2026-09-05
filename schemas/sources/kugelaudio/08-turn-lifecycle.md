> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Turn lifecycle

> What a turn is, how it starts and ends, session reuse across turns, and per-session usage reporting.

On `/ws/tts/stream` (and via every SDK streaming session), one **turn** = one
assistant utterance = one backend voice session. The WebSocket connection
itself persists *across* turns; the turn is the unit that begins, produces
audio, and gets billed. A graceful turn ends with `session_closed`; a cancelled
turn ends with `interrupted` instead.

Getting the turn boundary right is the difference between a smooth agent and
one that pauses mid-sentence or splits a reply in two.

## What a turn is

| Concept                  | Lifetime                | Created by                                                         | Ended by                                                                            |
| ------------------------ | ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **WebSocket connection** | Minutes–hours; reused   | `connect()` / first request                                        | `{"close_socket": true}` or disconnect                                              |
| **Turn (session)**       | One assistant utterance | First text after connect or after `session_closed` / `interrupted` | `flush`, idle auto-flush, or `close` (graceful); `cancel` or disconnect (abandoned) |

The first text message after the connection opens (or after the previous turn
ends) starts a new turn on a fresh backend voice session. The configuration
(`voice_id`, sample rate, etc.) is sticky from the previous turn unless you
send a new config message.

## What triggers synthesis

You do **not** control when audio generation starts — the server does. It
buffers the text you send and hands a chunk to the model at natural sentence
boundaries. Inside one turn, model state (KV cache, voice
conditioning) carries across chunks, so prosody stays natural.

This is why you send LLM tokens directly without flushing: the buffer
reassembles them and the model only ever sees sentence-sized work.

## How a turn ends

A turn ends gracefully in one of three ways. A `cancel` abandons it with an
`interrupted` frame instead, while a disconnect abandons it without an ack.

### 1. `flush` — recommended

```json theme={null}
{"flush": true}
```

Emits any trailing buffered text and streams its audio. Once the turn's last
audio frame has been delivered, the server sends
[`{"final": true}`](#final-vs-session_closed) (the end-of-audio signal),
followed by [`session_closed`](#final-vs-session_closed). The socket stays
open for the next turn. **End every turn with an explicit flush** — it's the
lowest latency path and the only one that's deterministic.

### 2. Idle auto-flush — the 5-second timeout

If you stream text but never flush, the server ends the turn for you after
**5 seconds without new text**. You'll receive:

1. a [`warning`](#the-warning-frame) frame — `"Turn ended after 5s of
   inactivity. Send {\"flush\": true} to end a turn explicitly — it lowers
   latency and avoids this auto-flush."`
2. the remaining buffered text synthesized and streamed,
3. `final`, then `session_closed`.

<Warning>
  **WebSocket ping/keep-alive frames do NOT reset the 5 s timer.** Only new
  text or a `flush` does. If your LLM stalls for more than 5 s mid-turn (slow
  tool call, long reasoning pause) and you've already sent partial text, the
  turn ends at that point — and the rest of the reply becomes a *second* turn
  (billed as a separate session). If you can't avoid long mid-turn gaps, hold
  the text client-side until you're ready to stream it.
</Warning>

### 3. `close` — graceful end

```json theme={null}
{"close": true}
```

Like `flush`, but explicit about intent: flush buffered text, drain audio, end
the session. `{"end_session": true}` is an alias. The WebSocket stays open.
(To also close the connection, send `{"close_socket": true}`.)

To *abandon* a turn instead of finishing it — user interrupted, drop the
buffered text — that's [barge-in](/streaming/barge-in), not `close`.

## `final` vs `session_closed`

Every gracefully ended turn closes with **two** frames, in order:

1. **`final` — end of audio** (the ElevenLabs `isFinal` equivalent). Sent
   right after the turn's last audio frame. Once you receive it, no further
   audio for the turn will arrive — key your "audio is done" logic (stop
   waiting, end playback, hang up the call) on this frame.

```json theme={null}
{
  "final": true,
  "total_audio_seconds": 5.4,
  "total_text_chunks": 3,
  "total_audio_chunks": 15
}
```

2. **`session_closed` — end of turn**, carrying the
   [usage block](#per-session-usage) for billing:

```json theme={null}
{
  "session_closed": true,
  "total_audio_seconds": 5.4,
  "total_text_chunks": 3,
  "total_audio_chunks": 15,
  "usage": { "audio_seconds": 5.4, "characters": 142, "cost_cents": 0.49, "currency": "eur", "model_id": "kugel-3" }
}
```

`final` is sent on every graceful turn end (`flush`, idle auto-flush, or
`close`) but **not** after a [`cancel`](/streaming/barge-in) — a barge-in
acknowledges with `interrupted` instead. Note that on the single-request
`/ws/tts` endpoint, `final` is the request-complete message and carries the
usage itself — see the
[Stream Speech reference](/api-reference/tts/stream#final-message). Full
streaming message reference:
[Stream Input API](/api-reference/tts/stream-input#final-end-of-audio).

### The `warning` frame

`{"warning": "..."}` is a non-fatal advisory; the socket stays open. Today it
is emitted in one case: the turn was auto-ended by the idle timeout because no
`flush` was sent. Log it — in a correctly built integration it should never
appear.

## Who is responsible for what

| You are responsible for                                                  | The server is responsible for                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Sending text as it becomes available (no client-side sentence buffering) | Buffering text and choosing sentence-boundary chunks                                                      |
| Sending `flush` exactly once, at the end of each turn                    | Starting synthesis and preserving prosody across chunks within the turn                                   |
| Not leaving a turn idle >5 s mid-utterance                               | Ending idle turns (after a `warning`) so sessions can't leak                                              |
| Keying "audio done" on `final` and billing on `session_closed`           | Emitting `final` after the last audio frame, then `session_closed` with usage, on every graceful turn end |
| Playback, buffering, and [barge-in](/streaming/barge-in) decisions       | Cancelling generation when you barge in                                                                   |

## Session reuse

WebSocket connections are reused across turns, so consecutive turns skip the
connection handshake entirely (see [Latency](/latency#pre-connect-at-startup)
for what that saves). After `session_closed`, just send the next turn's text —
the config (`voice_id`, audio format, etc.) is sticky. Send a new config
message only to change something (e.g. a different voice):

<CodeGroup>
  ```python Python SDK theme={null}
  async with client.tts.streaming_session(voice_id=1071) as session:
      # Turn 1
      async for chunk in session.send("Hello from voice one."):
          play_audio(chunk.audio)
      async for chunk in session.flush():
          play_audio(chunk.audio)

      # Change voice for turn 2 after flush ended turn 1 (no new WebSocket needed)
      session.update_config(voice_id=1072)
      async for chunk in session.send("Hello from voice two."):
          play_audio(chunk.audio)

  # close() is called by the context manager — closes session + WebSocket
  ```

  ```javascript JavaScript SDK theme={null}
  const session = client.tts.streamingSession(
    { voiceId: 1071 },
    { onChunk: (chunk) => playAudio(chunk.audio) }
  );
  await session.connect();

  // Turn 1
  session.send('Hello from voice one.');
  await session.endSession();

  // Turn 2 on the same connection
  session.updateConfig({ voiceId: 1072 });
  session.send('Hello from voice two.');

  await session.close(); // Closes session + WebSocket
  ```

  ```python Raw WebSocket theme={null}
  # End the current turn, then wait for session_closed:
  await ws.send(json.dumps({"close": True}))
  # ... receive session_closed ...

  # Start a new turn on the same connection:
  await ws.send(json.dumps({
      "voice_id": 1072,
      "text": "New turn, different voice.",
      "flush": True,
  }))
  # ... receive audio for turn 2 ...
  ```
</CodeGroup>

## Per-session usage

Every `session_closed` frame carries a `usage` object summarising what the
turn consumed and what it was charged — useful for per-conversation billing
of your own customers:

| Field           | Description                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `audio_seconds` | Total audio generated this turn (the unit we bill on)                                             |
| `characters`    | Total input characters submitted this turn                                                        |
| `cost_cents`    | Actual amount charged, in **EUR cents**. `null` if the charge could not be determined (see below) |
| `currency`      | Currency of `cost_cents` (`"eur"`); present only when `cost_cents` is set                         |
| `model_id`      | Model that produced the audio                                                                     |

If the charge cannot be determined at turn end (e.g. a transient billing
error), `cost_cents` is `null` and the object carries `"cost_unavailable": true`
instead of a misleading `0`. `audio_seconds` is always reported, so you can
still reconcile usage from the audio you received.

**On `/ws/tts/multi`, usage is reported per synthesized, billable context** —
the `usage` object is attached to that context's **`context_closed`** frame,
with the same `audio_seconds`, `characters`, `cost_cents`, `currency`, and
`model_id` fields. A context closed before synthesis starts has no usage block.
The multi `session_closed` frame is a connection-wide end signal with
`total_audio_seconds`; it has no `context_id` and does **not** carry a usage
block. See
[Multi-context streaming](/streaming/multi-context).

The single-request `/ws/tts` endpoint carries the same `usage` object on its
`final` message (per request rather than per turn) — see the
[Stream Speech API reference](/api-reference/tts/stream#final-message).

## Troubleshooting

<AccordionGroup>
  <Accordion title="The reply stops early, at a sentence boundary">
    Almost always the idle auto-flush. Look for the `warning` frame in your
    message log — if it's there, your client streamed part of the text, then
    went >5 s without sending more or flushing, so the server ended the turn.
    The most common causes: a slow LLM/tool call mid-turn, or a missing final
    `flush`. Note the turn split also splits billing: you'll see two
    `session_closed` frames, each with its own `usage`.
  </Accordion>

  <Accordion title="My client hangs waiting for the end of the stream">
    Check what you're waiting for: a graceful turn ends with `final` (end of
    audio) followed by `session_closed` (turn end + usage). A turn ended by
    `cancel` (barge-in) emits **neither** — it acknowledges with
    `interrupted`. If you only handle `final`, a barge-in path will hang.
  </Accordion>

  <Accordion title="I send pings but the turn still ends after 5 s">
    By design: ping/keep-alive frames don't reset the idle timer — only new
    text or `flush` does. The timer exists to reap abandoned turns; a ping
    proves the socket is alive, not that the turn is still being written.
  </Accordion>
</AccordionGroup>
