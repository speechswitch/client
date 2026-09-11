# @speechswitch/router

A provider-neutral, strongly typed TypeScript router for low-latency speech
synthesis, streaming audio, and timestamps.

```sh
bun install
bun run check
```

Specification generation requires Node.js 22.18 or newer. The SDK and its tests
continue to use Bun normally.

The project pins TypeScript 7 locally. Editors should use the TypeScript language
server and compiler from this workspace's `node_modules`.

`schemas/` is a dedicated TypeScript project containing only API declarations.
`schemas/base.ts` defines the normalized `TtsRequest`; each provider defines its
plain `TtsRequest` subset in `schemas/providers/<provider>/index.ts`. The build-time
extractor validates provider narrowing and generates code and documentation. Run
`bun run generate:spec` after changing the API.

```ts
export type TtsRequest = {
  readonly text: string;
};
```

Ordinary JSDoc supplies generated field documentation. Use `@minimum`,
`@maximum`, and `@pattern` only for runtime constraints that TypeScript cannot
express; provider annotations may narrow but never widen their base constraint.

Use `@serializeAs <contract> <field>` on provider fields for mechanical wire-name
mapping. Contract names identify shapes such as `rest`, `streaming`, or `v3`:

```ts
/** @serializeAs rest voice_id
 *  @serializeAs streaming voice
 */
readonly voice?: string;
```

`bun run generate:spec` emits `toRest`, `toStreaming`, etc. in
`sdk/generated/serializers/<provider>.ts`. Only fields annotated for that contract
are emitted, including inside nested objects; unchanged names also need an
annotation. Optional values of `undefined` are omitted. Arrays and record values
are mapped recursively, while record keys are preserved. Union variants must
agree on a field's mapping; conflicting mappings and duplicate destination names
fail generation. The adapter adds unmapped fields, defaults, value conversions,
and streaming input explicitly, then checks the complete input against its wire
type. Serializers do not validate requests or consume iterators.

Provider wire clients are generated from the hashed raw definitions cataloged in
`schemas/sources.yaml`. Run `bun run generate:clients` after updating a source.

Amazon Polly uses `auth.aws` when provided, then `SPEECHSWITCH_AWS_*`, then the
standard `AWS_*` environment variables. Synthesis always returns an audio stream:

```ts
for await (const chunk of synthesize("amazon", {
  text: "Hello",
  voice: "Joanna",
  output: { codec: "mp3" },
})) {
  // chunk is Uint8Array
}
```

Polly's generative engine also accepts incremental input through the same method:

```ts
for await (const chunk of synthesize("amazon", {
  text: incomingText,
  voice: "Joanna",
  model: "generative",
  output: { codec: "mp3" },
})) {
  // consume audio while incomingText is still producing text
}
```

Here `incomingText` is an `AsyncIterable<string>`. The adapter uses Polly's
bidirectional HTTP/2 stream and yields audio while input is still arriving.

Audio output separates the encoding from its wrapper:

```ts
{ codec: "mp3" } // Provider-native MP3 framing.
{ container: "ogg", codec: "opus" }
{ container: "raw", codec: "pcm", sampleFormat: "int16", sampleRateHz: 16000 }
{ container: "wav", codec: "pcm", sampleFormat: "int16", sampleRateHz: 24000 }
```

`container` is omitted when the provider fixes the codec's native framing.
`sampleFormat` describes PCM samples, not compressed codecs. Provider request
unions and generated validators enforce supported combinations. This replaces
`output.format`; for example, `ogg_opus` becomes `container: "ogg", codec: "opus"`.
