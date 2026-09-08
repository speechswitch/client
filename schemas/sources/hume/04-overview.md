> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Text-to-Speech (TTS)

**Octave 2 (preview) and EVI 4-mini are live**! Expanded language support and lower latency for faster, more natural responses. [Learn more](https://www.hume.ai/blog/octave-2-launch).

**Octave TTS** is the first text-to-speech system built on LLM intelligence. Octave *understands* the text it speaks, both emotionally and semantically. It knows when to whisper secrets, when to shout in triumph, and when to calmly state facts. It produces industry-leading voice quality and expressiveness at real-time speeds. Create any voice you can imagine on Octave through prompting, or use Octave to create a state-of-the-art clone of your own voice.

You retain full ownership of any audio content you generate using Octave. For complete details on
ownership rights, please see Hume's [Terms of Use](https://www.hume.ai/terms-of-use#user-content-and-voice-models).

## Features

### Key capabilities

* **Industry-leading expression**: Octave uses LLM intelligence to recognize nuanced meanings; it adapts pronunciation, pitch, tempo, and emphasis
  to match each word’s emotional intent.
* **Real-time speeds**: Octave 2 (preview) generates high-quality audio with latencies as low as `~100ms` (not including network transit), suitable for conversational
  and interactive applications.
* **Design any voice you can imagine**: From describing a *“patient, empathetic counselor”* to requesting a *“dramatic
  medieval knight,”* Octave instantly creates a fitting voice. See [Voice Design](/docs/voice/voice-design).
* **State-of-the-art Voice Cloning**: Octave can create a high-quality voice clone using as little as 15 seconds of audio. See [Voice Cloning](/docs/voice/voice-cloning).
* **Long-form context-preservation**: Perfect for podcasts or voiceover work, Octave preserves emotional
  consistency across paragraphs or scenes—even when characters shift from joy to despair. See our [Continuation](/docs/text-to-speech-tts/continuation) guide.

### Octave versions

<table>
  <tbody>
    <tr>
      <th>
         Feature 
      </th>

      <th width="32%">
         Octave 1 
      </th>

      <th width="36%">
         Octave 2 (preview) 
      </th>
    </tr>

    <tr>
      <td>
         Supported languages 
      </td>

      <td>
         English, Spanish 
      </td>

      <td>
         English, Japanese, Korean, Spanish, French, Portuguese, Italian, German, Russian, Hindi, Arabic 
      </td>
    </tr>

    <tr>
      <td>
         Model latency 
      </td>

      <td>
         \~200ms 
      </td>

      <td>
         \~100ms 
      </td>
    </tr>

    <tr>
      <td>
         Voice cloning 
      </td>

      <td />

      <td />
    </tr>

    <tr>
      <td>
         Voice design 
      </td>

      <td />

      <td>
         (English only, multilingual coming soon) 
      </td>
    </tr>

    <tr>
      <td>
         Acting instructions 
      </td>

      <td />

      <td>
         (Coming soon) 
      </td>
    </tr>

    <tr>
      <td>
         Continuation 
      </td>

      <td />

      <td />
    </tr>

    <tr>
      <td>
         Timestamps (phoneme/word) 
      </td>

      <td />

      <td />
    </tr>
  </tbody>
</table>

## Quickstart

Accelerate your project setup with our comprehensive quickstart guides, designed to integrate Octave TTS into your
TypeScript or Python applications. Each guide walks you through API integration and demonstrates text-to-speech
synthesis, helping you get up and running quickly.

#### [TypeScript](/docs/text-to-speech-tts/quickstart/typescript)

Integrate Octave TTS into web and Node.js applications using our TypeScript SDK.

#### [Python](/docs/text-to-speech-tts/quickstart/python)

Use our Python SDK to integrate Octave TTS into your Python applications.

#### [.NET](/docs/text-to-speech-tts/quickstart/dotnet)

Use our .NET SDK to integrate Octave TTS into your .NET applications.

#### [CLI](/docs/text-to-speech-tts/quickstart/cli)

Get started synthesizing text-to-speech with our command-line tool.

## Glossary

<tbody>
  <tr>
    <th width="20%">
       

      **Term**

       
    </th>

    <th>
       

      **Definition**

       
    </th>
  </tr>

  <tr>
    <td>
       

      [`Utterance`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances)

       
    </td>

    <td>
       A unit of input for Octave. Contains 

      `text`

      , 

      `voice`

      , 

      `description`

      , 

      `speed`

      , and 

      `trailing_silence`

      . 
    </td>
  </tr>

  <tr>
    <td>
       

      [`Generation`](/reference/text-to-speech-tts/synthesize-json-streaming#response.body.generation_id)

       
    </td>

    <td>
       The total generated audio output, referenced by 

      `generation_id`

      . 
    </td>
  </tr>

  <tr>
    <td>
       

      [`Snippet`](/reference/text-to-speech-tts/synthesize-json-streaming#response.body.snippet)

       
    </td>

    <td>
       A segment of the total generated audio output, referenced by 

      `snippet_id`

      . 
    </td>
  </tr>
</tbody>

## Streaming and non-streaming

The TTS API supports both **streaming** and **non-streaming** (synchronous) responses.

Streaming endpoints return audio as it is generated so playback can begin quickly, while non-streaming endpoints return
the full result after processing completes.

<table>
  <tbody>
    <tr>
      <th width="18%">
         Mode 
      </th>

      <th width="20%">
         Direction 
      </th>

      <th width="24%">
         Endpoints 
      </th>

      <th>
         Typical use cases 
      </th>
    </tr>

    <tr>
      <td>
         Streaming (HTTP) 
      </td>

      <td>
         Output only 
      </td>

      <td>
        [`/v0/tts/stream/json`](/reference/text-to-speech-tts/synthesize-json-streaming),
        [`/v0/tts/stream/file`](/reference/text-to-speech-tts/synthesize-file-streaming)
      </td>

      <td>
         Real-time playback, low perceived latency, pipelines that process chunks. 
      </td>
    </tr>

    <tr>
      <td>
         Streaming (WebSocket) 
      </td>

      <td>
         Input & output 
      </td>

      <td>
         

        [`/v0/tts/stream/input`](/reference/text-to-speech-tts/stream-input)

         
      </td>

      <td>
         Interactive UIs that send text incrementally and receive continuous audio. 
      </td>
    </tr>

    <tr>
      <td>
         Non-streaming 
      </td>

      <td>
         Single response 
      </td>

      <td>
        [`/v0/tts`](/reference/text-to-speech-tts/synthesize-json),
        [`/v0/tts/file`](/reference/text-to-speech-tts/synthesize-file)
      </td>

      <td>
         Simple integrations, saving files, predictable end-to-end timing. 
      </td>
    </tr>
  </tbody>
</table>

### Unidirectional streaming (HTTP)

* **Streamed JSON** → [`/v0/tts/stream/json`](/reference/text-to-speech-tts/synthesize-json-streaming)\
  Emits a sequence of JSON objects, each including a base64 audio and metadata.

* **Streamed file** → [`/v0/tts/stream/file`](/reference/text-to-speech-tts/synthesize-file-streaming)\
  Sends a continuous stream of raw audio bytes (for example `audio/mpeg`).

### Bidirectional streaming (WebSocket)

* **WebSocket streaming** → [`/v0/tts/stream/input`](/reference/text-to-speech-tts/stream-input)\
  Send text incrementally and receive audio continuously over the same connection.

### Non-streaming (HTTP)

* **Synchronous JSON** → [`/v0/tts`](/reference/text-to-speech-tts/synthesize-json)\
  Returns a JSON payload with the entire audio as a base64 string.

* **Synchronous File** → [`/v0/tts/file`](/reference/text-to-speech-tts/synthesize-file)\
  Returns a downloadable audio file such as `audio/mpeg`.

### Choosing which response type

* Use **streaming** for user-facing playback and lower perceived latency.
* Use **streamed JSON** when you need per-chunk metadata with the audio.
* Use **streamed file** when your player expects a continuous HTTP audio stream.
* Use **WebSocket streaming** to send input progressively and receive continuous audio.
* Use **non-streaming** for simple request–response flows or when you prefer a single completed file.

## Ultra low latency streaming: instant mode

Instant mode is a low-latency streaming mode designed for real-time applications where audio playback should begin as
quickly as possible. Unlike standard streaming—which introduces a brief lead time before the first audio chunk is
sent—instant mode begins streaming audio as soon as generation starts. **Instant mode is enabled by default.**

**How instant mode works**

* No lead time is introduced—the server streams audio as soon as it's available.
* Audio is delivered in smaller sub-snippet chunks (`~1` second each).
* First audio is typically ready within `~200ms`, depending on system load and input complexity.

Instant mode does not change the format of streamed responses—each chunk includes the same metadata; however chunks in
instant mode will be smaller and begin to arrive more quickly.

**Enabling/disabling instant mode**

* Use the [`instant_mode`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.instant_mode) field to
  explicitly enable or disable instant mode.
* Specify a predefined [`voice`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.voice)
  by `name` or `id`—this is required when using instant mode.
* Set [`num_generations`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.num_generations) to `1`
  or omit it.

**When to disable instant mode**

* For voice design workflows—where no predefined voice is specified—disable instant mode to enable dynamic voice
  generation.
* When generating multiple candidates in a single request (`num_generations > 1`), disable instant mode to
  support comparative or exploratory generation.

## Developer tools

**Hume provides a suite of developer tools for integrating TTS.**

#### [API Reference](/reference/text-to-speech-tts/synthesize-json-streaming)

See our API reference for TTS streaming and non-streaming endpoints.

#### [SDKs](/intro#sdks)

Open source SDKs for streaming and non-streaming. Stream audio, handle files, and integrate quickly.

#### [CLI](/docs/text-to-speech-tts/quickstart/cli)

A command-line tool that allows direct interaction with Hume’s TTS API, ideal for testing,
automation, and rapid prototyping.

#### [MCP Server](/docs/integrations/mcp)

Run the Hume's TTS MCP server to expose TTS tools to compatible clients.

#### [Sample code](https://github.com/HumeAI/hume-api-examples/tree/main/tts)

Open source examples you can copy, run, and adapt to get started quickly.

## API limits

**The following limits apply to Hume’s Text-to-Speech API.**

<table>
  <tbody>
    <tr>
      <th width="44%">
        Limit
      </th>

      <th>
        Value
      </th>
    </tr>

    <tr>
      <td>
        Request rate limit (HTTP)
      </td>

      <td>
        Defined by your 

        [subscription tier](https://www.hume.ai/pricing)
      </td>
    </tr>

    <tr>
      <td>
        Maximum text length
      </td>

      <td>
        5,000 characters per Utterance
      </td>
    </tr>

    <tr>
      <td>
        Maximum description length
      </td>

      <td>
        1,000 characters per Utterance
      </td>
    </tr>

    <tr>
      <td>
        Maximum generations per request
      </td>

      <td>
        5
      </td>
    </tr>

    <tr>
      <td>
        Supported audio formats
      </td>

      <td>
        `MP3`

        , 

        `WAV`

        , 

        `PCM`
      </td>
    </tr>
  </tbody>
</table>

---