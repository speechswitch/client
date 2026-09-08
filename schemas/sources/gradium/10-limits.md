> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Limits

> Session duration, character limits, audio formats, and concurrency

This page summarises the request-level limits that apply to Gradium API
calls. For pricing and credit consumption see
[Credits](/guides/credits).

## Session duration

A single TTS or STT session can last up to **3000 seconds**. This applies
to both the WebSocket and REST POST transports.

If you need to generate or transcribe longer content, split it across
multiple sessions:

* **TTS**: chunk text at sentence boundaries and start a new session
  for each chunk (or open a new WebSocket and send a fresh `setup`).
* **STT**: split audio at silences and submit each segment as a
  separate request.

## Supported audio formats

### TTS output formats

`output_format` accepts:

* `wav`: WAV at 48 kHz, 16-bit signed mono.
* `pcm`: raw PCM at 48 kHz, 16-bit signed mono, 3840-sample (80 ms) chunks.
* `opus`: Ogg-wrapped Opus.
* Lower / higher sample-rate PCM variants: `pcm_8000`, `pcm_16000`,
  `pcm_22050`, `pcm_24000`, `pcm_44100`, `pcm_48000`.
* Telephony: `ulaw_8000` (alias `mulaw_8000`) and `alaw_8000`.

### STT input formats

For STT WebSocket (`input_format` setup field) and STT REST
(`Content-Type` header or `input_format` query parameter), supported
formats are:

* WAV with PCM data, 16/24/32-bit (`audio/wav`, `input_format: "wav"`).
* Raw PCM, 16-bit signed little-endian, mono. The bare value `"pcm"`
  defaults to 24 kHz; explicit rates `"pcm_8000"`, `"pcm_16000"`,
  `"pcm_22050"`, `"pcm_24000"`, `"pcm_44100"`, `"pcm_48000"` are also
  accepted (`audio/pcm` for the REST `Content-Type`).
* Ogg-wrapped Opus (`audio/ogg` or `audio/opus`,
  `input_format: "opus"`).
* Telephony: mu-law (`"ulaw_8000"` / `"mulaw_8000"`) and A-law
  (`"alaw_8000"`) encoded PCM at 8 kHz.

Convert your input to one of the formats above before uploading.

## Concurrency

Concurrent session limits depend on your plan. Contact
[support@gradium.ai](mailto:support@gradium.ai) for the exact limits on
your tier.
