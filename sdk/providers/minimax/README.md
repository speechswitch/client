# MiniMax Speech

`synthesize("minimax", request, options)` always returns an audio iterator. Whole
text uses HTTP SSE; incremental text uses the native bidirectional WebSocket
endpoint, including cancel/resume and flush. Ordinary WAV and FLAC with voice
effects require non-streaming HTTP responses; consumers still use the same SDK
operation and iterator.

```ts
import { synthesize } from "../../dispatch.ts";

for await (const event of synthesize("minimax", {
  model: "speech-2.8-hd",
  voice: "existing-system-cloned-or-generated-voice-id",
  text: "Hello!",
  output: { format: "mp3", sampleRateHz: 32000, bitRateBps: 128000 },
})) {
  // Untimed HTTP audio is Uint8Array; completion is { event: "done" }.
}
```

## Model and request capabilities

The canonical TypeScript schema—not the adapter—defines valid model, transport,
voice, language, and output combinations. Base types stay free of variant unions.
Omitted model selects `speech-2.8-hd`; omitted language selects `auto`, except
`formulaReading: "latex"`, which selects Chinese and permits only `language: "zh"`.
Formula text must use the native double-dollar delimiters.

| Models | Model-specific controls |
| --- | --- |
| `speech-01-hd` / `speech-01-turbo`, `speech-02-hd` / `speech-02-turbo` | Legacy language set; excludes Persian, Filipino, Tamil |
| `speech-2.6-hd` / `speech-2.6-turbo` | Expanded languages; additional `fluent` / `whisper` emotions |
| `speech-2.8-hd` / `speech-2.8-turbo` | Expanded languages; WebSocket `splitTurns` (inverse of `continuous_sound`) |

All accept existing voice IDs. Alternatively, `voiceBlend` selects one to four
voices with integer relative weights from 1 to 100; weights need not total 100.
The type excludes simultaneous `voice` and `voiceBlend`. Voice creation/upload is
not part of synthesis; reference audio is not substituted for voice selection.

Independent controls include speed, volume scale, emotion, pronunciation
replacements, and native pitch adjustment (`pitchBias`). Upstream does not define
that adjustment in semitones, so it is not exposed as `pitchSemitones`.
`voiceTransform` groups brightness, softness, crispness, and acoustic effects.
Its numeric adjustments and blend weights must be integers. Integer bounds,
blend cardinality, and strictly-positive volume live in the TypeScript schema and
generate specialized checks in all four languages. Streaming piece lengths remain
protocol checks because primitive async-element lengths are not yet annotatable.

HTTP `textNormalization` controls Chinese/English normalization. WebSocket
`languageTextNormalization` controls its documented English-only normalization.
They are not silently substituted for each other. Native inline pronunciation,
pause markers, and model-specific interjections pass through unchanged.
Replacement rules use the native slash separator; slash-containing rules are
excluded because no escape syntax is documented.

Output keeps `format`, `sampleRateHz`, `bitRateBps`, and `channelCount` separate.
Supported formats are MP3, raw PCM, FLAC, WAV, raw μ-law, μ-law WAV, and Ogg Opus.
Native `opus` is Ogg Opus, not raw Opus. μ-law requires 8 kHz. The schema does not
invent undocumented raw PCM sample encoding or byte order. MP3 alone accepts
bitrate; `constantBitRate` is HTTP-streamed MP3 only. Streaming voice effects are
MP3-only; non-streaming effects also permit FLAC/WAV.

## Bidirectional input and output

```ts
async function* input() {
  yield "First answer."
  yield { command: "clear" } as const
  yield "Replacement answer."
  yield { command: "flush" } as const
}

for await (const event of synthesize("minimax", {
  voice: "saved-voice", text: input(), splitTurns: false,
})) {
  // Audio envelopes preserve native trace/session IDs.
  // clear / flush are emitted only for actual server acknowledgements.
}
```

