import { expect, test } from "bun:test";
import { extractElevenLabsAsyncApi } from "./elevenlabs-client.ts";

test("extracts a UTF-8 byte-counted AsyncAPI Flight record across chunks", () => {
  const endpoint = "/v1/text-to-speech/{voice_id}/stream-input";
  const record = `# WebSocket\n\nGET ${endpoint}\nélan\n\n\`\`\`yaml\nasyncapi: 2.6.0\n\`\`\``;
  const length = new TextEncoder().encode(record).length.toString(16);
  const html = [
    `<script>self.__next_f.push(${JSON.stringify([1, `a:T${length},`])})</script>`,
    `<script>self.__next_f.push(${JSON.stringify([1, record])})</script>`,
  ].join("");
  expect(extractElevenLabsAsyncApi(html, endpoint)).toBe("asyncapi: 2.6.0");
});
