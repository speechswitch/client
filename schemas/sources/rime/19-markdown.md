---
name: Rimelabs
description: Use when building text-to-speech applications, voice agents, real-time conversational AI, or integrating natural speech synthesis into existing systems. Reach for this skill when you need to generate audio from text, stream speech for low-latency interactions, customize voice delivery, or deploy speech infrastructure on-premises.
metadata:
    mintlify-proj: rimelabs
    version: "1.0"
---

# Rime Labs Skill

## Product summary

Rime Labs is a neural text-to-speech platform that generates natural, low-latency speech for voice agents, IVR systems, and conversational AI. The flagship model, **Coda**, delivers sub-100ms model latency and 253 voices across 9 languages. Rime exposes a single HTTP and WebSocket API surface (`https://users.rime.ai` for TTS, `wss://users-ws.rime.ai` for WebSockets, `https://optimize.rime.ai` for text normalization). Authenticate all requests with `Authorization: Bearer YOUR_API_KEY`. Key files: API tokens at `app.rime.ai/tokens`, CLI config at `~/.rime/rime.toml`. CLI commands: `rime tts`, `rime curl`, `rime login`, `rime config`. Primary docs: https://docs.rime.ai

## When to use

- **Building voice agents**: Use WebSocket `/ws3` for persistent, low-latency synthesis with word-level timestamps and interruption handling.
- **Adding speech to existing backends**: Use HTTP `POST /v1/rime-tts` to synthesize complete utterances and stream audio in the response.
- **Customizing speech delivery**: Use prompting guides, text normalization, and pronunciation control (Mist v2 only) to shape how text is spoken.
- **Debugging pronunciation or normalization**: Use `/textnorm` endpoint to preview exactly how numbers, dates, and abbreviations will be read.
- **Choosing between models**: Use Coda for voice quality and 9-language support; use Mist v3 for lowest time-to-first-audio (~37ms); use Mist v2 for inline pronunciation control.
- **Deploying privately**: Use on-prem Docker Compose or Kubernetes to keep audio and text inside your network.
- **Integrating with frameworks**: Use LiveKit, Pipecat, Vapi, Daily, or SignalWire integrations; Rime plugs in as the TTS stage.

## Quick reference

### Essential endpoints

| Endpoint | Purpose | Auth | Returns |
|----------|---------|------|---------|
| `POST /v1/rime-tts` | Synthesize complete text | Bearer token | Audio bytes (stream or full) |
| `wss://users-ws.rime.ai/ws3` | Persistent synthesis (Coda/Mist) | Bearer header | JSON events: `chunk`, `timestamps`, `done`, `error` |
| `POST /textnorm` (optimize.rime.ai) | Preview text normalization | Bearer token | JSON: `{"normalized": "..."}` |
| `POST /oov` | Check vocabulary coverage | Bearer token | Array of out-of-dictionary words |
| `GET /data/voices/all-v2.json` | List voices by model/language | None | Voice names keyed by modelId and lang |
| `GET /data/voices/voice_details.json` | Voice metadata (gender, age, accent) | None | Full voice catalog with demographics |

### Common parameters

| Parameter | Values | Required | Notes |
|-----------|--------|----------|-------|
| `speaker` | Voice name (e.g., `astra`, `lyra`, `masonry`) | Yes | Must match model and language. No default. |
| `modelId` | `coda`, `mistv3`, `mistv2` | Yes (set explicitly) | Omitting it defaults to Mist v3 on `/ws3`. |
| `text` | String, up to 1,000 chars | Yes | Split longer text into multiple requests. |
| `lang` | `en`, `es`, `fr`, `de`, `ja`, `pt`, `ar`, `hi` | No | Must match speaker's language. Coda: 9 languages; Mist v3: 4 (en, es, fr, de). |
| `audioFormat` (WS) | `mp3`, `wav`, `ogg`, `webm`, `pcm`, `mulaw` | No | HTTP uses `Accept` header instead. |
| `Accept` (HTTP) | `audio/mpeg`, `audio/wav`, `audio/webm;codecs=opus`, `audio/PCMU` | No | Default: `audio/mpeg`. Use `audio/PCMU` for telephony. |
| `samplingRate` | 8000–96000, default 24000 | No | Use 8000 for telephony; above 24000 is upsampling. |
| `segment` (WS) | `bySentence` (default), `immediate`, `never` | No | Controls when synthesis triggers on buffered text. |

### Starter voices (all English, all models)

