> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate Speech

> REST endpoint: POST /v1/tts/generate — one request, streamed PCM response.

Generate audio from text. The response streams raw audio bytes as they are
produced.

<ParamField path="POST" method="/v1/tts/generate" />

## Request Body

This is the canonical parameter reference for TTS generation. The WebSocket
endpoints accept the same fields (plus their own session controls — see
[Stream Input](/api-reference/tts/stream-input#config-message)).

<ParamField body="text" type="string" required>
  The text to convert to speech. It must contain at least one non-whitespace
  character and is limited to 10,000 characters. Supports inline
  [`<break>`](/prompting/breaks), [`<spell>`](/prompting/spell), and
  [`<prosody rate>`](/prompting/speed#per-span-speed-with-prosody-rate) tags.
  Other SSML has no stable stripping or interpretation contract; remove it
  before sending text (see [Prompting](/prompting/overview#unsupported-tags)).
  Empty, whitespace-only, or oversized text returns `400 VALIDATION_ERROR`.
</ParamField>

<ParamField body="model_id" type="string" default="kugel-3">
  The model to use. Use `kugel-3` for new integrations. Legacy IDs such as `kugel-2.5` and `kugel-2-turbo` remain accepted for backwards compatibility. The legacy request field `model` is also accepted as an alias when `model_id` is omitted; do not send both. Unknown IDs return `400 VALIDATION_ERROR`. Accepted model IDs are billed and shown in Dashboard usage as requested, even when they route through the current production model.
</ParamField>

<ParamField body="voice_id" type="integer | string" required>
  The voice handle or legacy numeric ID to use. Required — there is no default voice. A request without a
  `voice_id` is rejected with `400 MISSING_VOICE_ID`; a `voice_id` that doesn't
  exist (or isn't visible to your API key) returns `404 NOT_FOUND`.
</ParamField>

<ParamField body="cfg_scale" type="number" default="2.0">
  Classifier-free guidance scale. Range: 1.2-2.5 (inclusive); values outside this range are clamped into it. Higher values = more expressive.
</ParamField>

<ParamField body="temperature" type="number" default="0.4">
  Sampling variance (0.0–1.0). 0 = most stable, 1 = most variance. See
  [temperature guidance](#temperature-guidance). Values outside the range
  return `400 VALIDATION_ERROR`.
</ParamField>

<ParamField body="max_new_tokens" type="integer" default="2048">
  Maximum tokens to generate. Range: 1-2048. Limits output length. Values
  outside the range return `400 VALIDATION_ERROR`.
</ParamField>

<ParamField body="sample_rate" type="integer" default="24000">
  Output sample rate in Hz. Options: 8000, 16000, 22050, 24000, 44100.

  Audio is generated natively at 24kHz. Other rates use server-side resampling.
  Any other value returns `400 VALIDATION_ERROR`.
</ParamField>

<ParamField body="output_format" type="string">
  Combined codec + rate token (e.g. `ulaw_8000`) for non-PCM output such as
  G.711 telephony codecs. Opt-in; when set it is authoritative and must not
  contradict an explicitly non-default `sample_rate`. The wire-default
  `sample_rate: 24000` is ignored when resolving the token. See
  [Audio formats](/api-reference/tts/audio-formats).
</ParamField>

<ParamField body="normalize" type="boolean" default="true">
  Enable text normalization (converts numbers, dates, etc. to spoken words).

  Always specify the `language` parameter to ensure correct normalization — auto-detection may produce incorrect results for short texts.
</ParamField>

<ParamField body="language" type="string">
  ISO 639-1 language code for text normalization (e.g., 'de', 'en', 'fr').

  Supported: de, en, fr, es, it, pt, nl, pl, sv, da, no, fi, cs, hu, ro, el, uk, bg, tr, vi, ar, hi, zh, ja, ko, sk, sl, hr, sr, ru, he, fa, ur, bn, ta, yue, th, id, ms

  If not provided and `normalize` is true, language will be auto-detected. Auto-detection may produce incorrect normalizations for short texts or languages that share similar vocabulary.
  Other values return `400 VALIDATION_ERROR`.
</ParamField>

<ParamField body="word_timestamps" type="boolean" default="false">
  **WebSocket endpoints only.** Enable word-level timestamp alignment — see
  [Word timestamps](/streaming/word-timestamps). Not accepted by this REST
  endpoint: requests are strictly validated, so sending it here returns
  `400 Bad Request`. Use a WebSocket endpoint or an SDK instead.
</ParamField>

<ParamField body="speaker_prefix" type="boolean" default="true">
  **WebSocket endpoints only.** Prepend an internal speaker prefix to the text
  for better voice consistency. Not accepted by this REST endpoint (strict
  validation returns `400`).
</ParamField>

<ParamField body="speed" type="number" default="1.0">
  Playback speed multiplier. Range: `0.8` (20% slower) to `1.2` (20% faster).

  Uses pitch-preserving time-stretching (WSOLA) so the voice pitch stays natural at any speed.
  Applies to the whole request; wrap text in `<prosody rate="slow|medium|fast|0.8-1.2">` to override
  the rate for a span (see [Speed](/prompting/speed#per-span-speed-with-prosody-rate)).
  Values outside the range return `400 VALIDATION_ERROR`; unlike `cfg_scale`,
  `speed` is not clamped.
</ParamField>

<ParamField body="project_id" type="integer">
  Project whose custom dictionaries should be loaded. Omit it to generate
  without project dictionaries. A non-empty `dictionary_ids` selection
  requires `project_id`; the API verifies that the caller can access that
  project when `dictionary_ids` is non-empty. A bare inaccessible `project_id`
  currently falls back to generation without a dictionary; an explicit
  selection fails with `403 UNAUTHORIZED`.
</ParamField>

<ParamField body="dictionary_ids" type="integer[]">
  Per-request [dictionary](/features/dictionaries) selection.

  * **Omitted** — when `project_id` is set, all active dictionaries of that project apply, filtered by language; without `project_id`, no project dictionary is loaded.
  * **`[]`** — no dictionary applies to this request.
  * **`[7, 9]`** — exactly those dictionaries apply, including inactive ones, bypassing the language filter.

  A non-empty list requires `project_id`. IDs must belong to that project;
  unknown IDs return a `400` before generation starts. Maximum 50 IDs.
</ParamField>

### Temperature guidance

`temperature` controls how much the sampler varies across regenerations of the
same text. Lower values are closer to greedy decoding (stable, repeatable
reads); higher values are more expressive but less consistent.

| Use case                                    | Suggested range               |
| ------------------------------------------- | ----------------------------- |
| E-learning, IVR prompts, compliance reads   | `0.0` – `0.3`                 |
| General voiceover, conversational UX        | `0.4` – `0.6` (default `0.4`) |
| Expressive narration, ads, character voices | `0.7` – `1.0`                 |

The default of `0.4` tracks the TTS Studio `natural` preset. Lowered from `0.5`
to reduce intermittent word-drop on short trailing sentences with `kugel-3`.

## Spell Tags

Use `<spell>` tags to spell out text letter by letter. This is useful for:

* Email addresses
* Acronyms and abbreviations
* Serial numbers or codes
* Any text that should be pronounced character by character

```json theme={null}
{
  "text": "My email is <spell>kajo@kugelaudio.com</spell>",
  "normalize": true,
  "language": "en"
}
```

**Output:** "My email is K, A, J, O, at, K, U, G, E, L, A, U, D, I, O, dot, C, O, M"

<Note>
  Content inside spell tags automatically bypasses text normalization;
  `normalize` still applies to surrounding prose. Special characters are
  translated to language-specific words:

  * English: `@` → "at", `.` → "dot"
  * German: `@` → "ät", `.` → "Punkt"
  * French: `@` → "arobase", `.` → "point"
</Note>

<Tip>
  **Model recommendation**: Use `kugel-3` for the best current spelling, prosody, and `break` tag support.
</Tip>

## Response

Returns the requested raw encoding as a streaming binary response. The default
is PCM16 (`audio/pcm`); G.711 output uses `audio/basic`. For encoding details
and the watermark, see
[Audio formats](/api-reference/tts/audio-formats).

**Response Headers:**

| Header                      | Value       | Description                                                                                                      |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `Content-Type`              | `audio/pcm` | `audio/pcm` for PCM16; `audio/basic` for G.711                                                                   |
| `X-Sample-Rate`             | `24000`     | Resolved output sample rate (shown: default)                                                                     |
| `X-Audio-Format`            | `pcm_s16le` | Resolved encoding: `pcm_s16le`, `mulaw`, or `alaw` (shown: default)                                              |
| `X-KugelAudio-AI-Generated` | `true`      | AI-generated audio disclosure (see [Audio formats](/api-reference/tts/audio-formats#ai-generated-audio-marking)) |

With the default format, the response body is raw **PCM 16-bit signed
little-endian** audio data streamed as binary chunks.

## Example

<Warning>
  Encode JSON as UTF-8. For predictable normalization of short or ambiguous
  text, set `language` explicitly. Unicode NFC normalization can also make
  equivalent composed and decomposed input consistent before it reaches the
  API.
</Warning>

<CodeGroup>
  ```bash cURL theme={null}
  curl -X POST "https://api.kugelaudio.com/v1/tts/generate" \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{
      "text": "Hello, this is a test of the KugelAudio API.",
      "model_id": "kugel-3",
      "voice_id": 1071,
      "cfg_scale": 2.0
    }'
  ```

  ```python Python theme={null}
  from kugelaudio import KugelAudio

  client = KugelAudio(api_key="YOUR_API_KEY")

  audio = client.tts.generate(
      text="Hello, this is a test of the KugelAudio API.",
      model_id="kugel-3",
      voice_id=1071,
      cfg_scale=2.0,
  )

  audio.save("output.wav")
  ```

  ```typescript JavaScript theme={null}
  import { KugelAudio } from 'kugelaudio';

  const client = new KugelAudio({ apiKey: 'YOUR_API_KEY' });

  const audio = await client.tts.generate({
    text: 'Hello, this is a test of the KugelAudio API.',
    modelId: 'kugel-3',
    voiceId: 1071,
    cfgScale: 2.0,
  });
  ```
</CodeGroup>

## Errors

See [Error Codes](/api-reference/errors) for the full TTS error lookup table,
including HTTP status codes, WebSocket close codes, and rate-limit behavior.

## Related endpoints

<CardGroup cols={2}>
  <Card title="Stream Speech" icon="wave-square" href="/api-reference/tts/stream">
    Same request, audio chunks streamed over a WebSocket
  </Card>

  <Card title="Stream Input" icon="keyboard" href="/api-reference/tts/stream-input">
    Token-by-token text input for LLM agents
  </Card>
</CardGroup>
