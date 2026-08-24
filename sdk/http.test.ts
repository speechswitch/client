import { describe, expect, test } from "bun:test";
import { request, requestBytes, streamBytes } from "./http.ts";

describe("HTTP transport", () => {
  test("decodes JSON but leaves binary responses as bytes", async () => {
    const json = await request<{ ok: boolean }>({
      baseUrl: "https://example.invalid",
      fetch: async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    }, { method: "GET", path: "/json" });
    expect(json.data).toEqual({ ok: true });

    const binary = await requestBytes({
      baseUrl: "https://example.invalid",
      fetch: async () => new Response(Uint8Array.of(0, 127, 255)),
    }, { method: "GET", path: "/audio" });
    expect(binary.data).toEqual(Uint8Array.of(0, 127, 255));
  });

  test("exposes response chunks without buffering", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1));
        controller.enqueue(Uint8Array.of(2, 3));
        controller.close();
      },
    });
    const stream = await streamBytes({
      baseUrl: "https://example.invalid",
      fetch: async () => new Response(body),
    }, { method: "GET", path: "/stream" });
    expect(await Array.fromAsync(stream.bytes)).toEqual([Uint8Array.of(1), Uint8Array.of(2, 3)]);
  });

  test("applies named security without coupling it to an integration", async () => {
    const captured: { authorization?: string | null } = {};
    await request({
      baseUrl: "https://example.invalid",
      auth: { token: "secret" },
      fetch: async (_url, init) => {
        captured.authorization = new Headers(init?.headers).get("authorization");
        return Response.json({});
      },
    }, {
      method: "GET",
      path: "/secure",
      security: [{ kind: "bearer", name: "token" }],
    });
    expect(captured.authorization).toBe("Bearer secret");
  });
});
