import { describe, expect, test } from "bun:test";
import { renderHttpClient, renderWebSocketClient } from "./render.ts";

describe("client rendering", () => {
  test("renders byte-native HTTP operations deterministically", () => {
    const model = {
      baseUrl: "https://example.invalid/v1",
      operations: [
        { name: "stream audio", method: "post", path: "/audio", responseKind: "byte-stream" as const },
        { name: "get audio", method: "post", path: "/audio", responseKind: "bytes" as const },
      ],
    };
    const rendered = renderHttpClient(model);
    expect(rendered).toContain("return requestBytes(");
    expect(rendered).toContain("return streamBytes(");
    expect(rendered.indexOf("getAudio")).toBeLessThan(rendered.indexOf("streamAudio"));
    expect(renderHttpClient(model)).toBe(rendered);
  });

  test("renders a typed WebSocket connection", () => {
    const rendered = renderWebSocketClient({
      url: "wss://example.invalid/stream/{session}",
      parametersType: "{ readonly session: string }",
      clientMessageType: "{ readonly text: string }",
      serverMessageType: "{ readonly audio: ArrayBuffer }",
    });
    expect(rendered).toContain("connectWebSocket<ClientMessage, ServerMessage, Parameters>");
  });
});
