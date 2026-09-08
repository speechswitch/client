> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Node.js SDK

> Use the @inworld/tts package to add speech synthesis, voice cloning, and voice design to your Node.js app

The [`@inworld/tts`](https://www.npmjs.com/package/@inworld/tts) Node.js SDK wraps the Inworld TTS REST API with a clean, typed interface. It handles chunking for long text, retries with exponential backoff, and connection management automatically — reducing typical integrations from 30+ lines of raw HTTP to just a few lines of code.

```bash
npm install @inworld/tts
```

## Quick Start

```javascript
import { InworldTTS } from '@inworld/tts';
import fs from 'fs';

const tts = InworldTTS(); // reads INWORLD_API_KEY from env

const audio = await tts.generate({
  text: 'What a wonderful day to be a text-to-speech model!',
  voice: 'Ashley',
});

fs.writeFileSync('output.mp3', audio);
```

## Speech Synthesis

### `generate(options)`

Synthesize speech and return the complete audio as a `Uint8Array`. Text longer than 2,000 characters is automatically chunked and sent in parallel.

```javascript
const audio = await tts.generate({
  text: 'Hello, world!',
  voice: 'Ashley',
  model: 'inworld-tts-2',
  encoding: 'MP3',
  outputFile: 'output.mp3', // optional — also writes to disk
});
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `string` | Yes | — | Text to synthesize. Any length. Supports `<break time="Xs"/>` SSML. |
| `voice` | `string` | Yes | — | Voice ID (e.g. `"Ashley"`, `"Dennis"`, or a custom voice ID). |
| `model` | `string` | No | `"inworld-tts-2"` | Model ID. |
| `encoding` | `string` | No | `"MP3"` | Audio format: `MP3`, `OGG_OPUS`, `FLAC`, `LINEAR16`, `WAV`, `PCM`, `ALAW`, `MULAW`. |
| `sampleRate` | `number` | No | `48000` | Sample rate in Hz. |
| `bitRate` | `number` | No | `128000` | Bit rate in bps (MP3 / OGG_OPUS only). |
| `speakingRate` | `number` | No | `1.0` | Speed multiplier (0.5–1.5). |
| `language` | `string` | No | — | BCP-47 language tag (e.g. `"en-US"`, `"fr-FR"`) telling the model which language the voice should speak. Auto-detected from the input text when omitted. |
| `deliveryMode` | `string` | No | `"BALANCED"` | Trade-off between stability and expressiveness on `inworld-tts-2`: `"STABLE"`, `"BALANCED"`, or `"CREATIVE"`. Ignored on other models. |
| `temperature` | `number` | No | `1.0` | Expressiveness (0.0–2.0). Higher = more expressive. **Ignored on `inworld-tts-2`** — use `deliveryMode` instead. |
| `outputFile` | `string` | No | — | Write audio to this file path (Node.js only). |
| `play` | `boolean` | No | `false` | Play audio immediately after synthesis (Node.js only). |

**Returns:** `Uint8Array` — raw audio bytes in the requested encoding.

### `stream(options)`

Stream audio chunks over HTTP as they are generated. Lower time-to-first-audio than `generate()`. Text of any length is accepted: longer input is split at sentence boundaries and streamed as sequential requests. See [Long Text](#long-text).

```javascript
const chunks = [];

for await (const chunk of tts.stream({
  text: 'Streaming is great for real-time playback!',
  voice: 'Ashley',
})) {
  chunks.push(chunk);
}

const audio = Buffer.concat(chunks);
```

Parameters are the same as [`generate()`](#generateoptions), plus an optional `maxChunkChars` that overrides the default 3,900-character chunk ceiling. See [Long Text](#long-text).

**Yields:** `Uint8Array` — audio chunks as they arrive.

### `generateWithTimestamps(options)`

Same as `generate()` but also returns word- or character-level timing data. Useful for lip-sync, karaoke, and subtitle alignment.

```javascript
const { audio, timestamps } = await tts.generateWithTimestamps({
  text: 'Timestamps are useful for lip sync.',
  voice: 'Ashley',
  timestampType: 'WORD',
});

// timestamps.wordAlignment.words → ['Timestamps', 'are', 'useful', ...]
// timestamps.wordAlignment.wordStartTimeSeconds → [0.0, 0.42, 0.61, ...]
```

Takes all the same parameters as [`generate()`](#generateoptions), plus:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timestampType` | `"WORD"` \| `"CHARACTER"` | Yes | `"WORD"` returns word timing, phonemes, and visemes. `"CHARACTER"` returns per-character timing. |

**Returns:** `{ audio: Uint8Array, timestamps: TimestampInfo }`

### `streamWithTimestamps(options)`

Stream audio chunks, each paired with optional timestamp data. Text of any length is accepted: longer input is split at sentence boundaries and streamed as sequential requests. See [Long Text](#long-text).

```javascript
for await (const chunk of tts.streamWithTimestamps({
  text: 'Streaming with timestamps!',
  voice: 'Ashley',
  timestampType: 'WORD',
})) {
  // chunk.audio: Uint8Array
  // chunk.timestamps: TimestampInfo | undefined
}
```

Takes all the same parameters as [`stream()`](#streamoptions), plus `timestampType` (required).

**Yields:** `{ audio: Uint8Array, timestamps?: TimestampInfo }`

### `play(audio, options)`

Play audio from a `Uint8Array` or file path. Encoding is auto-detected from magic bytes unless overridden.

```javascript
const audio = await tts.generate({ text: 'Listen to this!', voice: 'Ashley' });
await tts.play(audio);

// Or play from a file
await tts.play('output.mp3');
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `audio` | `Uint8Array` \| `string` | Yes | — | Raw audio bytes or a file path (Node.js only). |
| `encoding` | `string` | No | auto-detected | Format hint (`"MP3"`, `"WAV"`, etc.). Inferred from extension for file paths. |

## Voice Management

### `listVoices(options)`

List available voices, optionally filtered by language.

```javascript
const voices = await tts.listVoices();

// Filter by language
const enVoices = await tts.listVoices({ lang: 'EN_US' });
const multiLang = await tts.listVoices({ lang: ['EN_US', 'ES_ES'] });
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lang` | `string` \| `string[]` | No | Filter by language code(s). Returns all voices when omitted. |

**Returns:** `VoiceInfo[]`

### `getVoice(voice)`

Get details for a single voice. Works with custom voices in your workspace (cloned or designed voices).

```javascript
const voice = await tts.getVoice('my-custom-voice-id');
// voice.voiceId, voice.displayName, voice.langCode, ...
```

**Returns:** `VoiceInfo`

### `cloneVoice(options)`

Clone a voice from one or more audio recordings — as little as 3 seconds works, and longer samples (up to 30 seconds) improve similarity.

```javascript
const result = await tts.cloneVoice({
  audioSamples: ['./recording.wav'],
  displayName: 'My Cloned Voice',
  lang: 'EN_US',
});

console.log(result.voice.voiceId); // use this ID in generate()
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `audioSamples` | `Array<Uint8Array \| string>` | Yes | — | Audio files as `Uint8Array`/Buffer, or file paths (Node.js only). WAV or MP3. |
| `displayName` | `string` | No | `"Cloned Voice"` | Display name for the cloned voice. |
| `lang` | `string` | No | `"EN_US"` | Language code of the recordings. |
| `transcriptions` | `string[]` | No | — | Transcriptions aligned with each audio sample. Improves clone quality. |
| `description` | `string` | No | — | Voice description. |
| `tags` | `string[]` | No | — | Tags for filtering. |
| `removeBackgroundNoise` | `boolean` | No | `false` | Apply noise reduction before cloning. |

**Returns:** `CloneVoiceResult` — the cloned voice ID is at `result.voice.voiceId`.

### `designVoice(options)`

Design a new voice from a text description — no audio recording needed.

```javascript
const result = await tts.designVoice({
  designPrompt: 'A warm, friendly female voice with a slight British accent',
  previewText: 'Hello! Welcome to our application.',
  numberOfSamples: 3,
});

// Listen to previews, then publish the one you like
const chosenVoice = result.previewVoices[0];
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `designPrompt` | `string` | Yes | — | Natural-language description of the voice (30–250 characters). |
| `previewText` | `string` | Yes | — | Text the generated voice will speak in the preview. |
| `lang` | `string` | No | `"EN_US"` | Language code. |
| `numberOfSamples` | `number` | No | `1` | Number of preview candidates (1–3). |

**Returns:** `DesignVoiceResult` — preview voices at `result.previewVoices`.

### `publishVoice(options)`

Publish a designed or cloned voice preview to your library so it can be used in `generate()` and `stream()`.

```javascript
const voice = await tts.publishVoice({
  voice: chosenVoice.voiceId,
  displayName: 'My Designed Voice',
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `voice` | `string` | Yes | Voice ID from `designVoice()` or `cloneVoice()`. |
| `displayName` | `string` | No | Display name for the published voice. |
| `description` | `string` | No | Description. |
| `tags` | `string[]` | No | Tags for filtering. |

**Returns:** `VoiceInfo`

### `migrateFromElevenLabs(options)`

Migrate a voice from ElevenLabs to your Inworld workspace. Fetches the voice's audio samples directly from ElevenLabs and clones them into Inworld. No ElevenLabs SDK required.

```javascript
const result = await tts.migrateFromElevenLabs({
  elevenLabsApiKey: process.env.ELEVEN_LABS_API_KEY,
  elevenLabsVoiceId: 'abc123',
});

console.log(`Migrated "${result.elevenLabsName}" → ${result.inworldVoiceId}`);
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `elevenLabsApiKey` | `string` | Yes | Your ElevenLabs API key. |
| `elevenLabsVoiceId` | `string` | Yes | ElevenLabs voice ID to migrate. |

**Returns:** `{ elevenLabsVoiceId, elevenLabsName, inworldVoiceId }`

## Configuration

Create a client with `InworldTTS()` or the equivalent `createClient()`:

```javascript
import { InworldTTS, createClient } from '@inworld/tts';

const tts = InworldTTS();                       // reads INWORLD_API_KEY from env
const tts = InworldTTS({ apiKey: 'your_key' }); // or pass explicitly
const tts = createClient();                     // alias for InworldTTS()
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | `string` | — | `INWORLD_API_KEY` env var | Inworld API key. Mutually exclusive with `token`. |
| `token` | `string` | — | — | JWT token for browser use. Mutually exclusive with `apiKey`. |
| `onTokenExpiring` | `() => Promise<string>` | No | — | Called when `token` is about to expire. Return a fresh JWT. |
| `dangerouslyAllowBrowser` | `boolean` | No | `false` | Allow `apiKey` in browser environments (key will be visible in DevTools). |
| `baseUrl` | `string` | No | `https://api.inworld.ai` | Override the API base URL. |
| `timeout` | `number` | No | per-method | Global HTTP timeout in milliseconds. |
| `maxRetries` | `number` | No | `2` | Retry attempts on `NetworkError` or 5xx. Uses exponential backoff (1s, 2s, 4s… capped at 16s). `0` disables retries. |
| `maxConcurrentRequests` | `number` | No | `2` | Max parallel chunk requests for long-text `generate()`. |
| `debug` | `boolean` | No | `false` | Enable debug logging. Also activated by `DEBUG=inworld-tts` env var. |

<Note>
Either `apiKey` or `token` must be provided. If neither is set, a `MissingApiKeyError` is thrown.
</Note>

## Browser

The SDK works in browsers (Vite, webpack 5, Rollup, esbuild) with no extra configuration. Use JWT tokens instead of API keys to keep your credentials safe.

### Authentication with JWT

In production, your backend generates short-lived JWT tokens and your frontend uses them to authenticate. See the [session token guide](/portal/session-tokens) and the [sample Node.js JWT app](https://github.com/inworld-ai/inworld-nodejs-jwt-sample-app) for how to set up the server-side token endpoint.

```javascript
import { InworldTTS } from '@inworld/tts';

async function fetchToken() {
  const res = await fetch('/api/tts-token');
  const { token } = await res.json();
  return token;
}

const tts = InworldTTS({
  token: await fetchToken(),
  onTokenExpiring: fetchToken, // called automatically ~5 min before expiry
});
```

The `onTokenExpiring` callback fires automatically when the current token is about to expire. It must return a fresh JWT string. The SDK uses a stale-while-revalidate strategy — requests continue with the current token while the refresh happens in the background.

### Example: text-to-speech button

A minimal browser example — user clicks a button, the SDK generates audio and plays it:

```html
<button id="speak">Speak</button>
<script type="module">
  import { InworldTTS } from '@inworld/tts';

  async function fetchToken() {
    const res = await fetch('/api/tts-token');
    const { token } = await res.json();
    return token;
  }

  const tts = InworldTTS({
    token: await fetchToken(),
    onTokenExpiring: fetchToken,
  });

  document.getElementById('speak').addEventListener('click', async () => {
    const audio = await tts.generate({
      text: 'Hello from the browser!',
      voice: 'Ashley',
      encoding: 'MP3', // recommended for cross-browser support
    });
    await tts.play(audio);
  });
</script>
```

<Note>
`play()` must be called inside a user event handler (click, keypress, etc.) due to browser autoplay policies.
</Note>

### Browser encoding compatibility

Not all audio encodings are playable in all browsers. Use `MP3` for the widest compatibility.

| Encoding | Chrome | Firefox | Safari |
|----------|--------|---------|--------|
| `MP3` | Yes | Yes | Yes |
| `WAV` | Yes | Yes | Yes |
| `OGG_OPUS` | Yes | Yes | No |
| `FLAC` | Yes | Yes | No |
| `LINEAR16`, `PCM`, `ALAW`, `MULAW` | — | — | — |

For `LINEAR16`/`PCM` formats, use the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext) directly with the `Uint8Array` returned by `generate()` instead of `play()`.

### Browser limitations

- **`outputFile`** — not supported, throws an error. Use the returned `Uint8Array` directly.
- **`play()` with file paths** — not supported, pass a `Uint8Array` instead.
- **`cloneVoice()` with file paths** — not supported, pass `Uint8Array` buffers for audio samples.

### Development shortcut

For quick prototyping, you can use an API key directly in the browser by setting `dangerouslyAllowBrowser`:

```javascript
// ⚠️ Development only — your API key will be visible in DevTools
const tts = InworldTTS({
  apiKey: 'your_key',
  dangerouslyAllowBrowser: true,
});
```

<Warning>
Never use `dangerouslyAllowBrowser` in production. Your API key will be visible in browser DevTools and billed to your account. Use [JWT authentication](/portal/session-tokens) instead.
</Warning>

## Long Text

`generate()` and `generateWithTimestamps()` automatically chunk text longer than 2,000 characters and send chunks in parallel (controlled by `maxConcurrentRequests`). The resulting audio is seamlessly concatenated, and timestamp offsets are merged correctly.

`stream()` and `streamWithTimestamps()` accept text of any length. The streaming endpoint takes up to 4,000 characters per request, so the SDK splits longer input at sentence boundaries into chunks of at most 3,900 characters and streams them as sequential requests. The audio arrives as one continuous sequence of chunks.

The 100-character margin is deliberate. The SDK splits on estimated audio-equivalent length, where a `<break>` tag counts as roughly 12 characters per second of silence and each CJK character counts as three. That estimate can differ from the raw character count the endpoint enforces.

To set your own ceiling, pass `maxChunkChars`. The SDK does not check it against the endpoint limit, so a value above 4,000 produces requests that the API rejects.

## Error Handling

The SDK exports three error classes, all extending `InworldTTSError`:

```javascript
import { InworldTTS, ApiError, NetworkError, MissingApiKeyError } from '@inworld/tts';

const tts = InworldTTS(); // reads INWORLD_API_KEY from env

try {
  const audio = await tts.generate({ text: 'Hello!', voice: 'Ashley' });
} catch (err) {
  if (err instanceof MissingApiKeyError) {
    // No API key or token provided
  } else if (err instanceof ApiError) {
    console.error(`HTTP ${err.code}: ${err.message}`, err.details);
  } else if (err instanceof NetworkError) {
    console.error(`Network error: ${err.message}`);
  } else {
    throw err;
  }
}
```

| Error | When |
|-------|------|
| `MissingApiKeyError` | No `apiKey` or `token` was provided and `INWORLD_API_KEY` is not set. |
| `ApiError` | The API returned a 4xx or 5xx response. Includes `.code` (HTTP status) and `.details`. |
| `NetworkError` | Connection failure or timeout. Automatically retried up to `maxRetries` times before throwing. |

## Next Steps

<CardGroup cols={3}>
  <Card title="Voice Cloning" icon="microphone" href="/tts/instant-voice-cloning">
    Create a personalized voice clone with as little as 3 seconds of audio.
  </Card>

  <Card title="Best Practices" icon="circle-check" href="/tts/best-practices/overview">
    The checklist for expressive, fast, production-ready TTS.
  </Card>

  <Card title="API Reference" icon="code" href="/api-reference/ttsAPI/texttospeech/synthesize-speech">
    View the complete TTS API specification.
  </Card>
</CardGroup>
