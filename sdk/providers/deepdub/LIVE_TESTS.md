# Live checks — 2026-09-05 UTC

These small, synthetic requests used the trial credential explicitly published
in Deepdub's introduction. No user content or private credentials were used.
The key is not an SDK default, and regular tests never call the live service.

## New adapter, native Node

Called this adapter's `synthesize` with text `Speechswitch integration test.`,
locale `en-US`, the published sample voice
`bd1b00bb-be1c-4679-8eaa-0fcbfd4ff773`, and `output: { format: "mp3" }`.
The adapter sent its resolved 48000 Hz rate, enabled audio cleanup, and a fresh
generation UUID. Each operation had an explicit 15-second AbortSignal deadline.

| Model | Bytes received | Chunks observed | Time to first chunk |
| --- | ---: | ---: | ---: |
| `og-1.1` | 33069 | 4 | 2067 ms |
| `lightning-2.5` | 45357 | 12 | 898 ms |
| `phantom-x-3.2` | 33453 | 4 | 861 ms |

All completed without an adapter or HTTP error. This is a smoke test, not a
latency benchmark or an acoustic-quality evaluation.

A separate call through this adapter with Lightning 2.5, `ogg_opus`, and text
`Speechswitch codec test.` rejected the live response with the codec-mismatch
error before yielding any audio bytes. Thus the guard was also exercised against
the upstream service, not only a constructed local fixture.

## Raw protocol probes

Text: `Speechswitch streaming test.`; same sample voice and locale.

- `dd-etts-3.0`, default MP3: HTTP 200, `audio/mpeg`, 32685 bytes.
- `dd-etts-3.2`, MP3: HTTP 200, 26925 bytes.
- `dd-etts-2.5`, `format: "opus"`, rate omitted: HTTP 200,
  `application/ogg`, 41665 bytes. The first Ogg packet starts with `01 76 6f 72
  62 69 73` (`\x01vorbis`), not `OpusHead`.
- `dd-etts-2.5`, `format: "opus"`, explicit 48000 Hz: HTTP 200, 34825 bytes.
- `dd-etts-3.2` and `dd-etts-3.0`, `format: "opus"`, 16000 Hz:
  HTTP 400 with `{"success":false,"message":"Internal error"}`. The 3.2 probe
  also included `publish: false`; the 3.0 probe did not. No causal claim is made
  about which setting caused the failure.

The wrong-codec response motivated the adapter's initial Ogg codec guard. Local
tests replay a Vorbis identification packet and verify that no bytes are yielded
as requested Opus. Selecting MP3 avoids that upstream mismatch.

Reference-only cloning, accent blending, duration, seeds, gain and other optional
controls have type/wire/local HTTP coverage, not live validation in this run.
The separate WebSocket protocols were researched but not exercised or implemented
in this HTTP-scoped PR.