The adapter waits for `connected_success` and `task_started` before acquiring
text. It sends text incrementally without client-side sentence batching. Native
sentence buffering remains on the server. Standalone whitespace is held for the
next non-whitespace piece because the service drops whitespace-only frames;
trailing standalone whitespace is discarded on flush, clear, or input completion.
Pieces are limited conservatively to fewer than 10,000 UTF-16 code units. Pending
whitespace that cannot fit a native frame with text is rejected, not silently lost.

`clear` sends `task_cancel`, suppresses in-flight audio, emits `event: "clear"`
after `task_canceled`, then resumes input on the same connection. `flush` sends
`task_flush` without closing input or preventing a subsequent clear. Input EOF
sends `task_finish`. The adapter keeps native completion levels distinct:

- `is_final` → envelope `requestComplete`, not session completion.
- `sentence_start` / `sentence_end` → `sentenceBoundary`, not fabricated timing.
- `task_finished` → `event: "done"`.

Ordered WebSocket envelopes preserve native request trace IDs and session IDs;
they do not assign one request ID to each input item. Flush IDs likewise retain
native identity, not a guessed input-to-output mapping. Native error codes,
including soft queue errors 2204/2205, are preserved. Such errors end this SDK
operation: the protocol has no safe per-input rejection identity for blind retry.
The native idle timeout is approximately 120 seconds; there is no automatic
keepalive policy in this adapter.

## Timestamps and source quality

HTTP `timestampGranularity: "word" | "sentence"` downloads the native subtitle
file after audio finishes. Its flat JSON entries use millisecond times; fractional
values are preserved. Timings use independent `timeline` envelopes, without
inventing source offsets or chunk association. Download requests do not forward
API credentials or cookies and do not follow redirects. Streaming HTTP explicitly
excludes the final aggregated audio copy to avoid duplicate playback.

The [OpenAPI contract](https://platform.minimax.io/docs/api-reference/speech/t2a/api/openapi.json)
describes nullable data as a non-nullable object and omits subtitle file contents.
The [bidirectional AsyncAPI contract](https://platform.minimax.io/docs/api-reference/speech/t2a/api/asyncapi-bidi.json)
types voice blends as an object despite array examples, and enables subtitle
requests without defining a subtitle response payload. Consequently, neither
contract drives wire codegen. WebSocket timestamps and HTTP `word_streaming`
subtitles are deliberately not advertised without a trustworthy response shape.

The wire implementation is handwritten against unchanged, SHA-256-cataloged
first-party contracts, prose, and pinned MiniMax CLI sources under
`schemas/sources/minimax/`. The CLI establishes subtitle file shape and Ogg/μ-law
format details. Canonical TypeScript still generates request validators,
playground controls, and Rust/Python/Go request/output types and validators.
Python and Go implement the HTTP and bidirectional socket protocols; the Rust adapter
follows on this same provider branch. The 14 cataloged sources were freshly fetched
with verified TLS on 2026-09-07; every content hash matched the existing catalog.

## Authentication and lifecycle

Set `auth.minimax.apiKey`, `SPEECHSWITCH_MINIMAX_API_KEY`, or `MINIMAX_API_KEY`, in
that precedence order. HTTP defaults to `https://api.minimax.io`; `baseUrl` can
select the documented `https://api-uw.minimax.io` HTTP endpoint or a proxy.
WebSocket defaults to `/ws/v1/t2a_v2_bidi`, not the older per-piece endpoint.

Native Node/Bun WebSockets authenticate with a bearer upgrade header, not a key
in the URL. Browsers need a server-side call or an already-authenticated
`webSocket` override. `fetch`, `baseUrl`, `webSocketUrl`, and `webSocket` are
injectable; an injected socket is exclusive and closed at the end. A socket
override cannot bypass the generated WebSocket request restrictions.

`signal` and `timeoutMs` cover connection, input, audio, and subtitle downloads.
Consumer return sends native cancellation when possible and releases the
transport. Producer cleanup never waits indefinitely for an uncooperative return
promise. No third-party runtime dependency is introduced.

Verification uses protocol fixtures, real Node loopback handshakes, TypeScript 7,
playground materialization, and compiled Rust/Python/Go examples. No paid MiniMax
synthesis request was made during these checks.
