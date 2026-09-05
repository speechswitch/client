> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generating Audio

## Voices
Inworld offers a variety of built-in voices across available languages that showcase a range of vocal characteristics and styles. These voices can be immediately tried out in TTS Playground and used in your applications.

For greater customization, we recommend [voice cloning](/tts/instant-voice-cloning). Create distinct, personalized voices tailored to your experience, with as little as 3 seconds of audio.

Regardless of model, a voice delivers the best speaker similarity when synthesizing text in its native language — the language it was cloned in. For synthesizing other languages, see [Cross-lingual support](/tts/capabilities/multilingual#cross-lingual-support).

## Language Support

The Realtime TTS-2 models support 200+ languages and locales. See [Languages](/tts/capabilities/multilingual) for the full list and tips for synthesizing multilingual text.

## Supported Formats
  Multiple audio formats are available via API to support different application requirements. The default is MP3.

  - **MP3:** Popular compressed format with broad device and platform compatibility.
    - Sample rate: 16kHz - 48kHz
    - Bit rates: 32kbps - 320kbps
  - **PCM (`PCM`):** Raw uncompressed 16-bit signed little-endian samples with no WAV header. Recommended for WebSocket use cases and real-time applications that process raw audio samples directly without needing container metadata.
    - Sample rate: 8kHz - 48kHz
    - Bit depth: 16-bit
  - **WAV (`WAV`):** Uncompressed 16-bit signed little-endian samples with WAV header optimized for HTTP streaming. For non-streaming, the WAV header is included in the response. For HTTP streaming, the WAV header is included in the first audio chunk only, so all chunks in that response can be concatenated directly into a single valid WAV file. For WebSocket streaming, a WAV header is emitted at the first audio chunk of each `flush`/`flush_completed` event, so direct concatenation without processing is only valid within a single flush; to build one continuous WAV file across multiple flushes, clients must strip or rebuild the repeated headers between flushes.
    - Sample rate: 8kHz - 48kHz
    - Bit depth: 16-bit
  - **Linear PCM (`LINEAR16`):** Uncompressed 16-bit signed little-endian samples with WAV header. Maintained for backward compatibility. For non-streaming, the WAV header is included in the response. For streaming (HTTP streaming or WebSocket), the WAV header is included in every audio chunk, so each chunk is a valid WAV file on its own. Clients must strip headers when concatenating chunks.
    - Sample rate: 8kHz - 48kHz
    - Bit depth: 16-bit
  - **Opus:** High-quality compressed format optimized for low latency web and mobile applications.
    - Sample rate: 8kHz - 48kHz
    - Bit rates: 32kbps - 192kbps
  - **μ-law:** Compressed telephony format ideal for voice applications with bandwidth constraints.
    - Sample rate: 8kHz
  - **A-law:** Compressed telephony format ideal for voice applications with bandwidth constraints.
    - Sample rate: 8kHz

## Additional Configurations
The following optional configurations can also be adjusted as needed when synthesizing audio:
- **Language**: Language the voice should speak the text in. If a localized voice prompt exists for the language, it will be used. If not specified, the original voice prompt will be used and the language will be auto-detected from the input text.
- **Delivery mode**: Only supported by `inworld-tts-2`. Controls how varied the model outputs can be. `STABLE` produces more reliable, predictable speech — best when the output must match the input exactly. `CREATIVE` produces more varied speech with greater emotional range — great for more creative use cases. Defaults to `BALANCED`.
- **Temperature**: Not supported by `inworld-tts-2`. Higher values increase variation, which can produce more diverse outputs with desirable outcomes, but also increases the chances of bad generations and hallucinations. Lower values improve stability and speaker similarity, though going too low increases the chances of broken generation. The default is 1.0.
- **Talking Speed**: Controls how fast the voice speaks. 1.0 is the normal native speed, while 0.5 is half the normal speed and 1.5 is 1.5x faster than the normal speed.
- **Synthesis context**: Supply the text of previous requests from the same session or conversation in the [`synthesisContext`](/api-reference/ttsAPI/texttospeech/synthesize-speech-stream#body-synthesis-context) field to give the model additional context — most useful for short phrases, where the preceding turns help determine the language, meaning, and situation.

<Note>Realtime TTS-2 is trained to condition on the audio of prior conversational turns — the model hears the difference and adjusts how it speaks based on how it was spoken to. This feature is currently only available via the [Realtime API](/realtime/overview). For more information, please reach out to [support@inworld.ai](mailto:support@inworld.ai).</Note>
