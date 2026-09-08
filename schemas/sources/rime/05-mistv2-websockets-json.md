> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Websockets JSON

> Mist v2 JSON WebSocket (/ws2): structured events with base64 audio chunks and word-level timestamps.

The Rime API authenticates every request with a bearer token in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`. See [API authentication](/docs/api-authentication) for how to create a key.

## Overview

In addition to a plaintext websocket implementation, Rime also has an implementation that sends and receives events as JSON objects. Like the other implementation, all synthesis arguments are provided as query parameters when establishing the connection.

The WebSocket API buffers inputs up to one of the following punctuation characters: `.`, `?`, `!`. This is most pertinent for the initial messages sent to the API, as synthesis won't begin until there are sufficient tokens to generate audio with natural prosody. After the first synthesis of any given utterance, typically enough time has elapsed that subsequent audio contains multiple clauses, and the buffering becomes largely invisible.

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

Context IDs can be provided, which will be attached to subsequent messages that the server sends back to the client. Rime will not maintain multiple simultaneous context ids. The events will contain the most recent context ID at the time that audio was requested. In the above examples, even if both messages are received by the server before it sends any audio, the audio response for the first sentence will be tagged with `contextId: null`, and the audio for the second will be tagged with its UUID.

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

At times, your client would like to generate audio for whatever remains in the buffer, and then have the connection immediately closed.

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

The audio will be a base64 encoded chunk of audio bytes in the audio format specified when the connection was established. If you provided any context id when sending the relevant text, it'll be included here.

#### Timestamps

Word-level timestamps are emitted alongside the audio chunks so the client can tell exactly which words have been spoken at any point. This is especially useful for handling interruptions: when the user starts talking over the output, you can map the playback position back to the last word that was actually heard.

<Warning>Timestamps are emitted only when `lang` is `en`/`eng` or `es`/`spa`, or when `lang` is omitted. Requests in any other language receive `chunk` and `done` events with no `timestamps` event and no error. Do not block playback while waiting for a timestamps event.</Warning>

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
    "words": ["Hello", "from", "a", "timestamps", "probe", "."],
    "start": [0, 0.35991, 0.51084, 0.59211, 1.10295, 1.41642],
    "end":   [0.35991, 0.51084, 0.59211, 1.10295, 1.41642, 1.5093]
  },
  "contextId": null
}
```

#### Done

After the last audio chunk for a synthesis batch has been sent, the server emits a `done` event. This signals that the current synthesis is fully complete. If the client sends more text and triggers further synthesis, another `done` will follow. The `eos` operation emits a final `done` for any remaining buffered content before the server closes the connection; if the buffer is already empty, the server closes without a `done`.

```typescript theme={null}
type DoneEvent = {
  type: "done",
  done: true,
  contextId: string | null,
}
```

<Note>
  On `/ws2`, the `done` event carries an extra boolean `done: true` field in addition to `type: "done"`. On `/ws3` the event contains only `type` and `contextId`. Match on `type === "done"` to handle both.
</Note>

When exactly `done` fires depends on the `segment` setting. See [Segmentation and behavior settings](/docs/websockets-segment) for full details.

#### Error

In the event of a malformed or unexpected input, the server will immediately respond with an error message. The server will *not* close the connection, and will still accept subsequent well-formed messages. It's up to the client to decide if it wants to close upon receiving an error.

```typescript theme={null}
type ErrorEvent = {
  type: "error",
  message: string,
}
```

## Variable parameters

<ParamField body="speaker" type="string" required>
  Must be a voice from the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="text" type="string" required>
  The text you'd like spoken. Character limit per request is 1,000 via the API and in the dashboard UI.
</ParamField>

<ParamField body="modelId" type="string">
  Set to `mistv2`.
</ParamField>

<ParamField body="audioFormat" type="string">
  One of `mp3`, `mulaw`, or `pcm`
</ParamField>

<ParamField body="lang" type="string" default="eng">
  If provided, the language must match the language spoken by the selected speaker. Verify the pairing in the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="pauseBetweenBrackets" type="bool" default="false">
  When set to true, adds pauses between words enclosed in angle brackets. The number inside the brackets specifies the pause duration in milliseconds. <br />
  Example: "Hi. \<200> I'd love to have a conversation with you." adds a 200ms pause between the first and second sentences.
</ParamField>

<ParamField body="phonemizeBetweenBrackets" type="bool" default="false">
  When set to true, you can specify the phonemes for a word enclosed in curly brackets. <br />
  Example: "\{h'El.o} World" will pronounce "Hello" as expected. Learn more about <a href="/docs/custom-pronunciation">custom pronunciation</a>.
</ParamField>

<ParamField body="inlineSpeedAlpha" type="string">
  Comma-separated list of speed values applied to words in square brackets. Values \< 1.0 speed up speech, > 1.0 slow it down.
  Example: "This is \[slow] and \[fast]", use "3, 0.5" to make "slow" slower and "fast" faster.
</ParamField>

<ParamField body="samplingRate" type="int">
  The value, if provided, must be between 4000 and 44100. Default: 22050
</ParamField>

<ParamField body="speedAlpha" type="float" default="1.0">
  Adjusts the speed of speech. Lower than 1.0 is faster and higher than 1.0 is slower.

  *Note: this is the legacy Mist v2 convention. Coda and Mist v3 invert it; for those, higher than 1.0 is faster.*
</ParamField>

<ParamField body="noTextNormalization" type="bool" default="false">
  **mist/mistv2 only.** Skips text normalization of the input text prior to synthesizing audio. This will reduce latency at the cost of some possible mispronunciation of digits and abbreviations.
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
          self.url = f"wss://users-ws.rime.ai/ws2?speaker={speaker}&modelId=mistv2&audioFormat=mp3"
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

  client = RimeClient("cove", api_key="xxx")
  asyncio.run(client.run(message))

  client.save_audio("output.mp3")
  ```
</RequestExample>
