import type { Equal } from "../test-support/types.ts";
import { describe, test } from "node:test";
import type { SynthesisEnvelope, Timestamp } from "./timestamps.ts";

describe("timestamp envelopes", () => {
  test("chunk correlation requires audio", () => {
    type Mark = Timestamp<"word">;
    type Chunk = Extract<SynthesisEnvelope<Mark>, { correlation: "chunk" }>;
    true satisfies Equal<Chunk["audio"], Uint8Array>;
  });

  test("timeline audio remains optional", () => {
    type Timeline = Extract<SynthesisEnvelope, { correlation: "timeline" | "ordered" }>;
    true satisfies Equal<Timeline["audio"], Uint8Array | undefined>;
  });
});
