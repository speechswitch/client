> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Audio Formats

> Output encodings, the output_format token, G.711 telephony codecs, audio chunk fields, and the AI-generated audio marking (watermark + disclosure header).

This page is the single reference for what the TTS endpoints emit: the default
PCM encoding, the opt-in `output_format` codecs, the audio chunk wire format,
and the AI-generated audio marking (watermark and disclosure header).

## Default format

* **Encoding:** PCM 16-bit signed little-endian (`pcm_s16le`)
* **Channels:** Mono (1 channel)
* **Sample rate:** 24000 Hz (default; native generation rate)
* **Byte order:** Little-endian

Other supported `sample_rate` values (8000, 16000, 22050, and 44100) use
server-side resampling. The combined native `output_format` tokens below do
not include `pcm_44100`; 44100 is available through the legacy integer
`sample_rate` field (and through the ElevenLabs-compatible format dialect).

<Info>
  **AI-generated audio marking (EU AI Act Art. 50):** All generated audio is
  watermarked in-band and every response carries a disclosure header. See
  [AI-generated audio marking](#ai-generated-audio-marking) below.
</Info>

## Output formats (`output_format`)

By default the API emits linear PCM16 at `sample_rate`. To request a different
codec — for example G.711 µ-law/a-law for telephony — send the combined
`output_format` token instead of (or in addition to) `sample_rate`. The token
carries codec **and** rate as one value, so impossible combinations like
"µ-law at 24 kHz" cannot be expressed.

| `output_format` | Codec        | Rate  | `enc` in audio frames | Bytes/sample |
| --------------- | ------------ | ----- | --------------------- | ------------ |
| `pcm_8000`      | Linear PCM16 | 8000  | `pcm_s16le`           | 2            |
| `pcm_16000`     | Linear PCM16 | 16000 | `pcm_s16le`           | 2            |
| `pcm_22050`     | Linear PCM16 | 22050 | `pcm_s16le`           | 2            |
| `pcm_24000`     | Linear PCM16 | 24000 | `pcm_s16le`           | 2            |
| `ulaw_8000`     | G.711 µ-law  | 8000  | `mulaw`               | 1            |
| `alaw_8000`     | G.711 a-law  | 8000  | `alaw`                | 1            |

Notes:

* **Backwards compatible.** Omitting `output_format` is identical to the
  default behavior — you get `pcm_s16le` frames. The strict checks below only
  apply to requests that send `output_format`.
* **Conflicts are rejected.** Sending both `output_format` and an explicitly
  non-default `sample_rate` that disagrees with the token's rate returns a
  `VALIDATION_ERROR` (HTTP 400 / WS error frame). The value `24000` is treated
  as the released SDKs' serialized wire default rather than evidence of an
  explicit conflicting choice. Prefer sending only `output_format`, or matching
  values.
* **Sticky streaming config.** On [Stream Input](/api-reference/tts/stream-input)
  and [Multi-Context](/api-reference/tts/multi-context), a format sent on an
  ordinary config/context message persists until another valid ordinary
  message changes it. The acknowledged `update_settings` command accepts only
  generation parameters and rejects `output_format` and `sample_rate`.
* **G.711 frame semantics.** For `ulaw_8000` / `alaw_8000`, audio frames carry
  `enc: "mulaw"` / `"alaw"`, `sr: 8000`, and `samples` equals the byte length
  (1 byte/sample). Decode with the standard G.711 tables (e.g. Python
  `audioop.ulaw2lin(payload, 2)`). On REST, the response uses
  `Content-Type: audio/basic` and `X-Audio-Format: mulaw`/`alaw`.

### Telephony example (µ-law 8 kHz)

```json theme={null}
{
  "text": "Your verification code is 4 8 1 5.",
  "voice_id": 1071,
  "output_format": "ulaw_8000",
  "language": "en"
}
```

## Audio chunk fields

Every WebSocket endpoint streams audio as JSON frames with these fields:

| Field        | Type    | Description                                                   |
| ------------ | ------- | ------------------------------------------------------------- |
| `audio`      | string  | Base64-encoded audio data (encoding per `enc`)                |
| `enc`        | string  | Audio encoding (`pcm_s16le`, `mulaw`, or `alaw`)              |
| `idx`        | integer | Chunk index (0-based)                                         |
| `sr`         | integer | Sample rate in Hz                                             |
| `samples`    | integer | Number of samples in this chunk                               |
| `chunk_id`   | integer | Text chunk ID (present on every native WebSocket audio frame) |
| `context_id` | string  | Context identifier (present on `/ws/tts/multi`)               |

## AI-generated audio marking

Every audio stream KugelAudio produces is marked as AI-generated in two
independent ways, as required by EU AI Act Article 50 (Regulation (EU)
2024/1689):

1. **An in-band watermark** embedded in the audio signal itself.
2. **A disclosure header** on every audio response.

You do not need to enable anything: marking is mandatory and applied on every
synthesis request, on every endpoint (native REST and WebSocket,
ElevenLabs-compatible REST and WebSocket, and Vapi).

### Disclosure header

Every HTTP audio response carries:

| Header                      | Value  | Description                                |
| --------------------------- | ------ | ------------------------------------------ |
| `X-KugelAudio-AI-Generated` | `true` | The audio in this response is AI-generated |

WebSocket endpoints return the same header
(`x-kugelaudio-ai-generated: true`) in the connection handshake response. It
appears alongside the existing `X-Sample-Rate` and `X-Audio-Format` headers on
REST responses.

### Watermark

The watermark is produced inside the TTS engine's audio decoder, before any
output encoding, so every `output_format` (PCM at any rate, G.711 µ-law/a-law,
and proxy-side encodings such as MP3) derives from already-marked audio.

Mechanism: small side layers read the decoder's own intermediate activations
and add an imperceptible mask to its output. The source id is not written into
a single chunk — it selects a codeword spread across roughly 4 seconds of
audio, recovered by correlating the detector's per-window payload evidence
against the codebook. The codeword adds redundancy to payload recovery.

Payload:

| Bits | Field     | Meaning                                                            |
| ---- | --------- | ------------------------------------------------------------------ |
| 12   | Source id | `0` = KugelAudio cloud platform; `1`-`4095` = assigned deployments |

Decoding is blind: the detector searches sample offsets within one detector
window and tries every codeword rotation. This allows source attribution when
a sufficiently long clip starts between generation chunks; ambiguous payloads
leave the source id unset.

The added signal is held to −42 dBFS RMS with a −32 dBFS sample-peak ceiling,
and never pushes samples past full scale.

### Detecting the watermark

```bash theme={null}
pip install "kugelaudio[watermark]"
```

```python theme={null}
from kugelaudio.watermark import WatermarkDetector

detector = WatermarkDetector()
result = detector.detect_file("speech.wav")

if result.ai_generated:
    print(result.confidence, result.customer_id)
```

The detector is \~152 KB, ships inside the package, runs on numpy with no
tensor runtime, and works offline. Clips under one second are rejected rather
than answered unreliably. The source id needs the roughly four seconds a
codeword spans; shorter clips report `ai_generated` with `customer_id` left
unset rather than guessing.

### Robustness and limitations

The detector accepts mono floating-point samples at any positive sample rate
and converts them to the native 24 kHz rate before scoring. Lossy encoding,
noise, and editing can weaken either presence detection or payload recovery;
a positive presence result does not guarantee that a source id can be
recovered.

Known limitations:

* **Payload size.** Twelve bits identify the source, not an individual request.
* **Non-speech audio.** The detector is trained on speech; broadband synthetic
  noise is out of distribution and can score above the threshold. Treat a
  positive on non-speech material as unreliable.
* **Payload confidence.** Short or ambiguous clips report presence with
  `customer_id` left unset instead of guessing a source.
* **Editing and encoding.** Deleting spans, adding noise, or applying lossy
  encoding can degrade detection and attribution.

## Related

<CardGroup cols={2}>
  <Card title="Generate Speech" icon="play" href="/api-reference/tts/generate">
    The canonical request parameter reference
  </Card>

  <Card title="ElevenLabs-compatible output" icon="arrow-right-arrow-left" href="/integrations/elevenlabs-proxy#output-formats">
    MP3 and ElevenLabs-shaped responses via the proxy
  </Card>
</CardGroup>
