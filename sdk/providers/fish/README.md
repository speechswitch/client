# Fish Audio

One `synthesize` operation streams HTTP audio for complete text, MessagePack
WebSocket audio for incremental text, and SSE envelopes when timestamps are
requested. No third-party runtime dependency or generated wire client is used.

```ts
import { synthesize } from "../../index.ts";

const audio = synthesize("fish", {
  model: "s2-pro",
  voice: "your-existing-custom-or-library-voice-id",
  text: "Hello!",
  output: { format: "mp3" },
}, { auth: { fish: { apiKey: "..." } } });

for await (const chunk of audio) {
  // Consume incrementally; buffering is a consumer decision.
}
```

## Model and voice capabilities

The plain provider request union covers `s1`, `s2-pro`, `s2.1-pro`, and
`s2.1-pro-free`. Model selection is always explicit: Fish silently falls back to
its current default for unknown names. S1 excludes multi-speaker input and the
loudness-normalization control it would otherwise ignore.

`voice` selects an existing library or custom voice. Independently,
`referenceSamples: [{ audio: Uint8Array, text: "exact transcript" }]` supplies one
or more conditioning recordings (WAV/MP3/FLAC). Inline samples need no voice ID.
They are transmitted as raw MessagePack binary values, not base64 JSON strings.
Inline recordings are an SDK capability; the current generic playground JSON
form does not hydrate binary input. Use existing voice IDs in the playground.

For S2 dialogue use `speakers: [{ voice: "a" }, { voice: "b" }]`, or an array of
`{ referenceSamples: [...] }` groups. Text addresses their indexes using
`<|speaker:0|>` and `<|speaker:1|>`. Do not also provide top-level conditioning.
Mixed catalog/inline speaker groups are not claimed without upstream evidence.
Emotion cues remain in text (S1 parentheses; S2 brackets); language is detected
automatically rather than exposing an unsupported language option.

Format and sample rate are independent; bitrate is available only for MP3/Opus.
Omitting sample rate uses Fish's documented 44100 Hz default (48000 for Opus).
The provider does not publish an exhaustive accepted sample-rate list, so the
adapter does not invent one. Default MP3 bitrate is 128000 bps; omitted Opus
bitrate selects automatic. Speed, decibel gain, loudness normalization, sampling,
text chunking, conditioning, latency, normalization and feature flags map directly
to the documented request controls with provider-neutral names.

## Streaming and cancellation

An async text iterator accepts strings and `{ command: "flush" }`. Input end sends
`stop`; the output ends on a successful native `finish`. Fish documents neither a
clear command nor a flush acknowledgement, so neither is fabricated. For barge-in,
abort the operation, clear local playback and start a new operation. Abort,
deadline, protocol failure and consumer exit close the connection; stalled input
or a stalled iterator `return()` cannot block socket cancellation.

`auth.fish.apiKey` takes precedence over `SPEECHSWITCH_FISH_API_KEY`, then
`FISH_API_KEY`. Native Node/Bun sockets attach Bearer auth and model headers at the
provider boundary. Browser sockets cannot set these headers: supply an
authenticated `webSocket` override from a backend/proxy workflow. API keys are
never placed in URLs. HTTP `fetch`, socket, base URL, complete socket URL, signal,
and whole-operation `timeoutMs` are injectable public options.

## Timestamp snapshots

Use `timestampGranularity: "segment"` with complete text. Fish promises text
segments, not necessarily words. The ordinary `synthesize` iterator yields
`correlation: "timeline"` envelopes with `correlationId` from native `chunk_seq`
and `timelineOffsetMs` from native `chunk_audio_offset_sec`. Segment times are
relative to that group; add its offset for absolute audio time.

Append every envelope's audio in arrival order. When `timestampUpdate` is
`"replace"`, replace the group's entire stored timestamp list, including an empty
list. A null native alignment omits `timestampUpdate` and does not erase prior
timing. `durationMs` describes the alignment group's native duration, not the
individual audio packet. Snapshots are emitted immediately, including revisions;
the adapter never buffers them until synthesis ends or appends duplicate segments.

## Source discipline and verification

Unmodified source snapshots and hashes are in `schemas/sources/fish` and
`schemas/sources.yaml`. The live OpenAPI leaves `/v1/tts` successful audio content
unspecified. Speed bounds and model-dependent loudness behavior are only prose;
inline reference audio requires MessagePack despite a string-shaped schema.
The advertised standalone AsyncAPI URL returned 404 when collected; the published
WebSocket markdown retains its embedded protocol definition. These contracts do
not warrant wire codegen. Normalized request/item checks **are** generated from
the authored TypeScript, including integer and array-cardinality constraints.
Only nonempty byte-buffer checks remain handwritten because the schema does not
yet express byte-length bounds.

Tests cover exact wire payloads, raw inline bytes, model/type narrowing, generated
validation, chunked SSE revisions, cancellation and fairness, native Node auth
handshakes, model-aware playground controls, and independent MessagePack fixtures.
No paid live-provider synthesis was performed.
