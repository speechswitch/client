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
import type { InworldTimestamp, InworldEnvelope, synthesize as inworld } from "./providers/inworld/index.ts";
import type { SynthesisItem as CanonicalInworldItem } from "../schemas/providers/inworld/index.ts";
import type { synthesize as kugelaudio } from "./providers/kugelaudio/index.ts";
import type { SynthesisItem as CanonicalKugelAudioItem } from "../schemas/providers/kugelaudio/index.ts";
import type { synthesize as lovo } from "./providers/lovo/index.ts";
import type { SynthesisItem as CanonicalLovoItem } from "../schemas/providers/lovo/index.ts";
import type { synthesize as microsoft, MicrosoftEnvelope, MicrosoftDoneEvent, MicrosoftTimestamp } from "./providers/microsoft/index.ts";
import type { SynthesisItem as CanonicalMicrosoftItem } from "../schemas/providers/microsoft/index.ts";
import type { synthesize as minimax, MiniMaxEnvelope, MiniMaxDoneEvent, Usage } from "./providers/minimax/index.ts";
import type { SynthesisItem as CanonicalMiniMaxItem } from "../schemas/providers/minimax/index.ts";
import type { synthesize as murf } from "./providers/murf/index.ts";
import type { SynthesisItem as CanonicalMurfItem, MurfEnvelope } from "../schemas/providers/murf/index.ts";
import type { synthesize as openai, DoneEvent as OpenaiDoneEvent } from "./providers/openai/index.ts";
import type { SynthesisItem as CanonicalOpenaiItem, DoneEvent as CanonicalOpenaiDoneEvent } from "../schemas/providers/openai/index.ts";

test("canonical output schemas define the public provider output types", () => {
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
  expectTypeOf<ReturnType<typeof inworld>>().toEqualTypeOf<AsyncIterableIterator<CanonicalInworldItem>>();
  expectTypeOf<ReturnType<typeof kugelaudio>>().toEqualTypeOf<AsyncIterableIterator<CanonicalKugelAudioItem>>();
  expectTypeOf<ReturnType<typeof lovo>>().toEqualTypeOf<AsyncIterableIterator<CanonicalLovoItem>>();
  expectTypeOf<ReturnType<typeof microsoft>>().toEqualTypeOf<AsyncIterableIterator<CanonicalMicrosoftItem>>();
  expectTypeOf<ReturnType<typeof minimax>>().toEqualTypeOf<AsyncIterableIterator<CanonicalMiniMaxItem>>();
  expectTypeOf<ReturnType<typeof murf>>().toEqualTypeOf<AsyncIterableIterator<CanonicalMurfItem>>();
  expectTypeOf<ReturnType<typeof openai>>().toEqualTypeOf<AsyncIterableIterator<CanonicalOpenaiItem>>();
  expectTypeOf<OpenaiDoneEvent>().toEqualTypeOf<CanonicalOpenaiDoneEvent>();
  expectTypeOf<MurfEnvelope['correlation']>().toEqualTypeOf<"ordered" | "timeline">();
  expectTypeOf<MurfEnvelope['timestamps'][number]>().toEqualTypeOf<{ readonly kind: "word"; readonly value: string; readonly startTimeMs: number; readonly endTimeMs: number }>();
  expectTypeOf<CanonicalMiniMaxItem>().toEqualTypeOf<Uint8Array | MiniMaxEnvelope | ClearEvent | FlushEvent | MiniMaxDoneEvent>();
  expectTypeOf<MiniMaxEnvelope>().toEqualTypeOf<{ readonly correlation: "ordered" | "timeline"; readonly correlationId?: string; readonly inputGroupId?: string; readonly traceId?: string; readonly audio?: Uint8Array; readonly timestamps: readonly Timestamp<"word" | "sentence">[]; readonly sentenceBoundary?: "start" | "end"; readonly requestComplete?: boolean; readonly usage?: Usage }>();
  expectTypeOf<MiniMaxDoneEvent>().toEqualTypeOf<{ readonly event: "done"; readonly traceId?: string; readonly usage?: Usage }>();
  expectTypeOf<MicrosoftTimestamp>().toEqualTypeOf<{ readonly kind: "character" | "word" | "sentence" | "segment" | "phoneme" | "viseme" | "ssml"; readonly value: string; readonly startTimeMs: number; readonly endTimeMs?: number; readonly source?: { readonly start: number; readonly end: number }; readonly boundaryType?: string; readonly animationChunk?: string; readonly isLastAnimation?: boolean }>();
  expectTypeOf<MicrosoftEnvelope>().toEqualTypeOf<{ readonly correlation: "timeline"; readonly correlationId: string; readonly streamId?: string; readonly audio?: Uint8Array; readonly timestamps: readonly MicrosoftTimestamp[]; readonly durationMs?: number }>();
  expectTypeOf<MicrosoftDoneEvent>().toEqualTypeOf<{ readonly event: "done"; readonly requestId: string; readonly durationMs?: number }>();
  expectTypeOf<InworldTimestamp>().toEqualTypeOf<{
    readonly kind: "word" | "character" | "phoneme" | "viseme"; readonly value: string;
    readonly startTimeMs: number; readonly endTimeMs?: number;
    readonly source?: { readonly start: number; readonly end: number }; readonly wordIndex?: number;
  }>();
  expectTypeOf<InworldEnvelope>().toEqualTypeOf<
    { readonly correlation: "chunk"; readonly correlationId?: string; readonly audio: Uint8Array; readonly timestamps: readonly InworldTimestamp[] }
    | { readonly correlation: "timeline"; readonly correlationId?: string; readonly audio?: Uint8Array; readonly timestamps: readonly InworldTimestamp[] }
  >();
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
