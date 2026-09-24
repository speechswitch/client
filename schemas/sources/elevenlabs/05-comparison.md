> This is a page from the ElevenLabs documentation. For a complete page index, fetch https://elevenlabs.io/docs/llms.txt. For the full documentation in a single file, fetch https://elevenlabs.io/docs/llms-full.txt.

# Text to Speech vs Text to Dialogue WebSockets

ElevenLabs exposes two different WebSocket products for streaming synthesized speech. They solve different problems, accept different message shapes, and target different models.

## Which WebSocket should I use?

Use the **Text to Speech (TTS) WebSocket** when you stream plain text for **one voice per connection** (the voice is fixed in the URL) and you want **non-v3** models such as Flash or Multilingual v2, optional SSML, chunk schedules, or the **multi-context** variant for agent-style interruption handling.

Use the **Text to Dialogue (TTD) WebSocket** when you need **Eleven v3** dialogue behavior: expressive delivery, **per-chunk `voice_id`**, turn boundaries (`new_turn`), and the same dialogue-oriented buffering used for v3 on the server.

For **batch or HTTP streaming** dialogue (full request in one call), use [Create dialogue](/docs/api-reference/text-to-dialogue/convert) or [Stream dialogue](/docs/api-reference/text-to-dialogue/stream) instead of a WebSocket.

## Comparison

|                                 | Text to Speech WebSocket                                                                                                                                                       | Text to Dialogue WebSocket                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API reference**               | [TTS stream-input](/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)                                                                                | [TTD WebSocket](/docs/api-reference/text-to-dialogue/ttd-websocket)                                                                                                                                                     |
| **URL**                         | `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`                                                                                                            | `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input`                                                                                                                                                              |
| **Voice selection**             | One `voice_id` in the path; all streamed text uses that voice                                                                                                                  | First message registers one or more `voices` by ID; each `inputs[]` entry names a `voice_id`                                                                                                                            |
| **Models**                      | Flash, Multilingual v2, and other supported TTS models. **Not** `eleven_v3` on this endpoint.                                                                                  | **`model_id` must start with `eleven_v3`** (for example `eleven_v3` or `eleven_v3_conversational`)                                                                                                                      |
| **First client message**        | Initialize with a space and optional `voice_settings` / `generation_config` (see realtime TTS guide)                                                                           | Must include **`voices`** (and credentials if not already sent via headers or query)                                                                                                                                    |
| **Ongoing text**                | Send a `text` string (typically trailing space); optional `flush`, `try_trigger_generation`, etc.                                                                              | Send **`inputs`**: `{ text, voice_id, new_turn? }` objects; optional **`flush`**, **`close_socket`**, **`keep_alive`**                                                                                                  |
| **Buffering / scheduling**      | Chunk length schedule and related TTS WebSocket controls                                                                                                                       | Server buffers until enough text is present (roughly **40 characters and 8 words**) before emitting audio, unless you **`flush`**                                                                                       |
| **Multi-speaker on one socket** | Use [multi-context WebSocket](/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket) for multiple **parallel TTS contexts**, not multi-speaker dialogue semantics | Up to **10** registered voices for `eleven_v3`; **`eleven_v3_conversational` allows only one** registered voice                                                                                                         |
| **Inactivity**                  | Configurable `inactivity_timeout` (TTS WebSocket query)                                                                                                                        | **Fixed 20s** between client messages unless you send **`keep_alive`**                                                                                                                                                  |
| **Concurrency**                 | Only active generation time counts toward your plan's [concurrency limit](/docs/overview/models#concurrency-and-priority); an idle open socket does not count                  | Each open connection holds one [dialogue session](/docs/overview/models#text-to-dialogue-concurrency) from a separate pool for its whole lifetime; generation over the connection does not consume standard concurrency |
| **Alignment**                   | Optional `sync_alignment` (TTS field naming in API reference)                                                                                                                  | Optional `sync_alignment`; JSON uses **snake\_case** fields on responses (for example `is_final`, `char_start_times_ms`)                                                                                                |

## When the TTS WebSocket is the better fit

* You already integrate **Flash** or **Multilingual v2** for latency or language coverage.
* You want **one narrator voice** per connection and a simple text-per-frame protocol.
* You need **multi-context** orchestration for barge-in and parallel utterances ([multi-context guide](/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket)).

See [Generate audio in real-time](/docs/eleven-api/guides/how-to/websockets/realtime-tts) for a full walkthrough of the TTS WebSocket.

## When the TTD WebSocket is the better fit

* You target **Eleven v3** dialogue (expressive tags, conversational pacing, multi-speaker lines).
* You stream **scripted or LLM-generated dialogue** where the **speaking voice can change per line** without opening a new connection.
* You want **WebSocket-shaped** incremental input with **v3-only** dialogue generation on the server.

For a hands-on walkthrough, use [Realtime Text to Dialogue](/docs/eleven-api/guides/how-to/websockets/realtime-tdd). Protocol details are in the [API reference](/docs/api-reference/text-to-dialogue/ttd-websocket).

## Related guides

#### [Realtime Text to Dialogue](/docs/eleven-api/guides/how-to/websockets/realtime-tdd)

Connect, register voices, stream `inputs`, and save audio from the TTD WebSocket.

#### [Realtime TTS WebSocket](/docs/eleven-api/guides/how-to/websockets/realtime-tts)

Step-by-step connection and messaging for the standard TTS WebSocket.

#### [Multi-context WebSocket](/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket)

Multiple TTS contexts on one connection for agent workflows.

#### [Text to Dialogue quickstart](/docs/eleven-api/guides/cookbooks/text-to-dialogue)

HTTP request examples for multi-voice dialogue.

#### [Text to Dialogue capability](/docs/overview/capabilities/text-to-dialogue)

Product-oriented overview of dialogue generation.