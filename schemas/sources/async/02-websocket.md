# Text to Speech (WebSocket)

> # Text-to-Speech WebSockets API

The **Text-to-Speech WebSockets API** streams audio from *partial* or *incrementally arriving* text while preserving natural prosody and low latency.
Use it when your text arrives **in real time** (e.g., transcription, chat, or conversation scenarios).

It may be less suitable when the full text is available upfront (the HTTP API is simpler and slightly lower-latency).

---

## Handshake

> **WSS** `wss://api.async.com/text_to_speech/websocket/ws`

### Query Parameters

| Name      | Type   | Required | Description               |
| --------- | ------ | -------- | ------------------------- |
| `api_key` | string | **Yes**  | Your Async API key.       |
| `version` | string | **Yes**  | API version (e.g., `v1`). |

---

## Send

### 1. `initializeConnection` *(required)*

| Property        | Type   | Required | Description                                                                                                        |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `model_id`      | string | **Yes**  | Model ID. See [Models](https://docs.async.com/models-2161359m0) for all available models and their capabilities.                                                                            |
| `voice`         | object | **Yes**  | Dictionary with keys `mode` and `id`.<br>Example: `{ "mode": "id", "id": "e0f39dc4-f691-4e78-bba5-5c636692cc04" }` |
| `output_format` | object | No       | Audio output settings<br>(default): `{ "container": "raw", "encoding": "pcm_s16le", "sample_rate": 44100 }`.         |
| `language`      | string | No  |   Force to synthesize speech in the specified language.                  |

> 💡 See [Text-to-Speech (Stream)](https://docs.async.com/text-to-speech-stream-16699696e0) for detailed parameter descriptions.

---

### 2. `initializeContext` *(optional, for Multi-Context mode)*

This message **creates or re-initializes a specific audio generation context** within the same WebSocket connection.
If `context_id` is not provided, the **default context** is used.

| Property     | Type   | Required | Description                                                                   |
| ------------ | ------ | -------- | ----------------------------------------------------------------------------- |
| `context_id` | string | No       | Unique uuid identifier for the context. If omitted, default context is used.       |
| `transcript` | string | **Yes**  | The initial text input for this context. **Always ends with a single space.** |

---

### 3. `sendText` *(required)*

| Property     | Type    | Required | Description                                                               |
| ------------ | ------- | -------- | ------------------------------------------------------------------------- |
| `context_id` | string  | No       | Target context for this text chunk. If omitted, default context is used.              |
| `transcript` | string  | **Yes**  | The new text chunk — **always ends with a single space.**                 |
| `force`      | boolean | No       | Force immediate synthesis even if the buffer is small (default: `false`). |

---

### 4. `closeContext` *(optional)*

Use this message to **close a single context** and complete its audio generation while keeping the connection alive.

| Property        | Type    | Required | Description                     |
| --------------- | ------- | -------- | ------------------------------- |
| `context_id`    | string  | **Yes**  | Context to close.               |
| `close_context` | boolean | **Yes**  | Always `true`.                  |
| `transcript`    | string  | **Yes**  | Must be an empty string (`""`). |

---

### 5. `closeConnection` *(optional)*

Closes **all active contexts** and terminates the entire WebSocket connection gracefully.

| Property | Type   | Required | Description                 |
|----------|--------|----------|-----------------------------|
| `text`   | string | **Yes**  | **Empty string** to close connection. |

Alternatively, you can send a **terminate** message to close the entire WebSocket connection gracefully.

| Property | Type   | Required | Description                 |
|----------|--------|----------|-----------------------------|
| `terminate`   | boolean | **Yes**  | Always `true` |
---

## Receive

### `audioOutput` *(streamed)*

| Field        | Type    | Required | Description                                                            |
| ------------ | ------- | -------- | ---------------------------------------------------------------------- |
| `context_id` | string  | **Yes**  | ID of the context this audio chunk belongs to.                         |
| `audio`      | string  | **Yes**  | Base-64 encoded audio data.                                            |
| `final`      | boolean | **Yes**  | `true` if this is the final chunk for this context; otherwise `false`. |

---

### `finalOutput`

| Field        | Type    | Required | Description                                                    |
| ------------ | ------- | -------- | -------------------------------------------------------------- |
| `context_id` | string  | **Yes**  | ID of the completed context.                                   |
| `audio`      | string  | **Yes**  | Always an empty string `""`.                                   |
| `final`      | boolean | **Yes**  | Always `true`. Marks completion of synthesis for this context. |

---

### `error` *(optional)*

| Field        | Type   | Required | Description                 |
| ------------ | ------ | -------- | --------------------------- |
| `error_code` | string | **Yes**  | Error type identifier.      |
| `message`    | string | **Yes**  | Human-readable explanation. |
| `extra`      | object | No       | Additional error details.   |

---

## Example Message Flow

<details>
<summary><strong>Handshake</strong> — GET <code>/text_to_speech/websocket/ws</code></summary>

```http
GET /text_to_speech/websocket/ws
Host: api.async.com
Upgrade: websocket
Connection: Upgrade
api_key: <YOUR_API_KEY>
version: v1
```

</details>
<details>
<summary><strong>↑ (send) initializeConnection</strong> — <code>{"model_id": "async_flash_v1.0",...</code></summary>

```json
{
  "model_id": "async_flash_v1.0",
  "voice": {
    "mode": "id",
    "id": "e0f39dc4-f691-4e78-bba5-5c636692cc04"
  },
  "output_format": {
    "container": "raw",
    "encoding": "pcm_f32le",
    "sample_rate": 44100
  }
}
```
</details>
<details>
<summary><strong>↑ (send) Initialize multiple contexts
</strong> — <code>{"context_id": "e1bb2844-fed4-418b-832c-8126db5a21e9",...</code></summary>



```json
{
  "context_id": "e1bb2844-fed4-418b-832c-8126db5a21e9",
  "transcript": "Welcome to Async. "
}
```

```json
{
  "context_id": "9f6bb19c-4616-4fbc-9d0f-f14a460eac01",
  "transcript": "This is a parallel narration. "
}
```
</details>

<details>
<summary><strong>↑ (send) sendText</strong> — <code>{"context_id":"e1bb2844-fed4-418b-832c-8126db5a21e9",...}</code></summary>

```json
{ "context_id": "e1bb2844-fed4-418b-832c-8126db5a21e9", "transcript": "Let's continue with our main topic. " }
```
</details>

<details>
<summary><strong>↓ (receive) audioOutput</strong> — <code>{"context_id":"e1bb2844-fed4-418b-832c-8126db5a21e9",...}</code></summary>

```json
{
  "context_id": "e1bb2844-fed4-418b-832c-8126db5a21e9",
  "audio": "Y3VyaW91cyBtaW5kcyB0aGluayBhbGlrZSA6KQ==",
  "final": false
}
```
</details>

<details>
<summary><strong>↓ (receive) finalOutput</strong> — <code>{"context_id":"e1bb2844-fed4-418b-832c-8126db5a21e9",...}</code></summary>

```json
{
  "context_id": "e1bb2844-fed4-418b-832c-8126db5a21e9",
  "audio": "",
  "final": true
}
```
</details>

<details>
<summary><strong>↑ (send) closeContext</strong> — <code>{"context_id":"9f6bb19c-4616-4fbc-9d0f-f14a460eac01",...}</code></summary>



```json
{
  "context_id": "9f6bb19c-4616-4fbc-9d0f-f14a460eac01",
  "close_context": true,
  "transcript": ""
}
```
</details>

<details>
<summary><strong>↑ (send) closeConnection</strong> — <code>{ "terminate": true }</code></summary>


```json
{ "terminate": true }
```
</details>


## Multi-Context Overview

The **Multi-Context WebSocket API** is designed to manage multiple independent audio generation streams (*contexts*) over a single WebSocket connection.
This is especially useful for scenarios that require **concurrent or interleaved audio generations**, such as dynamic conversational AI applications.

Each context — identified by its own `context_id` — maintains an independent state.
You can send text to specific contexts, flush them, or close them independently.
A `terminate` message can be used to gracefully close the entire WebSocket connection.

### Key advantages:

* Multiple parallel audio streams within a single socket
* Lower connection overhead and faster interleaving
* Independent buffering and finalization per context


## Path
wss://api.async.com/text_to_speech/websocket/ws

