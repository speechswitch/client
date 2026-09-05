> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Text-to-Speech API FAQ

#### What languages are supported by TTS?

Hume’s Octave 2 (preview) currently supports **English, Japanese, Korean, Spanish, French, Portuguese, Italian, German, Russian, Hindi, Arabic**. Octave 1 only supports **English** and **Spanish**.

#### How is Hume’s speech-language model different from other text-to-speech models?

Hume’s TTS product is based on Octave, the first LLM for text-to-speech. Octave stands out from traditional TTS
models because its LLM foundation allows it to understand the meaning of the words it’s saying at a much deeper
level.

This fundamental difference not only enables Octave to sound more natural, but also gives it its ability
to generate voices based on descriptive prompts, or change its output based on instructions - it understands what
these descriptions mean. This translates to unprecedented creative control through natural language instructions,
enabling voice generation that responds intelligently to context, emotion, and nuanced descriptions rather than
just converting text to phonemes.

#### How is Hume’s Octave TTS different from ElevenLabs, or other text-to-speech providers?

ElevenLabs, Speechify, PlayHT, and other text-to-speech providers use more traditional text-to-speech models that
focus more on the pronunciation of the characters being read but not their meaning.

By contrast, Hume’s Octave TTS with its LLM backbone can understand context, emotion, and descriptions, similar to
how ChatGPT can understand context and knowledge about the world as it answers your questions.

#### What’s the best way to prompt Hume’s model for voice design?

Check out our [Voice Design Guide](/docs/voice/voice-design) for an overview of how it works, prompting best
practices, and example prompts.

#### Can I configure the speed, pitch, or emotions of a voice output?

**Yes**, see our [Acting Instructions Guide](/docs/text-to-speech-tts/acting-instructions) for details on how to
guide delivery.

#### What are acting instructions? How do they help my voice output?

Acting instructions are a way to provide additional guidance in the voice delivery of Hume’s TTS, after you’ve
already created the voice. For example, you can add stage directions to “slow down”, “act angry”, or “speak in an
extremely exaggerated prosodic tone”!

#### What happens if I exceed my usage limit?

If you're on a **Creator**, **Pro**, **Scale**, **Business**, or **Enterprise** plan, you can purchase additional
usage at a fixed rate per 1,000 characters. **Free** and **Starter** plans require an upgrade to access additional
usage.

For full details, visit our [Pricing Page](https://www.hume.ai/pricing).

#### Can I use your TTS voices for commercial projects (e.g., YouTube, games, voice assistants)?

**Yes**, users can use our TTS service for commercial purposes. **Free** and **Starter** subscription tiers are
limited to non-commercial use only. See our [Pricing Page](https://www.hume.ai/pricing) for further details on
subscription tiers.

#### Are there any restrictions on using TTS-generated voices in monetized content?

**No**, but your use must comply with Hume's prohibited use policy. There are no specific restrictions on monetization
itself, but all use must adhere to their rules against harmful/illegal applications.

#### Do I own the rights to my custom voices?

**Yes**, you retain rights to your output, but you grant Hume a perpetual license to use your voice recordings and
voice models to provide/improve services and develop new products. Hume will not share your AI voices or speech
samples without permission.

See our [Terms of Use](https://www.hume.ai/terms-of-use#user-content-and-voice-models) for further details.

#### Can I clone my voice or the voices of others?

**Yes**, see our [Voice Cloning Guide](/docs/voice/voice-cloning) for step-by-step instructions.

---