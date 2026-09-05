# Models

# Models

Async provides multiple models optimized for different use cases.

## Text-to-Speech Models

| Model | Tier  | Languages | Best For |
|-------|------|---------|----------|
| `async_pro_v1.0` | Pro | English | Highest quality, content production, audiobooks |
| `async_flash_v1.5` | Standard | 6 languages | Real-time streaming, voice agents, low-latency apps |
| `async_flash_v1.0` | Standard | 15 languages | Broad language support (Armenian, Russian, etc.) |

### async_pro_v1.0 — Best Quality

High-quality TTS model for the most natural-sounding speech. Fast streaming with accurate handling of dates, numbers, currencies, and abbreviations.

- **Languages:** English
- **Text normalization:** Built-in (dates, currencies, numbers, abbreviations)
- **Pricing:** $1.00/hour of generated audio

### async_flash_v1.5 — Smart & Fast

A latency-optimized streaming TTS model with strong built-in handling of non-standard text such as dates, currencies, numbers, and abbreviations.

- **Languages:** English, Spanish, French, German, Italian, Portuguese
- **Text normalization:** Built-in (dates, currencies, numbers, abbreviations)
- **Pricing:** $0.50/hour of generated audio

### async_flash_v1.0 — Multilingual

Legacy model with the broadest language support. Use this for languages not yet supported by Flash v1.5.

- **Languages:** English, French, Spanish, German, Italian, Portuguese, Arabic, Russian, Romanian, Japanese, Hebrew, Armenian, Turkish, Hindi, Chinese
- **Text normalization:** Not available
- **Unique parameters:**
  - `speed_control` (0.7 – 2.0) — Adjusts the speaking speed
  - `stability` (0 – 100) — Adjusts how stable or expressive the voice sounds
- **Pricing:** $0.50/hour of generated audio

## Speech-to-Text Models

| Model | Languages | Best For |
|-------|-----------|----------|
| `async_asr_v1.0` | Multilingual (Armenian, English, Russian, and more) | Transcription, live captioning, voice input |

### async_asr_v1.0

Multilingual speech recognition model. Supports file upload and real-time streaming via WebSocket.

- **Languages:** English, French, Spanish, German, Italian, Portuguese, Arabic, Russian, Romanian, Japanese, Hebrew, Armenian, Turkish, Hindi, Chinese
- **Input:** Any common audio format (WAV, MP3, FLAC, WebM, OGG, M4A)
- **Streaming:** PCM16, 16 kHz, mono
- **Pricing:** Billed per processed audio duration

## Choosing a Model

**For highest audio quality:** Use `async_pro_v1.0` — best naturalness for pre-rendered content.

**For voice agents and real-time apps:** Use `async_flash_v1.5` — optimized for low latency with best text normalization.

**For Armenian, Russian, or other languages not in Flash v1.5:** Use `async_flash_v1.0`.

**For transcription:** Use `async_asr_v1.0` — the only ASR model currently available.

## Important Notes

- The `speed_control` and `stability` parameters are **only supported by `async_flash_v1.0`**. They have no effect on the other models.
- All TTS models support the same voice library — you can use any voice with any model.
- All TTS models support custom phonemes, digit pronunciation, and silent pauses (`<break>` tag).