| Voice | Gender | Age | Personality | Works on |
|-------|--------|-----|-------------|----------|
| `astra` | Female | 18–30 | Bright, energetic Californian | Coda, Mist v3 |
| `luna` | Female | 18–30 | Lively, casual | Coda, Mist v3 |
| `masonry` | Male | 30–50 | Confident, Southern | Coda |
| `albion` | Male | 18–30 | Young adult, English | Coda |
| `lyra` | Female | 18–30 | Warm, professional | Coda |

### CLI commands

| Command | Purpose |
|---------|---------|
| `rime login` | Authenticate with Rime dashboard (stores key at `~/.rime/rime.toml`) |
| `rime tts --text "hello" --speaker astra --model coda` | Synthesize and play audio |
| `rime tts --text "hello" --speaker astra --model coda --output hello.mp3` | Save to file |
| `rime curl --text "hello" --speaker astra --model coda` | Generate curl command for API request |
| `rime config` | Manage named environments and settings |
| `rime usage` | Check account usage and billing |

## Decision guidance

### When to use HTTP vs WebSocket

| Use HTTP streaming | Use WebSocket `/ws3` |
|-------------------|----------------------|
| Synthesizing complete sentences server-side | Building a voice agent with incremental text from LLM |
| Simple integrations, one request per utterance | Persistent connection, multi-utterance synthesis |
| No need for word-level timestamps | Need word-level timestamps for interruption handling |
| Simpler client code | Need to handle barge-in and turn-taking |

### When to use Coda vs Mist v3 vs Mist v2

| Choose Coda | Choose Mist v3 | Choose Mist v2 |
|-------------|----------------|----------------|
| Default for most new apps | Lowest time-to-first-audio (~37ms) | Need inline pronunciation control |
| Highest voice quality in evals | Speed is the priority | Must control pronunciation of brand names |
| Need 9 languages | 4 languages sufficient (en, es, fr, de) | Custom pauses and pronunciation matter |
| Sub-100ms model latency acceptable | Need fastest possible response | Pronunciation accuracy is load-bearing |

### When to use text normalization vs custom pronunciation

| Use text normalization | Use custom pronunciation |
|------------------------|-------------------------|
| Numbers, dates, currency, phone numbers | Brand or product names |
| Standard abbreviations (Dr., e.g., etc.) | Uncommon words not in dictionary |
| Measurements and percentages | Acronyms that need specific pronunciation |
| Rime handles these automatically | Mist v2 only; Coda does not support |

## Workflow

### 1. Generate your first audio (HTTP)

1. **Get an API key**: Sign in to `app.rime.ai`, open **API Tokens**, create a token, copy it.
2. **Choose a voice**: Pick a starter voice from the table above (e.g., `astra` for Coda).
3. **Make a request**:
   ```bash
   curl -X POST https://users.rime.ai/v1/rime-tts \
     -H 'Authorization: Bearer YOUR_API_KEY' \
     -H 'Content-Type: application/json' \
     -H 'Accept: audio/mpeg' \
     --output hello.mp3 \
     -d '{"text": "Hello from Rime.", "speaker": "astra", "modelId": "coda", "lang": "en"}'
   ```
4. **Play the file**: `open hello.mp3` (macOS) or equivalent.

### 2. Build a voice agent (WebSocket)

1. **Set up transport**: Choose LiveKit (complete tutorial), Pipecat, or direct WebSocket bridge.
2. **Connect to `/ws3`**: Establish persistent WebSocket with `Authorization` header and query params (`speaker`, `modelId`, `audioFormat`).
3. **Send text incrementally**: As your LLM generates response text, send `{"text": "..."}` messages.
4. **Receive audio and timestamps**: Listen for `chunk` (base64 audio), `timestamps` (word-level timing), `done` events.
5. **Handle interruptions**: Use `clear` operation and context IDs to manage barge-in; map playback position to word timestamps.
6. **End synthesis**: Send `{"operation": "eos"}` to synthesize buffered text and close.

### 3. Customize speech delivery

1. **Debug normalization**: POST text to `https://optimize.rime.ai/textnorm` to see exactly what the model will speak.
2. **Use prompting guide**: Follow the system prompt template in the prompting guide to make LLM output sound natural when spoken.
3. **Control pronunciation** (Mist v2 only): Use `phonemizeBetweenBrackets: true` and the Rime phonetic alphabet for brand names.
4. **Use `spell()` for IDs**: Wrap confirmation codes, account numbers, and acronyms in `spell(...)` to force letter-by-letter reading.
5. **Test before shipping**: Run realistic samples through `/textnorm`, verify against the voice catalog, and test regeneration consistency.

### 4. Deploy on-premises

