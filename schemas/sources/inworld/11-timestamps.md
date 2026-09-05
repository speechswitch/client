> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Timestamps

<iframe
  style={{ aspectRatio: '16 / 9', width: '100%', height: 'auto' }}
  src="https://www.youtube.com/embed/9J4-i70eH-s?si=9KJndJ9KIhk3SaST"
  title="Inworld TTS - Timestamp Alignment"
  frameBorder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowFullScreen>
</iframe>

Timestamp alignment lets you retrieve timing information that matches the generated audio, which is useful for experiences like word highlighting, karaoke‑style captions, and lipsync. The examples and behavior described on this page apply to the Realtime TTS-2 models (`inworld-tts-2`, `inworld-tts-2-flash`).

<Note>Timestamp alignment is available in every language the model supports — see [Languages](/tts/capabilities/multilingual#supported-languages).</Note>

Set the `timestampType` request parameter to control granularity:
  - `WORD`: Return timestamps for every token in the original text — words, punctuation, and whitespace — in the exact order they were given, with phoneme-level timing and viseme symbols.
  - `CHARACTER`: Return timestamps for each character or punctuation

<Note>
  Enabling timestamp alignment can increase latency (especially for the non-streaming endpoint).
</Note>

When enabled, the response includes timestamp arrays:
  - `WORD`: `timestampInfo.wordAlignment` with `words`, `wordStartTimeSeconds`, `wordEndTimeSeconds`, and `phoneticDetails`. The `words` array covers every token from the original input in order, so the alignment maps back to the full text without gaps.
  - `CHARACTER`: `timestampInfo.characterAlignment` with `characters`, `characterStartTimeSeconds`, `characterEndTimeSeconds`

See the [API reference](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech) for full details.

## Streaming behavior

You can control how timestamp data is delivered alongside audio using [`timestampTransportStrategy`](/api-reference/ttsAPI/texttospeech/synthesize-speech-stream#body-timestamp-transport-strategy).

### Sync (default)

Audio and alignment arrive together in each chunk. Every chunk contains both audio data and its corresponding timestamps.

```
Chunk 1: audio + timestamps for chunk 1
Chunk 2: audio + timestamps for chunk 2
Chunk 3: audio + timestamps for chunk 3
```

This is the simplest approach, however the first audio will be slightly delayed.

### Async

Audio chunks arrive first, followed by separate trailing messages containing only timestamp data. This reduces time-to-first-audio, since the server doesn't need to wait for alignment computation before sending audio.

```
Chunk 1: audio only
Chunk 2: audio only
Chunk 3: audio only
Chunk 4: timestamps only (alignment for chunks 1–3)
Chunk 5: timestamps only
...
```

Use async when you prioritize playback speed and can handle timestamps arriving after their corresponding audio. Use sync when you need audio and timestamps together in each chunk (e.g., for real-time lip-sync or word highlighting during playback).

Set `timestampTransportStrategy` to `SYNC` or `ASYNC` in your request. See the [API reference](/api-reference/ttsAPI/texttospeech/synthesize-speech-stream#body-timestamp-transport-strategy) for details.

### Response structure

Returns alignment data with phoneme-level timing and viseme symbols for lip-sync animation.

```json
{
  "timestampInfo": {
    "wordAlignment": {
      "words": ["", "Hello", " ", "world", ", ", "this", " ", "will", " ", "be", " ", "saved", "."],
      "wordStartTimeSeconds": [0, 0.24, 0.59, 0.59, 1.09, 1.29, 1.52, 1.52, 1.62, 1.62, 1.73, 1.73, 2.34],
      "wordEndTimeSeconds": [0.24, 0.59, 0.59, 1.09, 1.29, 1.52, 1.52, 1.62, 1.62, 1.73, 1.73, 2.34, 2.34],
      "phoneticDetails": [
        {
          "wordIndex": 0,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 0, "durationSeconds": 0.24, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 1,
          "phones": [
            {"phoneSymbol": "h", "startTimeSeconds": 0.24, "durationSeconds": 0.14, "visemeSymbol": "cdgknstxyz"},
            {"phoneSymbol": "ɛ", "startTimeSeconds": 0.38, "durationSeconds": 0.04, "visemeSymbol": "aei"},
            {"phoneSymbol": "l", "startTimeSeconds": 0.42, "durationSeconds": 0.05, "visemeSymbol": "l"},
            {"phoneSymbol": "ə", "startTimeSeconds": 0.47, "durationSeconds": 0.07, "visemeSymbol": "aei"},
            {"phoneSymbol": "ʊ", "startTimeSeconds": 0.54, "durationSeconds": 0.05, "visemeSymbol": "o"}
          ]
        },
        {
          "wordIndex": 2,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 0.59, "durationSeconds": 0, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 3,
          "phones": [
            {"phoneSymbol": "w", "startTimeSeconds": 0.59, "durationSeconds": 0.1, "visemeSymbol": "qw"},
            {"phoneSymbol": "ˈɝ", "startTimeSeconds": 0.69, "durationSeconds": 0.03, "visemeSymbol": "r"},
            {"phoneSymbol": "ɫ", "startTimeSeconds": 0.72, "durationSeconds": 0.23, "visemeSymbol": "l"},
            {"phoneSymbol": "d", "startTimeSeconds": 0.95, "durationSeconds": 0.14, "visemeSymbol": "cdgknstxyz"}
          ]
        },
        {
          "wordIndex": 4,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 1.09, "durationSeconds": 0.2, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 5,
          "phones": [
            {"phoneSymbol": "ð", "startTimeSeconds": 1.29, "durationSeconds": 0.07, "visemeSymbol": "th"},
            {"phoneSymbol": "ɪ", "startTimeSeconds": 1.36, "durationSeconds": 0.05, "visemeSymbol": "ee"},
            {"phoneSymbol": "s", "startTimeSeconds": 1.41, "durationSeconds": 0.11, "visemeSymbol": "cdgknstxyz"}
          ]
        },
        {
          "wordIndex": 6,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 1.52, "durationSeconds": 0, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 7,
          "phones": [
            {"phoneSymbol": "w", "startTimeSeconds": 1.52, "durationSeconds": 0.03, "visemeSymbol": "qw"},
            {"phoneSymbol": "ə", "startTimeSeconds": 1.55, "durationSeconds": 0.03, "visemeSymbol": "aei"},
            {"phoneSymbol": "ɫ", "startTimeSeconds": 1.58, "durationSeconds": 0.04, "visemeSymbol": "l"}
          ]
        },
        {
          "wordIndex": 8,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 1.62, "durationSeconds": 0, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 9,
          "phones": [
            {"phoneSymbol": "b", "startTimeSeconds": 1.62, "durationSeconds": 0.05, "visemeSymbol": "bmp"},
            {"phoneSymbol": "i", "startTimeSeconds": 1.67, "durationSeconds": 0.06, "visemeSymbol": "ee"}
          ]
        },
        {
          "wordIndex": 10,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 1.73, "durationSeconds": 0, "visemeSymbol": "bmp"}
          ]
        },
        {
          "wordIndex": 11,
          "phones": [
            {"phoneSymbol": "s", "startTimeSeconds": 1.73, "durationSeconds": 0.14, "visemeSymbol": "cdgknstxyz"},
            {"phoneSymbol": "ˈe", "startTimeSeconds": 1.87, "durationSeconds": 0.17, "visemeSymbol": "ee"},
            {"phoneSymbol": "ɪ", "startTimeSeconds": 2.04, "durationSeconds": 0.05, "visemeSymbol": "ee"},
            {"phoneSymbol": "v", "startTimeSeconds": 2.09, "durationSeconds": 0.06, "visemeSymbol": "fv"},
            {"phoneSymbol": "d", "startTimeSeconds": 2.15, "durationSeconds": 0.19, "visemeSymbol": "cdgknstxyz"}
          ]
        },
        {
          "wordIndex": 12,
          "phones": [
            {"phoneSymbol": "[silence]", "startTimeSeconds": 2.34, "durationSeconds": 0, "visemeSymbol": "bmp"}
          ]
        }
      ]
    }
  }
}
```
#### Phonetic details structure

Each entry in `phoneticDetails` contains:

| Field | Description |
| :---- | :---- |
| `wordIndex` | 0-based index into the `words` array. Speech tokens have full phoneme breakdowns; non-speech tokens have a single `[silence]` phone (may be zero-length). |
| `phones` | Array of phonemes for this token. |
| `isPartial` | Deprecated. This field may still appear in responses for backward compatibility, but it is always `false`. |

Each phone entry contains:

| Field | Description |
| :---- | :---- |
| `phoneSymbol` | The phone symbol: IPA for speech phones, or `[silence]` for non-speech tokens. |
| `startTimeSeconds` | Start time of the phoneme in seconds. |
| `durationSeconds` | Duration of the phoneme in seconds. |
| `visemeSymbol` | The viseme symbol for lip-sync animation. |

#### Viseme symbols

The following viseme symbols are used for lip-sync animation:

| Viseme | Description |
| :---- | :---- |
| `aei` | Open mouth vowels (a, e, i, ə, ʌ, æ, ɑ, etc.) |
| `o` | Rounded vowels (o, ʊ, əʊ, oʊ, etc.) |
| `ee` | Front vowels (i, ɪ, eɪ, etc.) |
| `bmp` | Bilabial consonants (b, m, p) |
| `fv` | Labiodental consonants (f, v) |
| `l` | Lateral consonant (l) |
| `r` | Rhotic sounds (r, ɝ, ɚ) |
| `th` | Dental fricatives (θ, ð) |
| `qw` | Rounded consonants (w, ʍ) |
| `chjsh` | Postalveolar/palatal consonants (tʃ, dʒ, ʃ, ʝ) |
| `cdgknstxyz` | Alveolar/velar consonants (c, d, g, k, n, s, t, x, y, z) |
