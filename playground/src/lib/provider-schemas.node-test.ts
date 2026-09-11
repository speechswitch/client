import { expect } from "expect";
import path from "node:path";
import { describe, test } from "node:test";

import { extractRepositorySpeechSpec } from "../../../codegen/repository-spec.ts";
import type { PropertySchema, TypeSchema } from "./provider-schema.ts";
import { providerSchemasFromSpeechSpec } from "./provider-schemas.ts";
import {
  initialValue,
  materialize,
  selectDiscriminatedVariant,
  streamingTextSegments,
} from "./provider-request.ts";

function property(schema: TypeSchema, name: string): PropertySchema {
  if (schema.kind !== "object") throw new TypeError("Expected object schema");
  const result = schema.properties.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Missing property ${name}`);
  return result;
}

const speechSpec = extractRepositorySpeechSpec(path.resolve(import.meta.dirname, "../../.."));
const providers = providerSchemasFromSpeechSpec(speechSpec);
const amazon = providers.find(({ id }) => id === "amazon")!;
const output = property(amazon.request, "output").schema;
const fixture = providerSchemasFromSpeechSpec({
  tts: {
    ...speechSpec.tts,
    providers: [
      {
        id: "fixture",
        request: {
          kind: "object",
          fields: [
            {
              name: "language",
              optional: true,
              documentation: "Language",
              typeScriptType: '"auto" | "fr"',
              default: "auto",
              type: {
                kind: "union",
                anyOf: [
                  { kind: "literal", value: "auto" },
                  { kind: "literal", value: "fr" },
                ],
              },
            },
            {
              name: "text",
              optional: false,
              documentation: "Text",
              typeScriptType: "string",
              type: { kind: "string" },
            },
            {
              name: "replacements",
              optional: true,
              documentation: "Replacements",
              typeScriptType: "Readonly<Record<string, string>>",
              type: { kind: "record", items: { kind: "string" } },
            },
          ],
        },
      },
    ],
  },
})[0]!;

describe("provider schemas", () => {
  test("initializes default metadata, including older saved requests, without overriding explicit values", () => {
    expect(property(fixture.request, "language").default).toBe("auto");
    expect(initialValue(fixture.request)).toStrictEqual({ language: "auto", text: "" });
    expect(materialize(fixture.request, { text: "hello" }, false)).toStrictEqual({
      language: "auto",
      text: "hello",
    });
    expect(materialize(fixture.request, { text: "hello", language: "fr" }, false)).toStrictEqual({
      language: "fr",
      text: "hello",
    });
    expect(property(amazon.request, "language").default).toBeUndefined();
  });

  test("materializes maps and identifies invalid values", () => {
    expect(() =>
      materialize(
        fixture.request,
        {
          text: "hello",
          replacements: { x: false },
        },
        false,
      ),
    ).toThrow(
      new TypeError('request.replacements["x"]: Expected a string', {
        cause: new TypeError("Expected a string"),
      }),
    );
    expect(
      materialize(
        fixture.request,
        {
          text: "hello",
          replacements: '{"Acme Mobile":"Acme Mobull"}',
        },
        false,
      ),
    ).toStrictEqual({
      language: "auto",
      text: "hello",
      replacements: { "Acme Mobile": "Acme Mobull" },
    });
  });

  test("uses the normalized provider request produced by specgen", () => {
    expect(property(amazon.request, "text").schema.kind).toBe("string");
    expect(output.kind).toBe("discriminatedUnion");
    if (output.kind !== "discriminatedUnion") throw new TypeError("Expected discriminated union");
    expect(property(amazon.streamingText!.request, "model").schema).toStrictEqual({
      kind: "enum",
      values: ["generative"],
    });
    expect(property(amazon.request, "voice").description).toBe("Provider voice identifier.");
  });

  test("preserves codec-specific sample rates from discriminated output unions", () => {
    expect(output.kind).toBe("discriminatedUnion");
    if (output.kind !== "discriminatedUnion") throw new TypeError("Expected discriminated union");
    expect(output.discriminator).toBe("codec");
    expect(
      output.variants.map(({ values, schema }) => {
        const sampleRate = property(schema, "sampleRateHz").schema;
        return {
          codecs: values,
          sampleRates: sampleRate.kind === "enum" ? sampleRate.values : [],
        };
      }),
    ).toStrictEqual([
      { codecs: ["mp3"], sampleRates: [8000, 16000, 22050, 24000, 44100, 48000] },
      { codecs: ["vorbis"], sampleRates: [8000, 16000, 22050, 24000, 44100, 48000] },
      { codecs: ["pcm"], sampleRates: [8000, 16000] },
      { codecs: ["opus"], sampleRates: [48000] },
      { codecs: ["alaw", "mulaw"], sampleRates: [8000] },
    ]);
  });

  test("initializes and validates the selected output branch", () => {
    expect(initialValue(output)).toStrictEqual({ codec: "mp3" });
    expect(
      materialize(output, { container: "raw", codec: "pcm", sampleRateHz: 16000 }, false),
    ).toStrictEqual({
      container: "raw",
      codec: "pcm",
      sampleRateHz: 16000,
    });
    expect(() =>
      materialize(output, { container: "raw", codec: "pcm", sampleRateHz: 44100 }, false),
    ).toThrow(/Expected one of 8000, 16000/);
  });

  test("drops only values invalidated by a discriminator change", () => {
    expect(output.kind).toBe("discriminatedUnion");
    if (output.kind !== "discriminatedUnion") throw new TypeError("Expected discriminated union");
    expect(
      selectDiscriminatedVariant(output, { codec: "mp3", sampleRateHz: 44100 }, "pcm"),
    ).toStrictEqual({
      container: "raw",
      codec: "pcm",
    });
    expect(
      selectDiscriminatedVariant(output, { codec: "mp3", sampleRateHz: 16000 }, "pcm"),
    ).toStrictEqual({
      container: "raw",
      codec: "pcm",
      sampleRateHz: 16000,
    });
  });

  test("normalizes delayed streaming segments without breaking plain-string history", () => {
    expect(streamingTextSegments(["hello ", { text: "world", delayMs: 250 }])).toStrictEqual([
      { text: "hello " },
      { text: "world", delayMs: 250 },
    ]);
    expect(() => streamingTextSegments([{ text: "hello", delayMs: -1 }])).toThrow(
      /Streaming text segment 1 delayMs must be a non-negative integer/,
    );
  });
});
