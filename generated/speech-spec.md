# Normalized speech API

The normalized TTS vocabulary. It begins with the universal input and grows
only when an integration establishes another shared concept.

## TTS request

### `text`

Text to synthesize, supplied whole or incrementally when the provider supports streaming input.

Type: `StreamingText | undefined` (optional).
