> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Word timestamps

> Word-level time alignments delivered alongside streaming audio — for barge-in handling, subtitles, and lip-sync.

When `word_timestamps: true` is set, the server performs forced alignment on
each generated audio chunk and sends a `word_timestamps` message shortly after
the corresponding audio. Useful for barge-in handling ("which word was the
agent on when the user interrupted?"), subtitle synchronization, and lip-sync.

<Note>
  Timestamp frames are delivered after their corresponding audio frames, so
  clients do not need to hold audio playback while waiting for alignment data.
</Note>

## Streaming with word timestamps

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    for chunk in client.tts.stream(
        text="Hello, this is streaming with timestamps.",
        model_id="kugel-3",
        voice_id=1071,
        word_timestamps=True,
    ):
        if hasattr(chunk, 'audio'):
            play_audio(chunk.audio)
        elif isinstance(chunk, list):
            # Word timestamps arrive as a list of WordTimestamp objects
            for ts in chunk:
                print(f"{ts.word}: {ts.start_ms}-{ts.end_ms}ms")
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    await client.tts.stream(
      {
        text: 'Hello, this is streaming with timestamps.',
        modelId: 'kugel-3',
        voiceId: 1071,
        wordTimestamps: true,
      },
      {
        onChunk: (chunk) => playAudio(chunk.audio),
        onWordTimestamps: (timestamps) => {
          for (const ts of timestamps) {
            console.log(`${ts.word}: ${ts.startMs}-${ts.endMs}ms`);
          }
        },
      }
    );
    ```
  </Tab>

  <Tab title="Java">
    ```java theme={null}
    client.tts().stream(
        GenerateRequest.builder("Hello, this is streaming with timestamps.")
            .modelId("kugel-3")
            .voiceId(1071)
            .language("en")
            .wordTimestamps(true)
            .build(),
        new StreamCallbacks() {
            @Override
            public void onChunk(AudioChunk chunk) {
                playAudio(chunk.getAudio());
            }
            @Override
            public void onWordTimestamps(List<WordTimestamp> timestamps) {
                for (WordTimestamp ts : timestamps) {
                    System.out.printf("%s: %d-%dms%n",
                        ts.getWord(), ts.getStartMs(), ts.getEndMs());
                }
            }
        }
    );
    ```
  </Tab>

  <Tab title="WebSocket (raw)">
    Word timestamps are only available on the WebSocket endpoints — the REST
    `/v1/tts/generate` endpoint does not accept `word_timestamps` (strict
    request validation returns `400 Bad Request`). Without an SDK,
    connect to a WebSocket endpoint directly:

    ```bash theme={null}
    wscat -c "wss://api.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY"
    > {"text": "Hello, this is streaming with timestamps.", "voice_id": 1071, "model_id": "kugel-3", "word_timestamps": true}
    ```

    `word_timestamps` frames arrive interleaved with the audio frames — see
    the [/ws/tts reference](/api-reference/tts/stream) and
    [/ws/tts/stream reference](/api-reference/tts/stream-input).
  </Tab>
</Tabs>

## The timestamp payload

Each `word_timestamps` message carries the alignments for one audio chunk:

```json theme={null}
{
  "word_timestamps": [
    {"word": "Hello", "start_ms": 0, "end_ms": 320, "char_start": 0, "char_end": 5, "score": 1.0},
    {"word": "world", "start_ms": 350, "end_ms": 680, "char_start": 7, "char_end": 12, "score": 1.0}
  ],
  "chunk_id": 0
}
```

| Field        | Type     | Description                                                                                |
| ------------ | -------- | ------------------------------------------------------------------------------------------ |
| `word`       | `string` | The aligned word                                                                           |
| `start_ms`   | `int`    | Start time in milliseconds (relative to chunk start)                                       |
| `end_ms`     | `int`    | End time in milliseconds (relative to chunk start)                                         |
| `char_start` | `int`    | Start offset in the synthesized chunk text (after normalization and dictionary processing) |
| `char_end`   | `int`    | Exclusive end offset in the synthesized chunk text                                         |
| `score`      | `float`  | Compatibility field; currently always `1.0`                                                |

Timestamps are relative to the start of their chunk — to place words on a
global timeline, accumulate the duration of previous chunks. Character
offsets are not guaranteed to index the original request when normalization
or a pronunciation dictionary rewrites the text.

## Where timestamps are available

| Surface                                          | How they arrive                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| SDK one-shot streaming (`stream`)                | `onWordTimestamps` callback (JS/Java) or timestamp items in the chunk iterator (Python)               |
| SDK reusable streaming session                   | `onWordTimestamps` callback (JS/Java), or `on_word_timestamps` plus `last_word_timestamps` (Python)   |
| SDK `generate()` (Python)                        | `AudioResponse.word_timestamps` — the SDK streams over WebSocket internally                           |
| `/ws/tts`, `/ws/tts/stream`, and `/ws/tts/multi` | `word_timestamps` frames interleaved with audio frames ([reference](/api-reference/tts/stream-input)) |
| REST `/v1/tts/generate`                          | **Not supported** — the field is rejected with `400`; use a WebSocket endpoint or an SDK              |

LiveKit uses these alignments natively for transcript sync — see the
[LiveKit integration](/integrations/livekit).
