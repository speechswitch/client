# Deepgram Aura TTS

`synthesize` accepts a plain provider-owned request. `model` and `language` narrow
the available voices; string text selects HTTP and an async iterable selects the
native WebSocket protocol. The cataloged Aura-1/Aura-2 voice set is covered in both
transports. Existing custom-voice creation and the separate Flux `/v2/speak` API
are not part of the Aura integration requested by issue #7.

Auth resolves at the public boundary, in order: `auth.deepgram.apiKey`,
`SPEECHSWITCH_DEEPGRAM_API_KEY`, `DEEPGRAM_API_KEY`. Native Node/Bun sockets send
`Authorization: Token ...` during the upgrade, never in the URL. Browsers need an
injected authenticated/proxied socket. HTTP fetch, sockets, endpoint URLs, and abort
signals are injectable. Custom HTTP base paths and query parameters are preserved.
`modelImprovementOptOut` maps to the provider's MIP flag on both transports; it can
affect provider pricing. HTTP requests also accept `tags` for usage reporting.
Callback delivery is excluded because it replaces the audio response rather than
returning this operation's audio stream.

Audio remains `Uint8Array` throughout. REST supports PCM, G.711, WAV (linear16 or
G.711), MP3, Ogg Opus, FLAC, and AAC. Fixed sample rates are not sent as configurable
wire parameters. Raw G.711 explicitly requests `container=none`. Provider output
unions and annotated bitrate/speed bounds generate the runtime request checks.

Streaming input accepts strings, `{ command: "flush" }`, and `{ command: "clear" }`.
Flush finishes the current utterance without closing the socket. Input completion
flushes remaining text and waits for the acknowledgement before closing. Clear
can interrupt a pending flush; in-flight audio is discarded until `Cleared` and
subsequent text is held until that acknowledgement. Events preserve the native
`sequenceId`; done events also carry the connection's metadata `traceId` when sent.
Aura does not supply word/character timestamps, so none are inferred from arrival
order. Clear cannot retract audio already delivered to the consumer.

Input and server messages are raced fairly. Abort, premature server closure,
input failure, malformed messages, and consumer cancellation close the transport
and request input cleanup without waiting for a stalled iterator's `return()`.
Warnings/errors fail synthesis, including rejected flushes that otherwise might
leave it waiting forever. An idle connection remains subject to provider limits;
the adapter does not fabricate heartbeat speech or flushes. Callers may use an
abort signal with a deadline.

## Contract decision

The cataloged OpenAPI represents the synchronous audio response as an empty
`application/json` object and leaves codec-dependent combinations in prose. Its
AsyncAPI repeats the same control enums in overlapping `oneOf` branches. These
are not a complete, trustworthy executable contract. The wire protocol therefore
lives directly in `index.ts`; the former fixed-template client generator is removed.
No upstream snapshot is repaired. The catalog retains original definitions and
the official Markdown for Flush, Clear, Close, and media-output combinations.

Tests verify exact catalog hashes, model/voice coverage, normalized request and
item validation, HTTP query/body mappings, streaming lifecycle failures, and native
Node upgrades/authentication. No live paid Deepgram acceptance test has been run.
