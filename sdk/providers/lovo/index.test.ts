import { describe, expect, expectTypeOf, test } from "bun:test";
import type { Fetch } from "../../runtime/fetch.ts";
import { synthesize as amazonSynthesize } from "../amazon/index.ts";
import { synthesize, voices } from "./index.ts";

const auth = { lovo: { apiKey: "test-key" } } as const;

function output(url: string) {
  return {
    status: "succeeded",
    text: "hello",
    speaker: "speaker",
    speakerStyle: "style",
    speed: 1,
    pause: [],
    emphasis: [],
    pronunciations: [],
    urls: [url],
  } as const;
}

function job(status: "in_progress" | "done", data: readonly ReturnType<typeof output>[] = []) {
  return {
    id: "job-id",
    type: "tts",
    status,
    progress: status === "done" ? 100 : 50,
    team: "team",
    createdAt: "2026-01-01T00:00:00Z",
    data,
  } as const;
}

describe("LOVO", () => {
  test("keeps input non-streaming without widening Amazon", () => {
    expectTypeOf<Parameters<typeof synthesize>[0]["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof amazonSynthesize>[0]["text"]>().toEqualTypeOf<
      string | AsyncIterable<string>
    >();
  });

  test("polls a slow synchronous job and streams its signed audio URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: Fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (calls.length === 1) return Response.json(job("in_progress"), { status: 201 });
      if (calls.length === 2) return Response.json(job("done", [output("https://audio.example/result.mp3")]));
      return new Response(Uint8Array.of(1, 2, 3));
    };
    expect(await Array.fromAsync(synthesize({
      text: "hello",
      voice: "speaker",
      voiceVariant: "style",
      speed: 1.25,
    }, { auth, fetch, pollIntervalMs: 0 }))).toEqual([Uint8Array.of(1, 2, 3)]);
    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.genny.lovo.ai/api/v1/tts/sync",
      "https://api.genny.lovo.ai/api/v1/tts/job-id",
      "https://audio.example/result.mp3",
    ]);
    expect(new Headers(calls[0]?.init?.headers).get("x-api-key")).toBe("test-key");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      text: "hello",
      speaker: "speaker",
      speakerStyle: "style",
      speed: 1.25,
    });
    expect(new Headers(calls[2]?.init?.headers).has("x-api-key")).toBe(false);
  });

  test("lists speakers using the documented query serialization", async () => {
    let url = "";
    const fetch: Fetch = async (input) => {
      url = String(input);
      return Response.json({ totalCount: 0, count: 0, data: [] });
    };
    expect(await voices({ auth, fetch, sort: ["displayName:1", "gender:-1"], page: 2, limit: 10 }))
      .toEqual({ totalCount: 0, count: 0, data: [] });
    expect(url).toBe("https://api.genny.lovo.ai/api/v1/speakers?sort=displayName%3A1&sort=gender%3A-1&page=2&limit=10");
  });
});