1. **Install NVIDIA Container Toolkit**: Follow the on-prem quickstart.
2. **Deploy with Docker Compose**: Use the provided compose file with Coda or Mist.
3. **Configure authentication**: Set `RIME_API_KEY` environment variable so callers don't need to send the header.
4. **Monitor**: Expose Prometheus metrics via OpenTelemetry; track `rime.engine.initial_latency`, `rime.engine.concurrent_pipeline`.

## Common gotchas

- **Omitting `modelId` on `/ws3`**: Requests default to Mist v3; speakers outside the Mist v3 catalog fail with "Speaker not found". Always set `modelId: coda` explicitly.
- **Putting API key in browser code**: WebSocket connections from the browser cannot set the `Authorization` header. Use a server-side bridge (Node, Python, etc.) to proxy synthesis.
- **Retrying after partial audio**: Retrying a failed synthesis after audio has already arrived re-bills the full character count. For long utterances, synthesize in sentence chunks and resume from the last chunk received.
- **Assuming a voice speaks multiple languages**: Each voice serves one language. Coda has 162 English voices but only 2 Hindi voices. Verify the speaker/language pairing against the voice catalog before shipping.
- **Not testing text normalization**: Numbers, dates, and abbreviations are normalized automatically, but edge cases (decade names, financial periods, non-dollar currency) may not expand as expected. Use `/textnorm` to verify before release.
- **Using `spell()` on Coda**: The `spell()` function only works on Mist models. Coda's pipeline passes it through unprocessed.
- **Inline pronunciation control on Coda or Mist v3**: `phonemizeBetweenBrackets` is Mist v2 and Mist v1 only. For Coda, submit words to Rime's dictionary or respell phonetically in plain English.
- **Ignoring regional endpoints**: Cloud API latency is lowest when you use the nearest regional endpoint (US East, US West, EU, etc.). Check the regional endpoints guide before optimizing latency.
- **Not handling WebSocket close codes**: A `1011` close with a reason string is the WebSocket equivalent of an HTTP error. Read the reason string (it usually starts with the HTTP status) before retrying.

## Verification checklist

Before submitting work with Rime:

- [ ] **API key is valid**: Test with `rime login` or a simple curl request.
- [ ] **`modelId` is set explicitly**: Verify `modelId: coda` (or `mistv3`/`mistv2`) on every request, especially WebSocket connections.
- [ ] **Speaker/language pairing is valid**: Confirm the speaker exists in the voice catalog for the chosen model and language.
- [ ] **Text normalization is correct**: POST sample text to `/textnorm` and verify the normalized output matches expectations.
- [ ] **Audio format is supported**: Verify `Accept` header (HTTP) or `audioFormat` (WebSocket) is one of the supported types for the model.
- [ ] **Streaming is consumed incrementally**: For HTTP, iterate over response chunks instead of buffering the whole body.
- [ ] **WebSocket authentication is server-side**: Confirm the `Authorization` header is set on the server, not in browser code.
- [ ] **Error handling covers both transports**: Handle HTTP status codes (400, 401, 429, 500) and WebSocket close codes (`1011`).
- [ ] **Retry logic is safe**: Only retry 500/502 errors; do not retry 400/401/403. For partial audio, resume from the last chunk, not the full text.
- [ ] **Regional endpoint is nearest**: Confirm you are using the closest regional endpoint to reduce network latency.

## Resources

- **Comprehensive page listing**: https://docs.rime.ai/llms.txt — full navigation of all documentation pages for agent reference.
- **API Cheat Sheet**: https://docs.rime.ai/docs/api-cheat-sheet — base URLs, authentication, runnable examples for HTTP, WebSocket, and utility endpoints.
- **Voice Agents Guide**: https://docs.rime.ai/docs/voice-agents — choose between LiveKit, Pipecat, direct API starters, and WebSocket implementations.
- **Models Reference**: https://docs.rime.ai/docs/models — feature matrix and latency benchmarks for Coda, Mist v3, and Mist v2.
- **Streaming TTS**: https://docs.rime.ai/docs/streaming — HTTP vs WebSocket tradeoffs, latency optimization, and telephony audio formats.
- **Text Normalization**: https://docs.rime.ai/docs/text-normalization — how numbers, dates, and abbreviations are expanded; debugging with `/textnorm`.
- **Prompting Guide**: https://docs.rime.ai/docs/prompting — system prompt template for making LLM output sound natural when spoken.
- **Error Reference**: https://docs.rime.ai/docs/errors — status codes, close codes, and what to capture for support.
- **CLI Reference**: https://docs.rime.ai/cli-reference/overview — commands, configuration, and troubleshooting.
- **MCP Server**: https://docs.rime.ai/docs/mcp — connect Claude, Codex, or compatible IDEs to browse voices and generate integration code.

---

> For additional documentation and navigation, see: https://docs.rime.ai/llms.txt