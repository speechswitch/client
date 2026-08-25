import { describe, expect, test } from "bun:test";
import { renderHttpClient, renderWebSocketClient } from "./render.ts";

describe("client rendering", () => {
  test("renders byte-native HTTP operations deterministically", () => {
    const model = {
      baseUrl: "https://example.invalid/v1",
      operations: [
        {
          name: "stream audio",
          method: "post",
          path: "/audio",
          inputType: "Uint8Array",
          outputType: "Uint8Array",
          contentType: "application/octet-stream",
          responseKind: "byte-stream" as const,
          security: [],
        },
        {
          name: "get audio",
          method: "post",
          path: "/audio",
          inputType: "Uint8Array",
          outputType: "Uint8Array",
          contentType: "application/octet-stream",
          responseKind: "bytes" as const,
          security: [],
        },
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
    expect(rendered).toContain("WebSocketOptions<ClientMessage, ServerMessage, Parameters>");
    expect(rendered).toContain("connect(options: ClientOptions)");
  });
});
