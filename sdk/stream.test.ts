import { expectTypeOf, test } from "bun:test";
import type { AudioStream, AudioStreamItem, ClearEvent, DoneEvent, FlushEvent, TimestampStream, TimestampStreamItem, UpdatedEvent, BatchEvent } from "./index.ts";
import type { SynthesisEnvelope, SynthesisResult, Timestamp } from "./timestamps.ts";
import type { SynthesisEnvelope as CanonicalEnvelope, Timestamp as CanonicalTimestamp } from "../schemas/timestamps.ts";
import type { SynthesisItem as ElevenLabsItem, synthesize as elevenlabs } from "./providers/elevenlabs/index.ts";
import type { SynthesisItem as CanonicalElevenLabsItem } from "../schemas/providers/elevenlabs/index.ts";

test("canonical output schemas preserve the public TypeScript API exactly", () => {
  expectTypeOf<Timestamp<"word">>().toEqualTypeOf<CanonicalTimestamp<"word">>();
  expectTypeOf<SynthesisEnvelope<Timestamp<"character">>>().toEqualTypeOf<CanonicalEnvelope<CanonicalTimestamp<"character">>>();
  expectTypeOf<AudioStreamItem>().toEqualTypeOf<Uint8Array | SynthesisEnvelope | ClearEvent | DoneEvent | FlushEvent | UpdatedEvent | BatchEvent>();
  expectTypeOf<AudioStream>().toEqualTypeOf<AsyncIterable<AudioStreamItem>>();
  expectTypeOf<TimestampStream>().toEqualTypeOf<AsyncIterable<TimestampStreamItem>>();
  expectTypeOf<SynthesisResult>().toEqualTypeOf<{ readonly audio: Uint8Array; readonly timestamps: readonly Timestamp[] }>();
  expectTypeOf<ElevenLabsItem>().toEqualTypeOf<CanonicalElevenLabsItem>();
  expectTypeOf<ReturnType<typeof elevenlabs>>().toEqualTypeOf<AsyncIterableIterator<CanonicalElevenLabsItem>>();
  expectTypeOf<Extract<ElevenLabsItem, { readonly correlation: "chunk" }>['timestamps'][number]>().toEqualTypeOf<{
    readonly kind: "character"; readonly value: string; readonly startTimeMs: number; readonly endTimeMs: number;
  }>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "chunk" }>['audio']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "ordered" | "timeline" }>['audio']>().toEqualTypeOf<Uint8Array | undefined>();
});
