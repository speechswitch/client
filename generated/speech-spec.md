# Normalized speech API

Provider-neutral TTS request fields.

## TTS request

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `string | AsyncIterable<string> | undefined` (optional).
