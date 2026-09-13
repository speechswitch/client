> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Getting Started with Flux TTS Batch (REST)

The batch (REST) transport synthesizes a complete block of text and returns the full audio in one response. Use it to pre-generate fixed audio — IVR prompts, notifications, audiobook lines — where the whole text is known up front and you don't need incremental playback or interruption. For live, interruptible conversations, use the [real-time WebSocket](/docs/flux-tts/quickstart) instead (see [Batch vs Streaming](/docs/flux-tts/batch-vs-streaming)).

Batch is stateless request/response: simple retries, high fan-out, no connection lifecycle to manage. It serves the same Flux voices as the streaming transport.

## Make a request

```bash
curl "https://api.deepgram.com/v2/speak?model=flux-haley-en" \
  -H "Authorization: Token YOUR_DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Your appointment is confirmed for 3pm tomorrow." }' \
  --output audio.mp3
```

The response body is the synthesized audio in the requested encoding. Per-request telemetry is returned as response headers, mirroring Aura's REST conventions — character counts and the generic `dg-warnings` header.

## Query parameters

| Parameter         | Default              | Description                                                                                                                                                                                                                                    |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`           | —                    | **Required.** A `flux-{voice}-{language}` model (e.g. `flux-haley-en`).                                                                                                                                                                        |
| `encoding`        | `mp3`                | `mp3`, `opus`, `flac`, `aac` (containerized/compressed), or raw `linear16` / `mulaw` / `alaw`.                                                                                                                                                 |
| `bit_rate`        | per-encoding default | Bit rate for compressed encodings. For `mp3`: `8000`, `16000`, `24000`, `32000`, `40000`, `48000`.                                                                                                                                             |
| `container`       | per-encoding default | Output container where applicable (e.g. `wav` for `linear16`, `ogg` for `opus`).                                                                                                                                                               |
| `sample_rate`     | model native         | Sample rate; supported values depend on `encoding`. `linear16`: `8000`, `16000`, `24000`, `32000`, `44100`, `48000`. `mulaw` / `alaw`: `8000`, `16000`. `flac`: `8000`, `16000`, `22050`, `32000`, `48000`. Not applicable to `mp3` or `opus`. |
| `speed`           | `1.0`                | Speech-rate multiplier — `0.5` to `1.5` in `0.05` increments. Not supported by every model or language; unsupported combinations return `SPEED_NOT_SUPPORTED`.                                                                                 |
| `expressivity`    | `0`                  | **Beta.** Delivery register, `-2` (calm) to `2` (animated). See [Expressivity](/docs/tts-expressivity).                                                                                                                                        |
| `callback`        | —                    | URL to receive the result asynchronously, instead of on the response body.                                                                                                                                                                     |
| `callback_method` | `POST`               | HTTP method for the callback request (`POST` or `PUT`).                                                                                                                                                                                        |
| `priority`        | —                    | Prioritization for asynchronous (callback) requests. Only value: `Low`.                                                                                                                                                                        |
| `tag`             | —                    | Label requests for usage reporting. Repeatable.                                                                                                                                                                                                |
| `mip_opt_out`     | `false`              | Opt out of the Model Improvement Program.                                                                                                                                                                                                      |

Conversational constructs (`Flush`, `Interrupt`, `speech_id`, lifecycle events) do not apply to batch. `model`, `speed`, `expressivity`, and the media-output settings behave the same as on the [streaming surface](/docs/flux-tts/quickstart), so the contract doesn't fragment across transports. Inline controls — pause and pronunciation — are coming soon on both transports.

## When to use batch vs streaming

See [Batch vs Streaming: Which Should I Use?](/docs/flux-tts/batch-vs-streaming) for the decision guide.

## Related resources

* [Batch vs Streaming](/docs/flux-tts/batch-vs-streaming)
* [Real-Time / Conversational Getting Started](/docs/flux-tts/quickstart)
* [Voices and Languages](/docs/flux-tts/voices)
* [Media Output Settings](/docs/tts-media-output-settings)

---