> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Barge-in

> Cancel the current turn immediately when the user interrupts — without closing the WebSocket.

In a live voice agent the end user often starts speaking while the agent is
still talking. When your VAD (voice-activity detection) detects this, call
**`cancelCurrent()`** to stop generation for the current turn immediately —
**without** closing the WebSocket.

This differs from `endSession()` / `{"close": true}`, which ends the turn
*gracefully*: it flushes whatever text is still buffered and drains the
remaining audio (see [Turn lifecycle](/streaming/turn-lifecycle#how-a-turn-ends)).
A barge-in does the opposite — it **abandons** the turn:

* The actively-generating sentence is cancelled mid-stream.
* Any text that was buffered or queued but not yet spoken is dropped.
* No further audio chunks for the cancelled turn are emitted after the
  acknowledgement. No `final` (end-of-audio) frame is sent for a cancelled
  turn — the `interrupted` ack takes its place.
* The WebSocket stays open, so you can `send()` the next user turn immediately
  (session config is re-sent automatically on that first `send`).

The call resolves once the server acknowledges with `{"interrupted": true}`
or after the SDK's quiet timeout if the server has gone silent (5 seconds in
JavaScript/Java; 30 seconds in Python).

<CodeGroup>
  ```python Python SDK theme={null}
  async with client.tts.streaming_session(voice_id=1071) as session:
      async for chunk in session.send("This is a very long answer that the user "):
          play_audio(chunk.audio)

      # VAD detected the user speaking over the agent — barge in:
      await session.cancel_current()

      # Socket is still open — start the next turn right away:
      async for chunk in session.send("Sure, what would you like instead?", flush=True):
          play_audio(chunk.audio)
  ```

  ```javascript JavaScript SDK theme={null}
  const session = client.tts.streamingSession(
    { voiceId: 1071 },
    {
      onChunk: (chunk) => playAudio(chunk.audio),
      onInterrupted: () => stopLocalPlayback(),
    }
  );
  await session.connect();

  session.send('This is a very long answer that the user ');

  // VAD detected the user speaking over the agent — barge in:
  await session.cancelCurrent();

  // Socket is still open — start the next turn right away:
  session.send('Sure, what would you like instead?', true);
  ```

  ```java Java SDK theme={null}
  StreamCallbacks callbacks = new StreamCallbacks() {
      @Override public void onChunk(AudioChunk chunk) { playAudio(chunk); }
      @Override public void onInterrupted() { stopLocalPlayback(); }
  };
  StreamConfig config = StreamConfig.builder().voiceId(1071).build();

  try (StreamingSession session = client.streamingSession(config, callbacks)) {
      session.send("This is a very long answer that the user ");

      // VAD detected the user speaking over the agent — barge in:
      session.cancelCurrent();

      // Socket is still open — start the next turn right away:
      session.send("Sure, what would you like instead?", true);
  }
  ```

  ```python Raw WebSocket theme={null}
  # Mid-turn, the user speaks over the agent:
  await ws.send(json.dumps({"cancel": True}))

  # Discard any in-flight audio frames until the ack arrives:
  async for message in ws:
      data = json.loads(message)
      if data.get("interrupted"):
          break

  # The session is fresh — send the next turn on the same connection:
  await ws.send(json.dumps({
      "voice_id": 1071,
      "text": "Sure, what would you like instead?",
      "flush": True,
  }))
  ```
</CodeGroup>

<Note>
  Stop your local audio playback as soon as you call `cancelCurrent()` — don't
  wait for the acknowledgement. A few audio frames already in transit may still
  arrive before the server confirms the cancel; the `onInterrupted` callback
  (JS/Java) marks the point after which no more frames for the cancelled turn
  will come.
</Note>

## Barge-in on the single-request endpoint

The single-request [`/ws/tts`](/api-reference/tts/stream) endpoint accepts the
same `{"cancel": true}` frame: it abandons the request that is generating and
acknowledges with `{"interrupted": true}` instead of `final`, leaving the
socket reusable. It has no session state, so there is no graceful counterpart
(`close` / `end_session` apply to the streaming endpoints only) — close the
socket to end it.

## Barge-in on multi-context sessions

For [multi-context](/streaming/multi-context) sessions, barge-in is **per
context**: call `closeContext(contextId, true)` (JS/Java) /
`close_context(context_id, immediate=True)` (Python), or send
`{"close_context": true, "context_id": "...", "immediate": true}` on the raw
socket. The targeted context's in-flight generation is cancelled and its
buffered text dropped; other contexts and the connection stay open.

`{"cancel": true}` also works here, so the same barge-in code path works on
every endpoint. With a `context_id` it cancels that one context; without one it
cancels **every** context still accepting input. Either way the server replies
`{"interrupted": true}` and the connection stays open.

## Barge-in on the ElevenLabs-compatible endpoint

The [ElevenLabs-compatible](/integrations/elevenlabs-proxy#supported-endpoints)
`/v1/text-to-speech/{voice_id}/stream-input` socket also accepts
`{"cancel": true}`. In-flight generation is dropped and the socket is closed
with code `1000`.

<Warning>
  Do not use ElevenLabs' `{"text": ""}` end-of-stream marker to interrupt. That
  is the *graceful* signal: it flushes buffered text and drains every remaining
  audio frame before the stream ends — the opposite of a barge-in. Send
  `{"cancel": true}` instead.
</Warning>
