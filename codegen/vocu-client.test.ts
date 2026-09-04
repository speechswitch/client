import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { vocuContract } from "./vocu-client.ts";
test("selects Vocu direct and asynchronous TTS contracts", async () => { const [api, docs, html] = await Promise.all([readFile("schemas/sources/vocu/00-openapi.json", "utf8"), readFile("schemas/sources/vocu/01-llms-txt.txt", "utf8"), readFile("schemas/sources/vocu/02-structured-docs.html", "utf8")]); expect(vocuContract(JSON.parse(api), docs, html).server).toBe("https://v1.vocu.ai"); });
