import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderGoogleDiscoveryPython } from "./google-discovery-python.ts";

const root = path.resolve(import.meta.dirname, "..");
const discovery = JSON.parse(readFileSync(path.join(root, "schemas/sources/google/00-discovery.json"), "utf8"));
discovery.rootUrl = "https://changed.invalid/";
discovery.resources.text.methods.synthesize.path = "v2/speech:render";
discovery.resources.voices.methods.list.path = "v2/catalog";
discovery.resources.voices.methods.list.httpMethod = "POST";
discovery.resources.voices.methods.list.parameters = {
  locale: { type: "string", location: "query", enum: ["en US", "ja JP"], required: true },
  enabled: { type: "boolean", location: "query" },
  limit: { type: "integer", location: "query" },
};
discovery.schemas.AudioConfig.properties.audioEncoding.enum.push("EXPERIMENTAL");
discovery.schemas.SynthesisInput.required = ["text"];
discovery.schemas.SynthesisInput.properties.experimental = { type: "object", properties: {
  enabled: { type: "boolean" }, labels: { type: "object", additionalProperties: { type: "string" } },
  items: { type: "array", items: { type: "object", properties: { counter: { $ref: "Counter" } }, required: ["counter"] } },
  metrics: { $ref: "MetricMap" },
}, required: ["enabled"] };
discovery.schemas.Counter = { type: "integer" };
discovery.schemas.MetricMap = { type: "object", additionalProperties: { type: "number" } };
discovery.schemas.SynthesizeSpeechResponse.properties = { payload: { type: "string" } };
discovery.schemas.SynthesizeSpeechResponse.required = ["payload"];

const temporary = mkdtempSync(path.join(tmpdir(), "google-discovery-python-"));
try {
  writeFileSync(path.join(temporary, "pyrightconfig.json"), JSON.stringify({ pythonVersion: "3.13", typeCheckingMode: "strict", extraPaths: [path.join(root, "sdks/python")], reportUnusedImport: false }));
  writeFileSync(path.join(temporary, "changed.py"), renderGoogleDiscoveryPython(discovery, "https://source.invalid/discovery"));
  writeFileSync(path.join(temporary, "valid.py"), `import asyncio
import json
from types import MappingProxyType
from changed import DEFAULT_BASE_URL, ListVoicesInput, SynthesisInput, synthesize_speech, list_voices, decode_synthesize_speech_response
from speechswitch.http import HttpRequest, HttpResponse
from typing import cast

class Body:
    def __init__(self) -> None:
        self.read = False
    def __aiter__(self):
        return self
    async def __anext__(self) -> bytes:
        self.read = True
        raise AssertionError("Generated client buffered response")
    async def aclose(self) -> None:
        pass

class Transport:
    def __init__(self) -> None:
        self.calls: list[HttpRequest] = []
        self.body = Body()
    async def send(self, request: HttpRequest) -> HttpResponse:
        self.calls.append(request)
        return HttpResponse(200, {}, self.body)

async def main() -> None:
    transport = Transport()
    value: SynthesisInput = {"text": "hello", "experimental": {"enabled": False, "labels": MappingProxyType({"key": "value"}), "items": ({"counter": 0},), "metrics": MappingProxyType({"pitch": 1.25})}}
    await synthesize_speech({"input": value, "audioConfig": {"audioEncoding": "EXPERIMENTAL"}}, base_url="https://proxy.invalid/g/?tenant=one", headers={"authorization": "Bearer test"}, transport=transport)
    await list_voices({"locale": "en US", "enabled": False, "limit": 0}, base_url="https://proxy.invalid/g/?tenant=one", headers={}, transport=transport)
    assert DEFAULT_BASE_URL == "https://changed.invalid/"
    assert [(call.method, call.url, dict(call.headers)) for call in transport.calls] == [
        ("POST", "https://proxy.invalid/g/v2/speech:render?tenant=one", {"authorization": "Bearer test", "content-type": "application/json"}),
        ("POST", "https://proxy.invalid/g/v2/catalog?tenant=one&enabled=false&limit=0&locale=en+US", {}),
    ]
    assert json.loads(transport.calls[0].body) == {"input": {"text": "hello", "experimental": {"enabled": False, "labels": {"key": "value"}, "items": [{"counter": 0}], "metrics": {"pitch": 1.25}}}, "audioConfig": {"audioEncoding": "EXPERIMENTAL"}}
    assert transport.calls[1].body == b""
    assert not transport.body.read
    assert decode_synthesize_speech_response(b'{"payload":"AP8="}') == {"payload": "AP8="}
    try:
        decode_synthesize_speech_response(b'{"audioContent":"AP8="}')
    except TypeError as error:
        assert str(error) == "Invalid Google synthesizeSpeech response"
    else:
        raise AssertionError("Missing new response field was accepted")
    invalids: list[object] = [{}, {"text": "hello", "experimental": {}}, {"text": "hello", "experimental": {"enabled": False, "items": [{"counter": True}]}}]
    for invalid in invalids:
        try:
            await synthesize_speech({"input": cast(SynthesisInput, invalid)}, base_url=DEFAULT_BASE_URL, headers={}, transport=transport)
        except TypeError as error:
            assert str(error) == "Invalid Google synthesizeSpeech input"
        else:
            raise AssertionError("Invalid new request shape was accepted")
    assert len(transport.calls) == 2
    invalid_queries: list[object] = [{}, {"locale": "bad"}, {"locale": "en US", "enabled": "false"}, {"locale": "en US", "limit": 0.5}]
    for invalid in invalid_queries:
        try:
            await list_voices(cast(ListVoicesInput, invalid), base_url=DEFAULT_BASE_URL, headers={}, transport=transport)
        except TypeError as error:
            assert str(error) == "Invalid Google listVoices input"
        else:
            raise AssertionError("Invalid query was accepted")
    assert len(transport.calls) == 2

asyncio.run(main())
`);
  writeFileSync(path.join(temporary, "invalid.py"), `from changed import SynthesisInput, ListVoicesInput, SynthesizeSpeechResponse
missing_text: SynthesisInput = {}
missing_enabled: SynthesisInput = {"text": "hello", "experimental": {}}
missing_locale: ListVoicesInput = {}
bad_counter: SynthesisInput = {"text": "hello", "experimental": {"enabled": False, "items": [{"counter": 0.5}]}}
missing_payload: SynthesizeSpeechResponse = {"audioContent": "AP8="}
`);
  const env = { ...process.env, PYTHONPATH: [path.join(root, "sdks/python"), temporary].join(path.delimiter) };
  const execute = spawnSync("python3", [path.join(temporary, "valid.py")], { env, encoding: "utf8" });
  assert.equal(execute.status, 0, execute.stdout + execute.stderr);
  const types = spawnSync("pyright", ["--project", temporary, path.join(temporary, "changed.py"), path.join(temporary, "valid.py")], { cwd: temporary, env, encoding: "utf8" });
  assert.equal(types.status, 0, types.stdout + types.stderr);
  const invalid = spawnSync("pyright", ["--outputjson", "--project", temporary, path.join(temporary, "invalid.py")], { cwd: temporary, env, encoding: "utf8" });
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.deepEqual(JSON.parse(invalid.stdout).generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
    [2, 3, 4, 5, 6].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Google Discovery mutations change executed Python HTTP operations, field validation, response decoding and exact compiler diagnostics.");
