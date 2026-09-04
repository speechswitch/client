import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { embeddedOpenApi, voiceAiContract } from "./voice-ai-contract.ts";
test("validates the current Voice.ai HTTP contract without generating from the legacy partial schema", async () => { const [legacy, markdown, docs] = await Promise.all([readFile("schemas/sources/voice.ai/00-openapi.json", "utf8"), readFile("schemas/sources/voice.ai/02-speech.md", "utf8"), readFile("schemas/sources/voice.ai/01-llms-txt.txt", "utf8")]); const contract = voiceAiContract(JSON.parse(legacy), YAML.parse(embeddedOpenApi(markdown)), docs); expect(contract.server).toBe("https://dev.voice.ai"); expect(contract.models).toHaveLength(4); expect(contract.formats).toContain("ulaw_8000"); });
