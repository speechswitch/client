import { describe, expect, test } from "bun:test";
import { request, requestBytes, streamBytes } from "./http.ts";

describe("HTTP transport", () => {
  test("decodes JSON but leaves binary responses as bytes", async () => {
    const json = await request<{ ok: boolean }>({
      baseUrl: "https://example.invalid",
      fetch: async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
      headers: {},
      auth: {},
    }, {
      method: "GET",
      path: "/json",
      pathParameters: {},
      query: {},
      headers: {},
      body: undefined,
      contentType: null,
      security: [],
      signal: null,
    });
    expect(json.data).toEqual({ ok: true });

    const binary = await requestBytes({
      baseUrl: "https://example.invalid",
      fetch: async () => new Response(Uint8Array.of(0, 127, 255)),
      headers: {},
      auth: {},
    }, {
      method: "GET",
      path: "/audio",
      pathParameters: {},
      query: {},
      headers: {},
      body: undefined,
      contentType: null,
      security: [],
      signal: null,
    });
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
      headers: {},
      auth: {},
    }, {
      method: "GET",
      path: "/stream",
      pathParameters: {},
      query: {},
      headers: {},
      body: undefined,
      contentType: null,
      security: [],
      signal: null,
    });
    expect(await Array.fromAsync(stream.bytes)).toEqual([Uint8Array.of(1), Uint8Array.of(2, 3)]);
  });

  test("applies named security without coupling it to an integration", async () => {
    const captured: { authorization?: string | null } = {};
    await request({
      baseUrl: "https://example.invalid",
      auth: { token: "secret" },
      headers: {},
      fetch: async (_url, init) => {
        captured.authorization = new Headers(init?.headers).get("authorization");
        return Response.json({});
      },
    }, {
      method: "GET",
      path: "/secure",
      pathParameters: {},
      query: {},
      headers: {},
      body: undefined,
      contentType: null,
      security: [{ kind: "bearer", name: "token" }],
      signal: null,
    });
    expect(captured.authorization).toBe("Bearer secret");
  });
});
