import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSchemaTypes, extractSpeechSpec } from "./specgen.ts";
import { renderLanguageTypes } from "./language-types.ts";
import { renderPythonValidator } from "./python-validator.ts";
import { renderGoValidator } from "./go-validator.ts";
import { renderRustValidator } from "./rust-validator.ts";

const root = path.resolve(import.meta.dirname, "..");
const rust = path.join(root, "sdks/rust"); const go = path.join(root, "sdks/go"); const python = path.join(root, "sdks/python");
function run(command: string, args: string[], cwd: string, status = 0) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, status, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

run("cargo", ["build", "--offline", "--target-dir", path.join(rust, "target")], rust);
run("cargo", ["test", "--offline", "--target-dir", path.join(rust, "target")], rust);
run("node", ["codegen/check-rust-json.ts"], root);
// Shared fixtures live outside the Go module; always rerun their consumers.
run("go", ["test", "-count=1", "./..."], go);
run("pyright", [], python);
run("python3", ["-m", "compileall", "-q", "speechswitch"], python);
run("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], python);
run("node", ["codegen/check-camb-clients.ts"], root);
run("node", ["codegen/check-google-protobuf.ts"], root);
run("node", ["codegen/check-google-discovery.ts"], root);
run("node", ["codegen/check-python-validators.ts"], root);
run("node", ["codegen/check-go-validators.ts"], root);
run("node", ["codegen/check-rust-validators.ts"], root);

const rustErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/invalid.rs"], rust, 1);
assert.deepEqual(rustErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 4 }, { code: "E0308", line: 7 }, { code: "E0308", line: 10 }]);

const rustAsyncErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/async_.rs"], rust, 1);
assert.deepEqual(rustAsyncErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 3 }, { code: "E0308", line: 6 }, { code: "E0308", line: 9 }]);

const pyCambErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_camb.py"], python, 1).stdout);
assert.deepEqual(pyCambErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [{ severity: "error", rule: "reportAssignmentType", line: 5 }, { severity: "error", rule: "reportAssignmentType", line: 6 }, { severity: "error", rule: "reportAssignmentType", line: 7 }]);

const pyCartesiaErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_cartesia.py"], python, 1).stdout);
assert.deepEqual(pyCartesiaErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [6, 7, 8, 9].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyDeepgramErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_deepgram.py"], python, 1).stdout);
assert.deepEqual(pyDeepgramErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyElevenLabsErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_elevenlabs.py"], python, 1).stdout);
assert.deepEqual(pyElevenLabsErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9, 10].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyDeepdubErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_deepdub.py"], python, 1).stdout);
assert.deepEqual(pyDeepdubErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [3, 4, 5, 6].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyFishErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_fish.py"], python, 1).stdout);
assert.deepEqual(pyFishErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 9].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyGoogleProtoErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_google_protobuf.py"], python, 1).stdout);
assert.deepEqual(pyGoogleProtoErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [3, 4, 5, 6, 7].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyGoogleErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_google.py"], python, 1).stdout);
assert.deepEqual(pyGoogleErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8, 10, 11].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyGoogleRestErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_google_rest.py"], python, 1).stdout);
assert.deepEqual(pyGoogleRestErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [...[3, 4, 5, 6].map(line => ({ severity: "error", rule: "reportAssignmentType", line })), { severity: "error", rule: "reportTypedDictNotRequiredAccess", line: 8 }]);

const rustFishErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/fish.rs"], rust, 1);
assert.deepEqual(rustFishErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [2, 3, 4, 5].map(line => ({ code: "E0609", line })));

const goFishErrors = run("go", ["test", "./testdata/invalidfish"], go, 1);
assert.equal(goFishErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidfish
testdata/invalidfish/invalid.go:5:56: r.Speakers undefined (type *fish.TtsRequestS1TextVoice has no field or method Speakers)
testdata/invalidfish/invalid.go:6:56: r.LoudnessNormalization undefined (type *fish.TtsRequestS1TextVoice has no field or method LoudnessNormalization)
testdata/invalidfish/invalid.go:7:62: r.BitRateBps undefined (type *fish.TtsRequestS1TextOutputObject has no field or method BitRateBps)
testdata/invalidfish/invalid.go:8:65: r.TimestampGranularity undefined (type *fish.TtsRequestStreamingTextVoice has no field or method TimestampGranularity)
`);

const goElevenLabsErrors = run("go", ["test", "./testdata/invalidelevenlabs"], go, 1);
assert.equal(goElevenLabsErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidelevenlabs
testdata/invalidelevenlabs/invalid.go:5:63: r.Speed undefined (type *elevenlabs.TtsRequestElevenV3TextVoiceedc22df3 has no field or method Speed)
testdata/invalidelevenlabs/invalid.go:6:68: r.TextBufferThresholds undefined (type *elevenlabs.TtsRequestStreamingTextVoicef49cfea8 has no field or method TextBufferThresholds)
testdata/invalidelevenlabs/invalid.go:7:74: cannot use schema.TtsRequestTextVoice4a0120aeOutputAsWav{} (value of struct type elevenlabs.TtsRequestTextVoice4a0120aeOutputAsWav) as elevenlabs.TtsRequestStreamingTextVoice194990a6Output value in assignment: elevenlabs.TtsRequestTextVoice4a0120aeOutputAsWav does not implement elevenlabs.TtsRequestStreamingTextVoice194990a6Output (missing method isTtsRequestStreamingTextVoice194990a6Output)
testdata/invalidelevenlabs/invalid.go:8:83: cannot use schema.TtsRequestStreamingTextVoice194990a6TextItemAsClear{} (value of struct type elevenlabs.TtsRequestStreamingTextVoice194990a6TextItemAsClear) as elevenlabs.TtsRequestElevenV3StreamingTextVoicef18e078fTextItem value in return statement: elevenlabs.TtsRequestStreamingTextVoice194990a6TextItemAsClear does not implement elevenlabs.TtsRequestElevenV3StreamingTextVoicef18e078fTextItem (missing method isTtsRequestElevenV3StreamingTextVoicef18e078fTextItem)
`);

const rustElevenLabsErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/elevenlabs.rs"], rust, 1);
assert.deepEqual(rustElevenLabsErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0599", line: 4 }, { code: "E0308", line: 5 }]);

const goDeepgramErrors = run("go", ["test", "./testdata/invaliddeepgram"], go, 1);
assert.equal(goDeepgramErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invaliddeepgram
testdata/invaliddeepgram/invalid.go:6:60: r.Tags undefined (type *deepgram.TtsRequestAura1StreamingTextVoice has no field or method Tags)
testdata/invaliddeepgram/invalid.go:7:71: cannot use schema.TtsRequestAura1TextVoiceOutputAsMp3{} (value of struct type deepgram.TtsRequestAura1TextVoiceOutputAsMp3) as deepgram.TtsRequestAura1StreamingTextVoiceOutput value in assignment: deepgram.TtsRequestAura1TextVoiceOutputAsMp3 does not implement deepgram.TtsRequestAura1StreamingTextVoiceOutput (missing method isTtsRequestAura1StreamingTextVoiceOutput)
testdata/invaliddeepgram/invalid.go:8:66: cannot use "es" (untyped string constant) as deepgram.TtsRequestAura1TextVoiceLanguage value in assignment
`);

const rustDeepgramErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/deepgram.rs"], rust, 1);
assert.deepEqual(rustDeepgramErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0599", line: 3 }, { code: "E0308", line: 4 }]);

const rustDeepdubErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/deepdub.rs"], rust, 1);
assert.deepEqual(rustDeepdubErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0308", line: 4 }]);

const goDeepdubErrors = run("go", ["test", "./testdata/invaliddeepdub"], go, 1);
assert.equal(goDeepdubErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invaliddeepdub
testdata/invaliddeepdub/invalid.go:6:54: r.RandomSeed undefined (type *deepdub.TtsRequestTextVoiceb776b412 has no field or method RandomSeed)
testdata/invaliddeepdub/invalid.go:7:58: r.Speed undefined (type *deepdub.TtsRequestTextVoice5ce3f477 has no field or method Speed)
testdata/invaliddeepdub/invalid.go:8:74: cannot use runtime.Some(12000.0) (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[float64]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[deepdub.TtsRequestOg11Text188d3251OutputSampleRateHz] value in assignment
`);

const rustCartesiaErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/cartesia.rs"], rust, 1);
assert.deepEqual(rustCartesiaErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 2 }, { code: "E0599", line: 3 }, { code: "E0308", line: 4 }]);

const goCartesiaErrors = run("go", ["test", "./testdata/invalidcartesia"], go, 1);
assert.equal(goCartesiaErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidcartesia
testdata/invalidcartesia/invalid.go:8:17: cannot use runtime.Some("en-GB") (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[string]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[cartesia.TtsRequestTextVoicef0bb1766Language] value in assignment
testdata/invalidcartesia/invalid.go:9:16: cannot use cartesia.TtsRequestTextVoicef0bb1766OutputAsMp3{} (value of struct type cartesia.TtsRequestTextVoicef0bb1766OutputAsMp3) as cartesia.TtsRequestStreamingTextVoice0bf53a99Output value in assignment: cartesia.TtsRequestTextVoicef0bb1766OutputAsMp3 does not implement cartesia.TtsRequestStreamingTextVoice0bf53a99Output (missing method isTtsRequestStreamingTextVoice0bf53a99Output)
testdata/invalidcartesia/invalid.go:10:23: cannot use "chunk" (untyped string constant) as cartesia_output.TimelineOutputCorrelation value in assignment
`);

const pyErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid.py"], python, 1).stdout);
assert.deepEqual(pyErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const rustJsonErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/json.rs"], rust, 1);
assert.deepEqual(rustJsonErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0308", line: 2 }]);
const pyJsonErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_json.py"], python, 1).stdout);
assert.deepEqual(pyJsonErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 3 }]);
const goJsonErrors = run("go", ["test", "./testdata/invalidjson"], go, 1);
assert.equal(goJsonErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidjson\ntestdata/invalidjson/invalid.go:3:31: cannot use []byte{…} (value of type []byte) as "github.com/speechswitch/client/sdks/go/runtime".JsonValue value in variable declaration: []byte does not implement "github.com/speechswitch/client/sdks/go/runtime".JsonValue (missing method isJsonValue)\n');

const rustOpenaiErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/openai.rs"], rust, 1);
assert.deepEqual(rustOpenaiErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0609", line: 3 }]);
const pyOpenaiErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_openai.py"], python, 1).stdout);
assert.deepEqual(pyOpenaiErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goOpenaiErrors = run("go", ["test", "./testdata/invalidopenai"], go, 1);
assert.equal(goOpenaiErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidopenai\ntestdata/invalidopenai/invalid.go:4:13: request.Instructions undefined (type *openai.TtsRequestTextVoice15a214fc has no field or method Instructions)\n');

const rustSmallestErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/smallest.rs"], rust, 1);
assert.deepEqual(rustSmallestErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0599", line: 2 }]);
const pySmallestErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_smallest.py"], python, 1).stdout);
assert.deepEqual(pySmallestErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goSmallestErrors = run("go", ["test", "./testdata/invalidsmallest"], go, 1);
assert.equal(goSmallestErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidsmallest\ntestdata/invalidsmallest/invalid.go:3:21: undefined: smallest_ai.TtsRequestLightningV31StreamingTextVoicebf9ab904LanguageAsJa\n');

const rustTypecastErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/typecast.rs"], rust, 1);
assert.deepEqual(rustTypecastErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0599", line: 2 }]);
const pyTypecastErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_typecast.py"], python, 1).stdout);
assert.deepEqual(pyTypecastErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goTypecastErrors = run("go", ["test", "./testdata/invalidtypecast"], go, 1);
assert.equal(goTypecastErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidtypecast\ntestdata/invalidtypecast/invalid.go:3:18: undefined: typecast.TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2EmotionAsAuto\n');

const rustVocuErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/vocu.rs"], rust, 1);
assert.deepEqual(rustVocuErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0609", line: 3 }]);
const pyVocuErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_vocu.py"], python, 1).stdout);
assert.deepEqual(pyVocuErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goVocuErrors = run("go", ["test", "./testdata/invalidvocu"], go, 1);
assert.equal(goVocuErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidvocu\ntestdata/invalidvocu/invalid.go:4:13: request.SubtitleFormat undefined (type *vocu.TtsRequestTextVoicee296d426 has no field or method SubtitleFormat)\n');

const rustVoiceAiErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/voice_ai.rs"], rust, 1);
assert.deepEqual(rustVoiceAiErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })), [{ code: "E0308", line: 3 }]);
const pyVoiceAiErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_voice_ai.py"], python, 1).stdout);
assert.deepEqual(pyVoiceAiErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [{ severity: "error", rule: "reportAssignmentType", line: 2 }]);
const goVoiceAiErrors = run("go", ["test", "./testdata/invalidvoiceai"], go, 1);
assert.equal(goVoiceAiErrors.stderr, '# github.com/speechswitch/client/sdks/go/testdata/invalidvoiceai\ntestdata/invalidvoiceai/invalid.go:6:27: cannot use voice_ai.TtsRequestObject1ec54d36LanguageEs{} (value of struct type voice_ai.TtsRequestObject1ec54d36LanguageEs) as voice_ai.TtsRequestObject1ec54d36LanguageEn value in assignment\n');

const rustStreamErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/stream.rs"], rust, 1);
assert.deepEqual(rustStreamErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 3 }, { code: "E0308", line: 6 }, { code: "E0599", line: 9 }]);
const pyStreamErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_stream.py"], python, 1).stdout);
assert.deepEqual(pyStreamErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [2, 3, 4].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));
const goStreamErrors = run("go", ["test", "./testdata/invalidstream"], go, 1);
assert.equal(goStreamErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidstream
testdata/invalidstream/invalid.go:3:57: cannot use "base64" (untyped string constant) as []byte value in struct literal
testdata/invalidstream/invalid.go:4:45: cannot use "cancel" (untyped string constant) as stream.ClearEventEvent value in struct literal
testdata/invalidstream/invalid.go:5:44: cannot use stream.AudioStreamItemAsBytes{…} (value of struct type stream.AudioStreamItemAsBytes) as stream.TimestampStreamItem value in variable declaration: stream.AudioStreamItemAsBytes does not implement stream.TimestampStreamItem (missing method isTimestampStreamItem)
`);

const goErrors = run("go", ["test", "./testdata/invalid"], go, 1);
assert.equal(goErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalid
testdata/invalid/invalid.go:10:13: request.Instructions undefined (type *hume.TtsRequestOctave2TextVoice has no field or method Instructions)
testdata/invalid/invalid.go:12:68: cannot use "cancel" (untyped string constant) as xai.TtsRequestStreamingTextTextItemClearCommand value in variable declaration
testdata/invalid/invalid.go:14:12: cannot use input (variable of interface type "github.com/speechswitch/client/sdks/go/runtime".Input[xai.TtsRequestStreamingTextTextItem]) as "github.com/speechswitch/client/sdks/go/runtime".Input[string] value in return statement: "github.com/speechswitch/client/sdks/go/runtime".Input[xai.TtsRequestStreamingTextTextItem] does not implement "github.com/speechswitch/client/sdks/go/runtime".Input[string] (wrong type for method Next)
\t\thave Next(context.Context) (xai.TtsRequestStreamingTextTextItem, error)
\t\twant Next(context.Context) (string, error)
`);

const goAsyncErrors = run("go", ["test", "./testdata/invalidasync"], go, 1);
assert.equal(goAsyncErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidasync
testdata/invalidasync/invalid.go:6:50: unknown field Speed in struct literal of type async_.TtsRequestProV10TextVoice54fc4ea5
testdata/invalidasync/invalid.go:7:59: cannot use schema.TtsRequestFlashV15TextVoicee827622bOutputAsWav{} (value of struct type async_.TtsRequestFlashV15TextVoicee827622bOutputAsWav) as async_.TtsRequestFlashV15StreamingTextVoiceOutput value in variable declaration: async_.TtsRequestFlashV15TextVoicee827622bOutputAsWav does not implement async_.TtsRequestFlashV15StreamingTextVoiceOutput (missing method isTtsRequestFlashV15StreamingTextVoiceOutput)
testdata/invalidasync/invalid.go:8:58: cannot use schema.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw{} (value of struct type async_.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw) as async_.TtsRequestFlashV15TextVoice7c30ce7aOutput value in variable declaration: async_.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw does not implement async_.TtsRequestFlashV15TextVoice7c30ce7aOutput (missing method isTtsRequestFlashV15TextVoice7c30ce7aOutput)
`);

const goCambErrors = run("go", ["test", "./testdata/invalidcamb"], go, 1);
assert.equal(goCambErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidcamb
testdata/invalidcamb/invalid.go:5:76: cannot use schema.TtsRequestTextVoiceModelMars8Pro{} (value of struct type camb.TtsRequestTextVoiceModelMars8Pro) as camb.TtsRequestMars81FlashBetaStreamingTextVoiceModel value in struct literal
testdata/invalidcamb/invalid.go:6:75: cannot use schema.TtsRequestTextVoiceOutputPcm{} (value of struct type camb.TtsRequestTextVoiceOutputPcm) as camb.TtsRequestMars81FlashBetaStreamingTextVoiceOutput value in struct literal
testdata/invalidcamb/invalid.go:7:48: unknown field InferenceSteps in struct literal of type camb.TtsRequestTextVoice
`);

// Compile uncommon shapes from real authored TypeScript too: nullable/optional
// values, byte arrays, unbounded integers, fractional literals and stream unions.
const spec = extractSpeechSpec({ root: path.join(root, "codegen/fixtures/languages"), tsconfig: "tsconfig.json", baseFile: "schema.ts", providers: [] });
const fixture = { kind: "object" as const, fields: spec.tts.request.fields };
const temporary = mkdtempSync(path.join(tmpdir(), "speechswitch-language-types-"));
try {
  const sseFixtures: { name: string; text?: string; hex?: string; limit?: number; events: { event: string; data: string }[]; error?: string }[] = JSON.parse(readFileSync(path.join(root, "sdks/fixtures/sse.json"), "utf8"));
  const rustText = (text: string) => `std::str::from_utf8(&[${[...new TextEncoder().encode(text)].join(",")}]).unwrap()`;
  // Compile the same goldens used by Python, Go and TypeScript, without adding a
  // Rust JSON dependency or checking in a second copy of the expected results.
  const sseHarness = `#[path = ${JSON.stringify(path.join(rust, "tests/sse.rs"))}] mod harness;\n` + sseFixtures.map((fixture, index) => {
    const bytes = fixture.hex === undefined ? new TextEncoder().encode(fixture.text) : Buffer.from(fixture.hex, "hex");
    return `#[test] fn fixture_${index}() { harness::check_case(${rustText(fixture.name)}, &[${[...bytes].join(",")}], ${fixture.limit ?? 4096}, &[${fixture.events.map(event => `(${rustText(event.event)}, ${rustText(event.data)})`).join(",")}], ${fixture.error === undefined ? "None" : `Some(${rustText(fixture.error)})`}); }`;
  }).join("\n");
  writeFileSync(path.join(temporary, "sse.rs"), sseHarness);
  run("rustc", ["--edition=2021", "--test", "--extern", `speechswitch_types=${path.join(rust, "target/debug/libspeechswitch_types.rlib")}`, "-o", path.join(temporary, "sse-rust"), path.join(temporary, "sse.rs")], root);
  run(path.join(temporary, "sse-rust"), [], root);
  for (const [language, extension] of [["rust", "rs"], ["go", "go"], ["python", "py"]] as const) {
    writeFileSync(path.join(temporary, `fixture.${extension}`), renderLanguageTypes(fixture, language, "fixture"));
  }
  const validationFixture = extractSchemaTypes({ root: path.join(root, "codegen/fixtures/languages"), tsconfig: "tsconfig.json", file: "schema.ts", names: ["TtsRequest"] }).get("TtsRequest")!;
  writeFileSync(path.join(temporary, "fixture_validator.py"), renderPythonValidator({ id: "fixture", request: validationFixture }));
  writeFileSync(path.join(temporary, "fixture_validation.go"), renderGoValidator({ id: "fixture", request: validationFixture }));
  writeFileSync(path.join(temporary, "fixture_validator.rs"), renderRustValidator({ id: "fixture", request: validationFixture }));
  const optionalInput = extractSchemaTypes({ root: path.join(root, "codegen/fixtures/languages"), tsconfig: "tsconfig.json", file: "schema.ts", names: ["OptionalInputRequest"] }).get("OptionalInputRequest")!;
  writeFileSync(path.join(temporary, "optional_input.rs"), renderLanguageTypes(optionalInput, "rust", "optional_input"));
  writeFileSync(path.join(temporary, "optional_input_validator.rs"), renderRustValidator({ id: "optional_input", request: optionalInput }));
  run("pyright", ["--pythonversion", "3.13", path.join(temporary, "fixture_validator.py")], python);
  run("python3", ["-c", `
import sys
sys.path.insert(0, ${JSON.stringify(temporary)})
from fixture_validator import validate_request
class Input:
    def __aiter__(self): raise AssertionError("input acquired")
request = dict(required_nullable=None, bytes=b"audio", integer=10**1000, fractional_literal=0.25,
    escaped_literal=bytes([92, 117, 48, 48, 48, 48, 0]).decode(), items=[None, "hello"], text=Input())
check = validate_request(request)
check("hello")
check({"command": "clear"})
for value in [None, False, True]: validate_request({**request, "optional": value})
for key, value in [("integer", True), ("integer", 1.5), ("bytes", bytearray(b"audio")),
    ("required_nullable", False), ("fractional_literal", 0.5), ("items", [False]), ("forbidden", None)]:
    try: validate_request({**request, key: value})
    except TypeError as error: assert str(error) == "Invalid fixture TTS request"
    else: raise AssertionError((key, value))
del request["required_nullable"]
try: validate_request(request)
except TypeError as error: assert str(error) == "Invalid fixture TTS request"
else: raise AssertionError("required nullable field was omitted")
`], python);
  writeFileSync(path.join(temporary, "main.rs"), `#[path = ${JSON.stringify(path.join(rust, "src/runtime.rs"))}] pub mod runtime;
mod fixture;
pub mod generated {
    pub mod fixture { pub use crate::fixture::*; }
    pub mod optional_input { pub use crate::optional_input::*; }
}
mod fixture_validator;
mod optional_input;
mod optional_input_validator;
struct Input;
impl<T> runtime::InputStream<T> for Input {
    fn poll_next(self: std::pin::Pin<&mut Self>, _: &mut std::task::Context<'_>) -> std::task::Poll<Option<Result<T, Box<dyn std::error::Error + Send + Sync>>>> { panic!("input advanced") }
}
fn main() {
    assert_eq!(fixture::TtsRequestFractionalLiteral.value(), 0.25);
    assert_eq!(fixture::TtsRequestEscapedLiteral.value().as_bytes(), &[92, 117, 48, 48, 48, 48, 0]);
    let absent: Option<fixture::TtsRequestOptional> = None;
    let explicit_null = Some(fixture::TtsRequestOptional::Null(Default::default()));
    let explicit_false = Some(fixture::TtsRequestOptional::False(Default::default()));
    assert!(absent.is_none());
    assert!(matches!(explicit_null, Some(fixture::TtsRequestOptional::Null(_))));
    assert!(matches!(explicit_false, Some(fixture::TtsRequestOptional::False(_))));
    let request = fixture::TtsRequest {
        optional: Some(fixture::TtsRequestOptional::Null(Default::default())),
        required_nullable: fixture::TtsRequestItemsItem::Null(Default::default()),
        bytes: vec![1], integer: "1234567890123456789012345678901234567890".parse().unwrap(),
        fractional_literal: fixture::TtsRequestFractionalLiteral, escaped_literal: fixture::TtsRequestEscapedLiteral,
        items: vec![fixture::TtsRequestItemsItem::Null(Default::default())], text: Box::pin(Input),
    };
    let check = fixture_validator::validate_request(&request).unwrap();
    drop(request);
    assert_eq!(check(&fixture::TtsRequestTextItem::Clear(fixture::TtsRequestTextItemClear { command: Default::default() }), None), Ok(()));
    assert_eq!(check(&false, None), Err(runtime::ValidationError("Invalid fixture TTS input item")));
    let mut optional = optional_input::TtsRequest { text: None };
    let item = optional_input::TtsRequestTextAsyncIterableItem::Clear(optional_input::TtsRequestTextAsyncIterableItemClear { command: Default::default() });
    assert_eq!(optional_input_validator::validate_request(&optional).unwrap()(&item, None), Err(runtime::ValidationError("Invalid optional_input TTS input item")));
    optional.text = Some(optional_input::TtsRequestText::String("hello".into()));
    assert_eq!(optional_input_validator::validate_request(&optional).unwrap()(&item, None), Err(runtime::ValidationError("Invalid optional_input TTS input item")));
    optional.text = Some(optional_input::TtsRequestText::AsyncIterable(Box::pin(Input)));
    assert_eq!(optional_input_validator::validate_request(&optional).unwrap()(&item, None), Ok(()));
}
`);
  run("rustc", ["--edition=2021", "-o", path.join(temporary, "fixture-rust"), path.join(temporary, "main.rs")], root);
  run(path.join(temporary, "fixture-rust"), [], root);
  writeFileSync(path.join(temporary, "fixture_test.go"), `package fixture
import ("context"; "math/big"; "testing"; "github.com/speechswitch/client/sdks/go/runtime")
func TestFixture(t *testing.T) {
    if (TtsRequestFractionalLiteral{}).Value() != 0.25 { t.Fatal("wrong literal") }
    if (TtsRequestEscapedLiteral{}).Value() != string([]byte{92, 117, 48, 48, 48, 48, 0}) { t.Fatal("wrong string escaping") }
    var omitted runtime.Optional[TtsRequestOptional]
    var null TtsRequestOptional = TtsRequestOptionalAsNull{}
    explicit := runtime.Some(null)
    if omitted.Present || !explicit.Present { t.Fatal("lost presence") }
}
type fixtureInput struct{}
func (*fixtureInput) Next(context.Context) (TtsRequestTextItem,error) { panic("input advanced") }
func (*fixtureInput) Close() error { panic("input closed") }
func TestValidationFixture(t *testing.T) {
    request := TtsRequest{RequiredNullable: TtsRequestItemsItemAsNull{}, Bytes: []byte{1}, Integer: big.NewInt(42),
        Items: []TtsRequestItemsItem{TtsRequestItemsItemAsNull{}}, Text: &fixtureInput{}}
    check, err := ValidateRequest(request); if err != nil { t.Fatal(err) }
    if err := check(TtsRequestTextItemAsClear{}); err != nil { t.Fatal(err) }
    request.Optional = runtime.Some(TtsRequestOptional(TtsRequestOptionalAsNull{}))
    if _, err := ValidateRequest(request); err != nil { t.Fatal(err) }
    request.Optional = runtime.Some(TtsRequestOptional(nil))
    if _, err := ValidateRequest(request); err == nil || err.Error() != "Invalid fixture TTS request" { t.Fatalf("nil optional union accepted: %v", err) }
    request.Optional = runtime.Optional[TtsRequestOptional]{}
    request.Integer = nil
    if _, err := ValidateRequest(request); err == nil || err.Error() != "Invalid fixture TTS request" { t.Fatalf("nil bigint accepted: %v", err) }
    request.Integer = big.NewInt(42); request.RequiredNullable = nil
    if _, err := ValidateRequest(request); err == nil || err.Error() != "Invalid fixture TTS request" { t.Fatalf("missing nullable field accepted: %v", err) }
}
`);
  run("go", ["test", path.join(temporary, "fixture.go"), path.join(temporary, "fixture_validation.go"), path.join(temporary, "fixture_test.go")], go);
  run("pyright", ["--pythonversion", "3.13", path.join(temporary, "fixture.py")], python);
  run("python3", ["-c", `import sys; from typing import get_args; sys.path.insert(0, ${JSON.stringify(temporary)}); import fixture; assert fixture.TtsRequest.__optional_keys__ == frozenset({"optional"}); assert fixture.TtsRequest.__required_keys__ == frozenset({"required_nullable", "bytes", "integer", "fractional_literal", "escaped_literal", "items", "text"}); assert fixture.TtsRequestFractionalLiteral.VALUE.value == 0.25; assert get_args(fixture.TtsRequestEscapedLiteral.__value__) == (bytes([92, 117, 48, 48, 48, 48, 0]).decode(),)`], python);
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Rust, Python and Go compile; all generated validator parity checks, HTTP lifecycle tests, shared SSE/provider fixtures, native WebSockets/gRPC, output streams, runtime primitives, uncommon schema shapes and all 130 expected type errors pass.");
