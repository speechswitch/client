import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fixtures from "../../../sdks/fixtures/resemble.json";
import { synthesize, type TtsRequest } from "./index.ts";

const auth = { resemble: { token: "fixture" } };
const completion = 'event: complete\ndata: [{"path":"/tmp/gradio/file with?#雪.wav"}]\n\n';
test("Resemble polyglot request fixtures retain exact deployed input order", async () => {
  for (const fixture of fixtures.requests) {
    const input = fixture.request;
    const request = { ...input, ...("referenceAudio" in input ? { referenceAudio: Uint8Array.from(input.referenceAudio!) } : {}) } as TtsRequest;
    const calls: string[] = [];
    const output = await Array.fromAsync(synthesize(request, { auth, fetch: async (input, init) => {
      const url = new URL(String(input)); expect(url.host).toBe(fixture.host); calls.push(url.pathname);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture");
      if (url.pathname.endsWith("/upload")) {
        const form = init?.body as FormData;
        // Bun detaches an empty File's metadata on get(); inspect actual wire bytes.
        const serialized = new Response(form); const boundary = serialized.headers.get("Content-Type")!.split("boundary=")[1]!;
        expect(new Uint8Array(await serialized.arrayBuffer())).toEqual(new Uint8Array(await new Blob([
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="reference.audio"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          Uint8Array.from(request.referenceAudio!), `\r\n--${boundary}--\r\n`,
        ]).arrayBuffer()));
        return Response.json(["/uploaded/reference"]);
      }
      if (url.pathname.endsWith("/info")) {
        const info = JSON.parse(readFileSync(new URL("../../../schemas/sources/resemble/02-gradio-schema.json", import.meta.url), "utf8"));
        info.named_endpoints["/generate"].parameters[1].parameter_default.path = "/current/cache/reference.wav";
        return Response.json(info);
      }
      if (init?.method === "POST") { expect(JSON.parse(init.body as string)).toEqual(fixture.wire); return Response.json({ event_id: "event/?#雪" }); }
      if (url.pathname.startsWith("/gradio_api/call/")) return new Response(completion, { headers: { "Content-Type": "text/event-stream" } });
      return new Response(Uint8Array.of(0, 255, 128));
    } }));
    expect(calls).toEqual([
      ...(request.referenceAudio !== undefined ? ["/gradio_api/upload"] : request.model === "chatterbox-turbo" ? ["/gradio_api/info"] : []),
      `/gradio_api/call/${fixture.api}`, `/gradio_api/call/${fixture.api}/event%2F%3F%23%E9%9B%AA`,
      "/gradio_api/file=%2Ftmp%2Fgradio%2Ffile%20with%3F%23%E9%9B%AA.wav",
    ]);
    expect(output).toEqual([Uint8Array.of(0, 255, 128), { event: "done", requestId: "event/?#雪" }]);
  }
});

test("Resemble polyglot queue fixtures at every byte split", async () => {
  for (const fixture of fixtures.streams) {
    const bytes = new TextEncoder().encode(fixture.body);
    for (let split = 0; split <= bytes.length; split++) {
      let calls = 0; const output: unknown[] = []; let error: string | null = null;
      try {
        for await (const item of synthesize({ text: "Hello" }, { auth, fetch: async () => {
          if (++calls === 1) return Response.json({ event_id: "event/?#雪" });
          if (calls === 2) return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close();
          } }), { headers: { "Content-Type": "text/event-stream" } });
          return new Response(Uint8Array.of(0, 255, 128));
        } })) output.push(item instanceof Uint8Array ? { audio: [...item] } : item);
      } catch (failure) { if (!(failure instanceof TypeError)) throw failure; error = failure.message; }
      expect({ output, error }).toEqual({ output: fixture.output, error: fixture.error });
      expect(calls).toBe(fixture.error === null ? 3 : 2);
    }
  }
});
