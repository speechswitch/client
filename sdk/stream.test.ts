import { expectTypeOf, test } from "bun:test";
import type { AudioStream, AudioStreamItem, ClearEvent, DoneEvent, FlushEvent, TimestampStream, TimestampStreamItem, UpdatedEvent, BatchEvent } from "./index.ts";
import type { SynthesisEnvelope, SynthesisResult, Timestamp } from "./timestamps.ts";
import type { SynthesisEnvelope as CanonicalEnvelope, Timestamp as CanonicalTimestamp } from "../schemas/timestamps.ts";

test("canonical output schemas preserve the public TypeScript API exactly", () => {
  expectTypeOf<Timestamp<"word">>().toEqualTypeOf<CanonicalTimestamp<"word">>();
  expectTypeOf<SynthesisEnvelope<Timestamp<"character">>>().toEqualTypeOf<CanonicalEnvelope<CanonicalTimestamp<"character">>>();
  expectTypeOf<AudioStreamItem>().toEqualTypeOf<Uint8Array | SynthesisEnvelope | ClearEvent | DoneEvent | FlushEvent | UpdatedEvent | BatchEvent>();
  expectTypeOf<AudioStream>().toEqualTypeOf<AsyncIterable<AudioStreamItem>>();
  expectTypeOf<TimestampStream>().toEqualTypeOf<AsyncIterable<TimestampStreamItem>>();
  expectTypeOf<SynthesisResult>().toEqualTypeOf<{ readonly audio: Uint8Array; readonly timestamps: readonly Timestamp[] }>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "chunk" }>['audio']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "ordered" | "timeline" }>['audio']>().toEqualTypeOf<Uint8Array | undefined>();
});
