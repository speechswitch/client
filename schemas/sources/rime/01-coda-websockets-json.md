> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Websockets JSON

> Coda JSON WebSocket (/ws3): structured events with base64 audio chunks and word-level timestamps.

The Rime API authenticates every request with a bearer token in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`. See [API authentication](/docs/api-authentication) for how to create a key.

<Warning>Include `modelId=coda` in the connection query. If you omit it, the server routes the request to Mist v3 and speakers outside the Mist v3 catalog can fail with `Speaker not found`.</Warning>

## Overview

In addition to a plaintext websocket implementation,
Rime also has an implementation that sends and receives events as JSON objects.
Like the other implementation, all synthesis arguments are provided as query
parameters when establishing the connection.

The WebSocket API buffers inputs up to one of the following punctuation
characters: `.`, `?`, `!`. This is most pertinent for the initial messages
sent to the API, as synthesis won't begin until there are sufficient
tokens to generate audio with natural prosody. After the first synthesis
of any given utterance, typically enough time has elapsed that subsequent
audio contains multiple clauses, and the buffering becomes largely invisible.

## Messages

### Send

#### Text

This is the most common message, which contains text for synthesis.

schema:

```typescript theme={null}
type TextMessage = {
  text: string,
  contextId?: string,
}
```

examples:

```json theme={null}
{
    "text": "this is the minimum text message."
}

{
    "text": "this is a text message with a context id.",
    "contextId": "159495B1-5C81-4C73-A51A-9CE10A08239E"
}
```

Context IDs can be provided, which will be attached to subsequent messages
that the server sends back to the client. Rime will not maintain multiple
simultaneous context IDs. The events will contain the most recent context ID
at the time that audio was requested. In the above examples, even if both
messages are received by the server before it sends any audio, the audio
response for the first sentence will be tagged with `contextId: null`,
and the audio for the second will be tagged with its UUID.

#### Clear

Your client can clear out the accumulated buffer, which is useful in the case of interruptions.

```json theme={null}
{ "operation": "clear" }
```

#### Flush

This forces whatever buffer exists, if any, to be synthesized, and the generated audio to be sent over.

```json theme={null}
{ "operation": "flush" }
```

#### EOS

At times, your client would like to generate audio for whatever
remains in the buffer, and then have the connection immediately closed.

```json theme={null}
{ "operation" : "eos" }
```

### Receive

#### Chunk

The most common event will be the audio chunk.

```typescript theme={null}
type Base64String = string

