import { expectTypeOf, test } from "bun:test";
import type { AudioStream, AudioStreamItem, ClearEvent, DoneEvent, FlushEvent, TimestampStream, TimestampStreamItem, UpdatedEvent, BatchEvent } from "./index.ts";
import type { SynthesisEnvelope, SynthesisResult, Timestamp } from "./timestamps.ts";
import type { SynthesisEnvelope as CanonicalEnvelope, Timestamp as CanonicalTimestamp } from "../schemas/timestamps.ts";
import type { SynthesisItem as ElevenLabsItem, synthesize as elevenlabs } from "./providers/elevenlabs/index.ts";
import type { SynthesisItem as CanonicalElevenLabsItem } from "../schemas/providers/elevenlabs/index.ts";
import type { SynthesisItem as GradiumItem, synthesize as gradium } from "./providers/gradium/index.ts";
import type { SynthesisItem as CanonicalGradiumItem, TimelineOutput as GradiumTimeline } from "../schemas/providers/gradium/index.ts";
import type { HumeEnvelope, synthesize as hume } from "./providers/hume/index.ts";
import type { SynthesisItem as CanonicalHumeItem } from "../schemas/providers/hume/index.ts";

test("canonical output schemas preserve the public TypeScript API exactly", () => {
  expectTypeOf<Timestamp<"word">>().toEqualTypeOf<CanonicalTimestamp<"word">>();
  expectTypeOf<SynthesisEnvelope<Timestamp<"character">>>().toEqualTypeOf<CanonicalEnvelope<CanonicalTimestamp<"character">>>();
  expectTypeOf<AudioStreamItem>().toEqualTypeOf<Uint8Array | SynthesisEnvelope | ClearEvent | DoneEvent | FlushEvent | UpdatedEvent | BatchEvent>();
  expectTypeOf<AudioStream>().toEqualTypeOf<AsyncIterable<AudioStreamItem>>();
  expectTypeOf<TimestampStream>().toEqualTypeOf<AsyncIterable<TimestampStreamItem>>();
  expectTypeOf<SynthesisResult>().toEqualTypeOf<{ readonly audio: Uint8Array; readonly timestamps: readonly Timestamp[] }>();
  expectTypeOf<ElevenLabsItem>().toEqualTypeOf<CanonicalElevenLabsItem>();
  expectTypeOf<ReturnType<typeof elevenlabs>>().toEqualTypeOf<AsyncIterableIterator<CanonicalElevenLabsItem>>();
  expectTypeOf<GradiumItem>().toEqualTypeOf<CanonicalGradiumItem>();
  expectTypeOf<ReturnType<typeof gradium>>().toEqualTypeOf<AsyncIterableIterator<CanonicalGradiumItem>>();
  expectTypeOf<GradiumTimeline['correlation']>().toEqualTypeOf<"timeline">();
  expectTypeOf<GradiumTimeline['audio']>().toEqualTypeOf<Uint8Array | undefined>();
  expectTypeOf<ReturnType<typeof hume>>().toEqualTypeOf<AsyncIterableIterator<CanonicalHumeItem>>();
  expectTypeOf<HumeEnvelope>().toEqualTypeOf<{
    readonly correlation: "timeline"; readonly correlationId: string;
    readonly generationId: string; readonly requestId: string; readonly audio?: Uint8Array;
    readonly inputGroupId?: string; readonly timestamps: readonly Timestamp<"word" | "phoneme">[];
    readonly chunkIndex?: number; readonly isLastChunk?: boolean;
  }>();
  expectTypeOf<Extract<ElevenLabsItem, { readonly correlation: "chunk" }>['timestamps'][number]>().toEqualTypeOf<{
    readonly kind: "character"; readonly value: string; readonly startTimeMs: number; readonly endTimeMs: number;
  }>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "chunk" }>['audio']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<Extract<SynthesisEnvelope, { readonly correlation: "ordered" | "timeline" }>['audio']>().toEqualTypeOf<Uint8Array | undefined>();
});
