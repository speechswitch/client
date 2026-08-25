import { describe, expect, test } from "bun:test";
import { renderZodSchemas } from "./spec-render.ts";
import type { SpeechSpec } from "./spec-model.ts";

describe("speech schema rendering", () => {
  test("applies inherited bounds to literal unions without relying on number-only Zod methods", () => {
    const spec: SpeechSpec = {
      tts: {
        request: { name: "TtsRequestBase", documentation: "TTS", fields: [] },
        providers: [{
          id: "fixture",
          models: [{
            id: "model",
            request: {
              kind: "object",
              fields: [{
                name: "sampleRateHz",
                optional: true,
                documentation: "Sample rate.",
                typeScriptType: "16000 | 24000 | undefined",
                type: {
                  kind: "union",
                  anyOf: [
                    { kind: "literal", value: 16000 },
                    { kind: "literal", value: 24000 },
                  ],
                },
                constraints: { minimum: 8000, maximum: 48000 },
              }],
            },
          }],
        }],
      },
    };
    const rendered = renderZodSchemas(spec);
    expect(rendered).toContain("value >= 8000");
    expect(rendered).toContain("value <= 48000");
    expect(rendered).not.toContain(".min(");
  });
});
