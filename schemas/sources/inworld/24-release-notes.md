> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Release Notes

> Product updates and improvements to TTS

<Update label="August 9, 2026">
  ## Realtime TTS-2 Flash
  Launched Realtime TTS-2 Flash (`inworld-tts-2-flash`), the fastest member of the TTS-2 family — see [Models](/tts/tts-models):
  * **Our lowest latency:** 20 ms time to first audio (server-side P90 TTFB, excluding network latency) — 5× faster than `inworld-tts-2` at 100 ms, making it the best choice for latency-critical real-time agents.
  * **Our lowest cost:** The most cost-efficient model per character, ideal for high-volume workloads.
  * **Full TTS-2 language coverage:** The same 200+ [languages and locales](/tts/capabilities/multilingual) as `inworld-tts-2`, plus instant voice cloning and [timestamp alignment](/tts/capabilities/timestamps).

  <Note>
  [Steering](/tts/capabilities/steering) instructions and [Professional Voice Cloning](/tts/professional-voice-cloning) are supported on `inworld-tts-2` only — use it when you need directed, contextually aware delivery. Non-verbal tags like `[laugh]` work on both models.
  </Note>
</Update>

<Update label="August 6, 2026">
  ## Steering instructions now persist
  Steering on `inworld-tts-2` follows one rule: **a `[tag]` applies from where you write it until you change it.** See the [Steering](/tts/capabilities/steering) guide.
  * **`[reset]`:** New reserved tag that ends a styled passage and returns the voice to its own character for the rest of the text. `[shouting] We need to leave now! [reset] Do you understand me?` shouts only the first sentence.
  * **Instructions survive pauses:** A `<break/>` no longer clears the active instruction. A pause is a pause and never changes delivery.
  * **Request-level `instruction` field:** Set one instruction for the whole request without putting tags in your text. See [`instruction`](/api-reference/ttsAPI/texttospeech/synthesize-speech#body-instruction). Use either this field or inline tags, not both.

  <Warning>
  **Behavior change.** An inline `[tag]` previously affected only the text immediately after it and delivery could revert on its own partway through longer text. A tag now stays in force until you change it. If you relied on an instruction wearing off — for example `[shout] Hi. Normal text.` expecting the second sentence unstyled — add `[reset]` where normal delivery should resume. Requests that use no inline tags are unaffected, as are `inworld-tts-1.5-max` and `inworld-tts-1.5-mini`.
  </Warning>
</Update>

<Update label="May 5, 2026">
  ## Realtime TTS-2
  Launched [Realtime TTS-2](https://inworld.ai/blog/realtime-tts-2) (`inworld-tts-2`), our most powerful and expressive TTS model:
  * **Natural Language Steering:** Direct any voice with bracketed instructions like `[say excitedly]`, `[whisper in a hushed style]`, or free-form directions like `[speak as if barely holding back rage]`. Covers articulation, intonation, volume, pitch, range, speed, vocal style, and non-verbals (`[laugh]`, `[sigh]`, etc.). See the [Steering](/tts/capabilities/steering) guide.
  * **Stronger Multilingual Support:** Production-quality synthesis across 15 languages, plus experimental support for 90+ additional languages. See [Languages](/tts/capabilities/multilingual).
  * **Cross-Lingual Voice Synthesis:** Reuse the same voice across multiple languages. For best results, specify the [`language`](/api-reference/ttsAPI/texttospeech/synthesize-speech#body-language) field.
  * **Voice Localization:** Localize your voice for the most consistent, native-sounding speech in a target language. See [Voice Localization](/tts/capabilities/multilingual#voice-localization).
  * **Delivery Mode:** New [`deliveryMode`](/api-reference/ttsAPI/texttospeech/synthesize-speech#body-delivery-mode) field (`STABLE`, `BALANCED`, `CREATIVE`) controls the trade-off between consistency and emotional range.
  * **Updated Voice Design:** Released an updated version of Voice Design with improved generations. See [Voice Design](/tts/voice-design).
</Update>

<Update label="January 21, 2026">
  ## Inworld TTS 1.5
  Launched [Inworld TTS 1.5](https://inworld.ai/blog/introducing-inworld-tts-1-5), our newest generation of realtime TTS models featuring:
  * **Two New Models:** Our flagship model `inworld-tts-1.5-max` is ideal for most use cases, with the best balance of quality and speed. For use cases where latency is the top priority, we also offer `inworld-tts-1.5-mini`.
  * **Latency Improvements:** Our new TTS-1.5 models achieve P90 latency for first audio chunk delivery under 250ms for our Max model and under 130ms for our Mini model, a 4x improvement compared to TTS-1.
  * **More Expressive and More Stable:** TTS-1.5 is 30% more expressive than prior generations and demonstrates a 40% reduction in word error rates.
  * **Additional Languages:** We've added support for additional languages, including Hindi, Arabic, and Hebrew, bringing total languages supported to 15.
</Update>

<Update label="August 22, 2025">
  ## Updates to Inworld TTS
  Released an upgraded version of the Inworld TTS models with higher overall quality.
  * **Speech Quality:** Clearer, more natural speech with smoother pacing and more accurate pronunciation.
  * **Voice Similarity:** Cloned voices sound closer to the originals, preserving each voice’s unique style.
  * **Non-English Languages:** More consistent, reliable output across supported non-English languages.
  * **Inline custom pronunciation:** New support for inline IPA, giving you control over exact word pronunciations. See [Inline custom pronunciation](/tts/capabilities/custom-pronunciation) for details.
</Update>
