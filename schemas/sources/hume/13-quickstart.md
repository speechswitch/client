> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# TTS NodeJS Quickstart Guide

This guide shows how to use Hume's Text-to-Speech API using [Hume's TypeScript SDK](https://github.com/humeai/hume-typescript-sdk) for applications that run in a NodeJS-compatible runtime. It assumes your system has FFMpeg available.

It demonstrates:

1. Using an existing voice.
2. Create a new voice via a prompt.
3. Continuing from previous speech.
4. Providing "acting instructions" to modulate the voice.
5. Generating speech from live input.

The complete code for the example in this guide is [available on GitHub](https://github.com/HumeAI/hume-api-examples/tree/main/tts/tts-typescript-quickstart).

### Environment Setup

Create a new project and install the required packages:

```bash
npm init -y
npm install hume dotenv
npm install --save-dev typescript @types/node
```

### Authenticating the HumeClient

You must authenticate to use the Hume TTS API. Your API key can be retrieved from the [Hume AI platform](https://app.hume.ai/keys).

This example uses [dotenv](https://www.npmjs.com/package/dotenv). Place your API key in a `.env` file at the root of your project.

#### .env

```bash
echo "HUME_API_KEY=your_api_key_here" > .env
```

First, use your API key to instantiate the `HumeClient`, importing as necessary.

```typescript
// index.ts
import { HumeClient, createSilenceFiller } from "hume"
import dotenv from "dotenv"

dotenv.config()

const hume = new HumeClient({ 
  apiKey: process.env.HUME_API_KEY!
})
```

Next, define a helper for playing back audio with `ffplay`.

### Playing audio

```typescript
// audio_player.ts
import { spawn } from 'child_process';

export const startAudioPlayer = () => {
  const ffplay = spawn('ffplay', ['-nodisp', '-autoexit', '-'], {
    stdio: ['pipe', 'ignore', 'ignore']
  });

  return {
    stdin: ffplay.stdin,
    stop: async () => {
      ffplay.stdin.end();
      await new Promise(resolve => ffplay.on('close', resolve));
    }
  };
};
```

The `startAudioPlayer` function creates an FFmpeg process that plays audio from stdin. It returns an object with a `stdin` stream for writing audio data and a `stop` method to cleanly terminate playback.

### Using a pre-existing voice

Use this method if you want to synthesize speech with a high-quality voice from Hume's Voice Library, or specify `provider: 'CUSTOM_VOICE'` to use a voice that you created previously via the Hume Platform or the API.

```typescript
const utterance = {
  text: "Dogs became domesticated between 23,000 and 30,000 years ago.",
  voice: { name: 'Ava Song', provider: 'HUME_AI' as const }
}

const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [utterance],
  // With `stripHeaders: true`, only the first audio chunk will contain
  // headers in container formats (wav, mp3). This allows you to start a
  // single audio player and stream all audio chunks to it without artifacts.
  stripHeaders: true,
  version: "2"
})

const audioPlayer = startAudioPlayer()
for await (const chunk of stream) {
  if (chunk.type === 'audio') {
    const buffer = Buffer.from(chunk.audio, "base64")
    audioPlayer.stdin.write(buffer)
  }
}
await audioPlayer.stop()
```

### Create a new voice via a prompt

The Voice Creation API allows you to create custom voices programmatically, via prompting. There are two steps to creating a voice:

1. Send a description of the voice, along with sample text that is characteristic of the voice, to the standard `tts` endpoint without specifying a voice, with `instant_mode` disabled.
2. Take the `generationId` from one of the resulting audio samples, and use it to create a new voice with the Voice Creation API.

Here, we arbitrarily select the second sample. In a real application, you would likely allow the end user to listen to the samples and make a selection.

```typescript
// Create voice options for user selection
const result = await hume.tts.synthesizeJson({
  utterances: [{
    description: "Crisp, upper-class British accent with impeccably articulated consonants and perfectly placed vowels. Authoritative and theatrical, as if giving a lecture.",
    text: "The science of speech. That's my profession; also my hobby. Happy is the man who can make a living by his hobby!"
  }],
  numGenerations: 2,
  stripHeaders: true,
})

const audioPlayer = startAudioPlayer()
let sampleNumber = 1;
for (const generation of result.generations) {
  const buffer = Buffer.from(generation.audio, "base64")
  audioPlayer.stdin.write(buffer)
  console.log(`Playing option ${sampleNumber}...`)
  sampleNumber++;
}
await audioPlayer.stop()

// Select the second voice option for this example
const selectedGenerationId = result.generations[1].generationId

const voiceName = `higgins-${Date.now()}`;
await hume.tts.voices.create({
  name: voiceName,
  generationId: selectedGenerationId,
})

console.log(`Created voice: ${voiceName}`)
```

### Continuing previous speech

You can make new speech sound like a natural continuation from previous speech by providing the `generationId` of the previous audio in the `context` parameter. This helps maintain consistency in tone, pacing, and emotional state.

Additionally, you can provide "acting instructions" using the `description` field alongside an existing voice. When you specify both a voice and a description, the `description` modulates the voice's tone, emotion, and delivery style while maintaining the core voice characteristics.

This code continues from the snippet above that created a new voice, and continues the speech from where the selected generation left off.

```typescript
const audioPlayer = startAudioPlayer()
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [{
    voice: { name: voiceName },
    text: "YOU can spot an Irishman or a Yorkshireman by his brogue. I can place any man within six miles. I can place him within two miles in London. Sometimes within two streets.",
    description: "Bragging about his abilities"
  }],
  context: {
    generationId: selectedGenerationId
  },
  stripHeaders: true
})

for await (const chunk of stream) {
  if (chunk.type === 'audio') {
    const buffer = Buffer.from(chunk.audio, "base64")
    audioPlayer.stdin.write(buffer)
  }
}
await audioPlayer.stop()
```

### Generating speech from live input

If you need to generate speech from text that is being produced in real-time, you can use the bidirectional streaming WebSocket endpoint at `/v0/tts/stream/input`.

Support for connecting to the WebSocket directly is coming soon to the TypeScript SDK. For the time being, this example shows how you can implement a simple WebSocket client yourself and still use types provided by the SDK for type safety.

First, install the `ws` package:

```bash
npm install ws
```

Then, use the `ws` library to connect to the WebSocket. Specify the following query parameters

* `no_binary=true` - to receive audio as base64 text rather than binary, to simplify parsing
* `instant_mode=true` - to receive audio snippets as soon as they are generated, rather than waiting for the full utterance to be complete
* `format_type=pcm` - to receive raw PCM audio without WAV headers, which is easier to pipe directly to an audio player
* `api_key=your_api_key` - to authenticate the request

We wrap the WebSocket in a `StreamingTtsClient` that provides an async iterator interface for consuming audio snippets as they arrive.

```typescript
// streaming.ts
import WebSocket from "ws";
import {SnippetAudioChunk} from "hume/serialization/resources/tts/types/SnippetAudioChunk";
import { PublishTts } from "hume/api/resources/tts";

export class StreamingTtsClient {
  private constructor(
    private readonly ws: WebSocket,
    private readonly queue: Queue<string>
  ) { }

  static async connect(apiKey: string): Promise<StreamingTtsClient> {
    if (!apiKey) throw new Error("HUME_API_KEY is not set");

    const url = `wss://api.hume.ai/v0/tts/stream/input?api_key=${apiKey}&no_binary=true&instant_mode=true&strip_headers=true&format_type=pcm`;
    const ws = new WebSocket(url);
    const queue = new Queue<string>();

    ws.onmessage = (event) => {
      queue.push(event.data.toString())
    };
    ws.onclose = (_event) => {
      queue.end();
    };
    ws.onerror = (_error) => {
      queue.end();
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        resolve();
      };
      ws.onerror = (e) => {
        reject(e);
      };
    });

    return new StreamingTtsClient(ws, queue);
  }

  send(message: PublishTts) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket not connected.");
    this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    this.ws.close();
  }

  async *[Symbol.asyncIterator]() {
    for await (const item of this.queue) {
      yield SnippetAudioChunk.parseOrThrow(JSON.parse(item), {
        unrecognizedObjectKeys: "passthrough",
      });
    }
  }
}