type AudioChunkEvent = {
  type: "chunk",
  data: Base64String,
  contextId: string | null,
}
```

The audio will be a base64 encoded chunk of audio bytes in the audio format specified
when the connection was established. If you provided any context id when sending the relevant text, it'll be included here.

#### Timestamps

Word-level timestamps are emitted alongside the audio chunks so the client can tell exactly which words have been spoken at any point. This is especially useful for handling interruptions: when the user starts talking over the output, you can map the playback position back to the last word that was actually heard.

<Warning>Timestamps are emitted only when `lang` is `en`/`eng` or `es`/`spa`, or when `lang` is omitted. Requests in any other language receive `chunk` and `done` events with no `timestamps` event and no error (this includes fr, de, ja, pt, ar, and hi). Do not block playback while waiting for a timestamps event.</Warning>

```typescript theme={null}
type TimestampsEvent = {
  type: "timestamps",
  word_timestamps: {
    words: string[],
    start: number[],
    end: number[],
  },
  contextId: string | null,
}
```

The three arrays inside `word_timestamps` are the same length and index-aligned: for a given index `i`, `words[i]` is spoken from `start[i]` to `end[i]`. Times are in seconds, measured from the beginning of the audio for the current synthesis. If a context id was attached to the text that produced this audio, it is included on the event.

Example payload:

```json theme={null}
{
  "type": "timestamps",
  "word_timestamps": {
    "words": ["Hello", "from", "Coda", "over", "JSON", "websockets."],
    "start": [0, 0.36106, 0.54159, 0.72212, 0.90265, 1.08318],
    "end":   [0.36106, 0.54159, 0.72212, 0.90265, 1.08318, 2.88848]
  },
  "contextId": null
}
```

#### Done

After the last audio chunk for a synthesis batch has been sent, the server emits a `done` event. This signals that the current synthesis is fully complete. If the client sends more text and triggers further synthesis, another `done` will follow.

```typescript theme={null}
type DoneEvent = {
  type: "done",
  contextId: string | null,
}
```

When exactly `done` fires depends on the `segment` setting. See [Segmentation and behavior settings](/docs/websockets-segment) for full details.

#### Error

In the event of a malformed or unexpected input, the server will immediately respond with an error message.
The server will *not* close the connection, and will still accept subsequent well-formed messages.
It's up to the client to decide if it wants to close upon receiving an error.

```typescript theme={null}
type ErrorEvent = {
  type: "error",
  message: string,
}
```

## Variable parameters

<ParamField body="speaker" type="string" required>
  Must be a `coda` voice from the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="text" type="string" required>
  The text you'd like spoken. Character limit per request is 1,000 via the API and in the dashboard UI.
</ParamField>

<ParamField body="modelId" type="string" default="mistv3">
  Set this to `coda`. It is not strictly required, but if you omit it the server defaults to the Mist v3 backend, and speakers outside the Mist v3 catalog fail with a "Speaker not found" error.
</ParamField>

<ParamField body="audioFormat" type="string">
  One of `wav`, `mp3` (or `mpeg`), `ogg` (Opus in OGG), `webm` (Opus in WebM), `pcm` (or `l16`), or `mulaw` (or `pcmu`). Unrecognized values fall back to `wav`.
</ParamField>

<ParamField body="lang" type="string" default="en">
  If provided, the language must match the language spoken by the provided speaker. Pass a BCP 47 language tag:

  | Tag  | Language   |
  | ---- | ---------- |
  | `en` | English    |
  | `es` | Spanish    |
  | `fr` | French     |
  | `pt` | Portuguese |
  | `de` | German     |
  | `ja` | Japanese   |
  | `ar` | Arabic     |
  | `hi` | Hindi      |
  | `it` | Italian    |

  The 3-letter ISO 639-2 codes that older integrations send (`eng`, `spa`, `fra`, `por`, `ger`, `jpn`, `ara`, `hin`, `ita`) remain accepted, and will stay accepted.

  See <a href="/docs/voices">the voices documentation</a> for which speakers support each language.
</ParamField>

<ParamField body="samplingRate" type="int" default="24000">
  The sampling rate in Hz. Any positive integer is accepted; values above the model's native rate are upsampled. Common choices are 8000 (telephony), 16000, 22050, 24000, and 44100.
</ParamField>

<ParamField body="segment" type="string" default="bySentence">
  Controls how text is segmented for synthesis. Available options:

  * "immediate" - Synthesizes text immediately without waiting for complete sentences
  * "never" - Never segments the text, waits for explicit flush or EOS
  * "bySentence" (default) - Waits for complete sentences before synthesis

  Note: For backward compatibility, setting `immediate=true` in query params is equivalent to `segment=immediate`. If a null value is provided, it will default to "bySentence".
</ParamField>

<RequestExample>
  ```python Python theme={null}
  import asyncio
  import json
  import websockets
  import base64

  class RimeClient:
      def __init__(self, speaker, api_key):
          self.url = f"wss://users-ws.rime.ai/ws3?speaker={speaker}&modelId=coda&audioFormat=mp3"
          self.auth_headers = {
              "Authorization": f"Bearer {api_key}"
          }
          self.audio_data = b''

      async def send_messages(self, websocket, messages):
          for message in messages:
              await websocket.send(json.dumps(message))

      async def handle_audio(self, websocket):
          while True:
              try:
                  audio = await websocket.recv()
              except websockets.exceptions.ConnectionClosedOK:
                  break
              message = json.loads(audio)

              if message['type'] == 'chunk':
                self.audio_data += base64.b64decode(message['data'])

              if message['type'] == 'timestamps':
                  print("Rime model pronounced the words...\n")
                  for w, t in zip(message['word_timestamps']['words'], message['word_timestamps']['start']):
                      print(f"'{w}' at time {t}")

      async def run(self, messages):
          async with websockets.connect(self.url, additional_headers=self.auth_headers) as websocket:
              await asyncio.gather(
                  self.send_messages(websocket, messages),
                  self.handle_audio(websocket),
              )

      def save_audio(self, file_path):
          with open(file_path, 'wb') as f:
              f.write(self.audio_data)
          print(f"\n Audio saved at {file_path}")


  message = [
      {"text": "This "},
      {"text": "is "},
      {"text": "a "},
      {"text": "test "},
      {"operation":"clear"},
      {"text": "This "},
      {"text": "is "},
      {"text": "an "},
      {"text": "incomplete "},
      {"text": "sentence "},
      {"operation": "eos"},
  ]

  client = RimeClient("astra", api_key="xxx")
  asyncio.run(client.run(message))

  client.save_audio("output.mp3")
  ```
</RequestExample>
