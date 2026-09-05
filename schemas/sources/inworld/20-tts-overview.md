> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Intro to Realtime TTS

> Generate natural, expressive speech in real time.

import TTSModelCards from '/snippets/tts-model-cards.mdx';

Inworld's Realtime TTS models offer ultra-realistic, context-aware speech synthesis, zero data retention, and precise voice cloning capabilities, enabling developers to build natural and engaging experiences with human-like speech quality at an accessible price point.

Our models can be accessed via API ([streaming](/api-reference/ttsAPI/texttospeech/synthesize-speech-stream) and [non-streaming](/api-reference/ttsAPI/texttospeech/synthesize-speech)) or the [TTS Playground](http://platform.inworld.ai/tts-playground).

<CardGroup cols={3}>
  <Card title="Developer quickstart" icon="bolt" href="/quickstart-tts">
    Learn how to make your first API call with a guided tutorial.
  </Card>

  <Card title="TTS Playground" icon="play" href="/tts/tts-playground">
    Try different TTS models and voice cloning in TTS Playground.
  </Card>

  <Card title="Code Examples" icon="play" href="https://github.com/inworld-ai/inworld-api-examples/tree/main/tts">
    Browse ready-to-use GitHub samples for common use cases.
  </Card>
</CardGroup>

<Tip>
  **Using AI to code?** Paste `https://docs.inworld.ai/llms.txt` into your assistant so it knows every page on this site. Want live search? [Add the MCP server](https://docs.inworld.ai/tts/resources/vibe-coding).

  **Prefer the terminal?** `npm install -g @inworld/cli` — synthesize speech, clone and design voices, and generate audiobooks with the [Inworld CLI](/tts/resources/inworld-cli). AI agents can use it too.
</Tip>

## Models
<TTSModelCards/>

See the [Models](/tts/tts-models) page for model IDs and full details.

## Features

| **Feature**    | **Realtime TTS-2** | **Realtime TTS-2 Flash** |
| :---- | :---- | :---- |
| Best for &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | Production workloads that need the best quality and steerability | Latency-critical, high-volume, and cost-sensitive workloads |
| Quality &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | Top-ranked flagship — best quality and steerability | High quality at the lowest latency and cost |
| Latency (TTFB) <sup>\*</sup> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | 100 ms | 20 ms |
| [Instant voice cloning](/tts/instant-voice-cloning) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="check" size={18} /> |
| [Professional voice cloning](/tts/professional-voice-cloning) <span className="research-preview-pill">Beta</span> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="dash" size={18} /> |
| [Inline pronunciation](/tts/capabilities/custom-pronunciation) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="check" size={18} /> |
| [Multilingual](/tts/capabilities/multilingual) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | 200+ languages | 200+ languages |
| [Steering](/tts/capabilities/steering) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="dash" size={18} /> |
| [Pause controls](/tts/capabilities/pause-controls) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="check" size={18} /> |
| [Timestamp alignment](/tts/capabilities/timestamps) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="check" size={18} /> |
| [Zero data retention](/portal/zero-data-retention#tts) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | <Icon icon="check" size={18} /> | <Icon icon="check" size={18} /> |

<sup>\*</sup> P90 time to first audio byte, measured server-side — excludes network latency.
