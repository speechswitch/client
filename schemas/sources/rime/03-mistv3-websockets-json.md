> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Websockets JSON

> Mist v3 JSON WebSocket (/ws3): structured events with base64 audio chunks and word-level timestamps.

The Rime API authenticates every request with a bearer token in the `Authorization` header: `Authorization: Bearer YOUR_API_KEY`. See [API authentication](/docs/api-authentication) for how to create a key.

## Overview

In addition to a plaintext websocket implementation, Rime also has an implementation that sends and receives events as JSON objects. Like the other implementation, all synthesis arguments are provided as query parameters when establishing the connection.

The websocket API buffers inputs up to one of the following punctuation characters: `.`, `?`, `!`. This is most pertinent for the initial messages sent to the API, as synthesis won't begin until there are sufficient tokens to generate audio with natural prosody. After the first synthesis of any given utterance, typically enough time has elapsed that subsequent audio contains multiple clauses, and the buffering becomes largely invisible.

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

Context IDs can be provided, which will be attached to subsequent messages that the server sends back to the client. Rime will not maintain multiple simultaneous context ids.

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

The audio will be a base64 encoded chunk of audio bytes in the audio format specified when the connection was established.

#### Timestamps

Word-level timestamps are emitted alongside the audio chunks so the client can tell exactly which words have been spoken at any point. This is especially useful for handling interruptions: when the user starts talking over the output, you can map the playback position back to the last word that was actually heard.

<Warning>Timestamps are emitted only when `lang` is `en`/`eng` or `es`/`spa`, or when `lang` is omitted. Requests in any other language receive `chunk` and `done` events with no `timestamps` event and no error (this includes fr and de). Do not block playback while waiting for a timestamps event.</Warning>

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
    "words": ["Testing", "mistv3", "timestamps."],
    "start": [0, 0.35396, 1.41584],
    "end":   [0.35396, 1.41584, 3.18564]
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

In the event of a malformed or unexpected input, the server will immediately respond with an error message. The server will *not* close the connection, and will still accept subsequent well-formed messages.

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

<ParamField body="modelId" type="string" default="mistv3">
  Set to `mistv3`.
</ParamField>

<ParamField body="audioFormat" type="string">
  One of `wav`, `mp3` (or `mpeg`), `ogg` (Opus in OGG), `webm` (Opus in WebM), `pcm` (or `l16`), or `mulaw` (or `pcmu`). Unrecognized values fall back to `wav`.
</ParamField>

<ParamField body="lang" type="string" default="eng">
  If provided, the language must match the language spoken by the selected speaker. Verify the pairing in the <a href="/docs/voices">Rime voice catalog</a>.
</ParamField>

<ParamField body="pauseBetweenBrackets" type="bool" default="false">
  When set to true, adds pauses between words enclosed in angle brackets. The number inside the brackets specifies the pause duration in milliseconds.
  Example: `Hi. <200> I'd love to have a conversation with you.` adds a 200ms pause. Learn more about [custom pauses](/docs/custom-pauses).
</ParamField>

<ParamField body="samplingRate" type="int">
  The sampling rate in Hz. Default: 24000. Values above 24000 are upsampled.
</ParamField>

<ParamField body="inlineSpeedAlpha" type="string">
  Comma-separated list of speed values applied to words in square brackets. Values \< 1.0 speed up speech, > 1.0 slow it down.
  Example: "This is \[slow] and \[fast]", use "3, 0.5" to make "slow" slower and "fast" faster.
</ParamField>

<ParamField body="speedAlpha" type="float" default="1.0">
  Adjusts the speed of speech. Higher than 1.0 is faster and lower than 1.0 is slower.
</ParamField>

<ParamField body="segment" type="string" default="bySentence">
  Controls how text is segmented for synthesis. Available options:

  * "immediate" - Synthesizes text immediately without waiting for complete sentences
  * "never" - Never segments the text, waits for explicit flush or EOS
  * "bySentence" (default) - Waits for complete sentences before synthesis
</ParamField>

<RequestExample>
  ```python Python theme={null}
  import asyncio
  import json
  import websockets
  import base64

  class RimeClient:
      def __init__(self, speaker, api_key):
          self.url = f"wss://users-ws.rime.ai/ws3?speaker={speaker}&modelId=mistv3&audioFormat=mp3"
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
      {"text": "an "},
      {"text": "incomplete "},
      {"text": "sentence "},
      {"operation": "eos"},
  ]

  client = RimeClient("cove", api_key="YOUR_API_KEY")
  asyncio.run(client.run(message))

  client.save_audio("output.mp3")
  ```
</RequestExample>
