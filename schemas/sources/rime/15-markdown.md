> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# API reference index

> Index of Rime's TTS HTTP, WebSocket, and metadata endpoints across all supported models.

Send TTS requests to `https://users.rime.ai/v1/rime-tts` and authenticate with a bearer token in the `Authorization` header. See [API authentication](/docs/api-authentication).

Most clients should start with **Coda**, Rime's flagship model:

* [Coda: Streaming HTTP](/api-reference/coda/http)
* [Coda: WebSockets (`/ws`)](/api-reference/coda/websockets)
* [Coda: WebSockets JSON (`/ws3`)](/api-reference/coda/websockets-json)

For the cross-model overview of when to use each WebSocket endpoint, see [WebSocket API Overview](/docs/websockets).

## TTS endpoints by model

| Model               | Streaming HTTP                                                        | WebSocket `/ws`                         | WebSocket JSON                                |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| **Coda** (flagship) | [HTTP](/api-reference/coda/http)                                      | [/ws](/api-reference/coda/websockets)   | [/ws3](/api-reference/coda/websockets-json)   |
| **Mist v3**         | [HTTP](/api-reference/mistv3/http)                                    | [/ws](/api-reference/mistv3/websockets) | [/ws3](/api-reference/mistv3/websockets-json) |
| **Mist v2**         | [HTTP](/api-reference/mistv2/http) · [SSE](/api-reference/mistv2/sse) | [/ws](/api-reference/mistv2/websockets) | [/ws2](/api-reference/mistv2/websockets-json) |

Mist v2 also exposes non-streaming JSON-wrapped formats: [MP3](/api-reference/mistv2/json-mp3), [WAV](/api-reference/mistv2/json-wav), [Opus/OGG](/api-reference/mistv2/json-ogg), [G.711 μ-law](/api-reference/mistv2/json-mulaw).

## Metadata endpoints

* [List All Voices](/api-reference/data/voices-v2): `GET /data/voices/all-v2.json`
* [List Voice Details](/api-reference/data/voice-details): `GET /data/voices/voice_details.json`

## Utility endpoints

* [Coverage (out-of-vocabulary check)](/api-reference/other/oov): `POST /oov`
* [Text Normalization](/api-reference/other/textnorm): `POST /textnorm`

## Related

* [Quickstart: TTS in five minutes](/docs/quickstart-five-minute)
* [Models](/docs/models): comparing Coda and Mist
* [Voices](/docs/voices): voice lineup and language support
* [Latency tuning](/docs/latency)
* [Changelog](/docs/changelog)
