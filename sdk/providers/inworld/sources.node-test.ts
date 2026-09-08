import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Inspection only: current docs embed UI parameter lists and response examples,
// not a complete wire schema. Never turn these objects into a generated client.
function flight(file: string): Record<string, any>[] {
  const html = readFileSync(new URL(`../../../schemas/sources/inworld/${file}`, import.meta.url), "utf8");
  const chunks = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)].map(match => JSON.parse(match[1]!))
    .filter(chunk => chunk[0] === 1).map(chunk => chunk[1]).join("");
  const bytes = Buffer.from(chunks); const objects: Record<string, any>[] = []; let offset = 0;
  const visit = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    if (!Array.isArray(value)) objects.push(value as Record<string, unknown>);
    for (const child of Object.values(value)) visit(child);
  };
  while (offset < bytes.length) {
    if (bytes[offset] === 10) { offset++; continue; }
    const colon = bytes.indexOf(58, offset); assert.notEqual(colon, -1);
    assert.equal(/^[\da-f]*$/.test(bytes.subarray(offset, colon).toString()), true);
    offset = colon + 1;
    if (bytes[offset] === 84) {
      const comma = bytes.indexOf(44, offset); assert.notEqual(comma, -1);
      const lengthText = bytes.subarray(offset + 1, comma).toString(); assert.equal(/^[\da-f]+$/.test(lengthText), true);
      const length = parseInt(lengthText, 16); assert.equal(Number.isSafeInteger(length), true);
      assert.equal(comma + 1 + length <= bytes.length, true); offset = comma + 1 + length;
    } else {
      const end = bytes.indexOf(10, offset); assert.notEqual(end, -1);
      // JSON, module import, and resource hint records; unknown/opaque records fail.
      visit(JSON.parse(bytes.subarray(offset, end).toString().replace(/^(?:I|HL)/, ""))); offset = end + 1;
    }
  }
  assert.notEqual(objects.length, 0); return objects;
}

test("Inworld streaming reference omits required model and voice fields; response bodies are examples, not schemas", () => {
  const objects = flight("05-stream-reference.html");
  const endpoint = objects.find(value => value.path === "/tts/v1/voice:stream" && value.bodyParams)!;
  assert.deepEqual(endpoint.bodyParams.map((field: { name: string }) => field.name), ["text", "timestampTransportStrategy"]);
  assert.deepEqual(endpoint.responses.map((response: object) => Object.keys(response).sort()), [
    ["body", "name", "status"], ["body", "name", "status"], ["body", "name", "status"],
  ]);
  assert.deepEqual(objects.filter(value => value.openapi !== undefined || value.$schema !== undefined), []);
});

test("Inworld synchronous and socket references use current routes, but do not codify model-specific restrictions", () => {
  const http = flight("04-http-reference.html").find(value => value.path === "/tts/v1/voice" && value.bodyParams)!;
  assert.equal(http.server, "https://api.inworld.ai");
  const field = http.bodyParams.find((value: { name: string }) => value.name === "modelId");
  assert.deepEqual({ type: field.type, enum: field.enum }, { type: "string", enum: "$undefined" });
  const channel = flight("06-websocket-reference.html").find(value => value.clientMessages)!;
  assert.equal(channel.address, "/tts/v1/voice:streamBidirectional");
  assert.deepEqual(channel.clientMessages.map((value: { name: string }) => value.name), ["CreateContext", "SendText", "flushContext", "CloseContext"]);
  assert.deepEqual(channel.serverMessages.map((value: { name: string }) => value.name), ["ContextCreated", "AudioChunk", "ContextClosed", "FlushCompleted"]);
  assert.equal(channel.clientMessages[3].description,
    "Close an existing context and release all of its resources. Sending a close context message is equivalent to sending a flush message right before, so all text in the buffer will be synthesized before the context is closed. Note that the session will automatically be closed after 10 minutes of inactivity across any context.");
});
