import { describe, expectTypeOf, test } from "bun:test";
import type { SynthesisEnvelope, Timestamp } from "./timestamps.ts";

describe("timestamp envelopes", () => {
  test("chunk correlation requires audio", () => {
    type Mark = Timestamp<"word">;
    type Chunk = Extract<SynthesisEnvelope<Mark>, { correlation: "chunk" }>;
    expectTypeOf<Chunk["audio"]>().toEqualTypeOf<Uint8Array>();
  });

  test("timeline audio remains optional", () => {
    type Timeline = Extract<SynthesisEnvelope, { correlation: "timeline" | "ordered" }>;
    expectTypeOf<Timeline["audio"]>().toEqualTypeOf<Uint8Array | undefined>();
  });
});
