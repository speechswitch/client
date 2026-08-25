import type { HttpClientModel, WebSocketClientModel } from "./model.ts";

function identifier(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const result = words.map((word, index) => index
    ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
    : `${word[0]?.toLowerCase() ?? ""}${word.slice(1)}`).join("");
  const safe = result || "operation";
  return /^\d/.test(safe) ? `operation${safe}` : safe;
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

export function renderHttpClient(model: HttpClientModel): string {
  const operations = [...model.operations].sort((left, right) => left.name.localeCompare(right.name));
  const lines = [
    "// Generated file. Do not edit.",
    'import { request, requestBytes, streamBytes } from "../../sdk/http.ts";',
    'import type { HttpOptions, HttpRequest } from "../../sdk/http.ts";',
    "",
    `export const baseUrl = ${literal(model.baseUrl)};`,
    "export type ClientOptions = HttpOptions;",
    "",
  ];
  for (const operation of operations) {
    const name = identifier(operation.name);
    const input = operation.inputType;
    const output = operation.outputType;
    const execute = operation.responseKind === "bytes"
      ? "requestBytes"
      : operation.responseKind === "byte-stream"
        ? "streamBytes"
        : `request<${output}>`;
    lines.push(
      `export function ${name}(options: ClientOptions, input: Omit<HttpRequest, \"method\" | \"path\" | \"contentType\" | \"security\" | \"body\"> & { readonly body: ${input} }) {`,
      `  return ${execute}(options, {`,
      "    ...input,",
      `    method: ${literal(operation.method.toUpperCase())},`,
      `    path: ${literal(operation.path)},`,
      `    contentType: ${literal(operation.contentType)},`,
      `    security: ${literal(operation.security)},`,
      "  });",
      "}",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderWebSocketClient(model: WebSocketClientModel): string {
  return [
    "// Generated file. Do not edit.",
    'import { connectWebSocket } from "../../sdk/websocket.ts";',
    'import type { WebSocketOptions } from "../../sdk/websocket.ts";',
    "",
    `export const url = ${literal(model.url)};`,
    `export type Parameters = ${model.parametersType};`,
    `export type ClientMessage = ${model.clientMessageType};`,
    `export type ServerMessage = ${model.serverMessageType};`,
    "export type ClientOptions = WebSocketOptions<ClientMessage, ServerMessage>;",
    "",
    "export function connect(options: ClientOptions) {",
    "  return connectWebSocket(options);",
    "}",
    "",
  ].join("\n");
}