// Resolves a promise with T, or null to indicate the stream ended.
type Resolver<T> = (value: T | null) => void;

class Queue<T> {
  private pushed: T[] = [];
  // If non-null, there is a consumer waiting for data, and
  // calling `waiting` with a chunk will resolve a promise that
  // sends the data to the consumer.
  private waiting: Resolver<T> | null = null;
  private ended = false;

  push(x: T) {
    if (this.ended) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w(x);
    }
    else this.pushed.push(x);
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    if (this.waiting) { this.waiting(null); this.waiting = null; }
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.pushed.length) yield this.pushed.shift()!;
      else {
        const x = await new Promise<T | null>(r => (this.waiting = r));
        if (x === null) break;
        yield x;
      }
    }
  }
}

```

The `PublishTts` type from the TypeScript SDK describes the format of messages supported by the WebSocket. You can specify `text` and `voice` to send text to be spoken.

The WebSocket will buffer the text you send it by default, as having more context typically improves correctness and expressiveness. Audio will be produced when the buffer is full. However, you can send a message with `flush: true` to tell the server to start generating audio for the text you have sent so far. When you are done generating speech, send a message with `close: true`, and the server will end the connection once it is finished with the text you have given it previously.

```typescript
const stream = await StreamingTtsClient.connect(process.env.HUME_API_KEY!);

// Helper methods for flushing and closing the stream
const sendFlush = () => stream.send({ flush: true });
const sendClose = () => stream.send({ close: true });

const voice = { name: "Ava Song", provider: "HUME_AI" } as const;
const sendInput = async () => {
  stream.send({ text: "Hello world.", voice });
  sendFlush();
  console.log('Waiting 8 seconds...')
  await new Promise(r => setTimeout(r, 8000));
  stream.send({ text: "Goodbye, world.", voice });
  sendFlush();
  sendClose();
};
```

The WebSocket produces a stream of independent audio snippets, rather than a continuous stream of sometimes-silent audio.

In the example project, we use `ffplay` as the audio player, which expects a continuous stream. To take care of this, we use the `SilenceFiller` helper provided by the Hume TypeScript SDK, which creates a continuous stream from independent PCM audio snippets.

This is not always needed. In some settings you can initialize a new audio player for each audio chunk. If you are using an audio player that writes directly to your system's audio output (such as `aplay` for Linux systems, `afplay` for Mac systems), you can typically write each chunk directly when it is ready to play, without worrying about filling gaps with silence.

```typescript
const player = startAudioPlayer();
const SilenceFiller = await createSilenceFiller()
const silenceFiller = new SilenceFiller();

// Pipe silence filler output to audio player stdin
silenceFiller.pipe(player.stdin);

// Handle pipe errors
silenceFiller.on('error', (err) => {
  console.error("SilenceFiller error:", err);
});

const handleMessages = async () => {
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk.audio, "base64");
    silenceFiller.writeAudio(buf);
  }

  await silenceFiller.endStream();
  await player.stop();
};

// Trigger both sending input and receiving audio at the same time.
await Promise.all([handleMessages(), sendInput()]);
```

### Running the Example

To run the example:

```bash
npx ts-node index.ts
```