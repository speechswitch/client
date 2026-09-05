> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Synthesize speech (WebSocket)

> Generate audio from text input while managing multiple independent audio generation streams over a single WebSocket connection.
> 
> The independent audio streams each correspond to a *context*, identified by `contextId`, that maintains its own state. To use the API:
> - Create a context with audio generation configurations. By default, we allow up to 20 concurrent connections, with a maximum of 5 contexts per connection. 
> - When you send text to be synthesized into audio, you can send it to a specific context (optional if there is only 1 context).
> - Each context maintains its own buffer that can be flushed either manually or automatically when the buffer reaches a certain threshold (see `maxBufferDelayMs` and `bufferCharThreshold` in the context configurations).
> - If texts are sent in full sentences phrases, it's recommended to use `auto_mode` which would automatically balance latency and quality of the generations.
> - Responses contain the `contextId` so you can match the audio to the request.
> - Close a context when it is no longer needed.

