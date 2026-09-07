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
run("node", ["codegen/check-lovo-clients.ts"], root);
run("node", ["codegen/check-openai-clients.ts"], root);
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

const rustMurfErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/murf.rs"], rust, 1);
assert.deepEqual(rustMurfErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0609", line: 6 }, { code: "E0308", line: 7 }, { code: "E0599", line: 8 }, { code: "E0599", line: 9 }, { code: "E0599", line: 10 }, { code: "E0308", line: 11 }]);

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

const pyMiniMaxErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_minimax.py"], python, 1).stdout);
assert.deepEqual(pyMiniMaxErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyMurfErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_murf.py"], python, 1).stdout);
assert.deepEqual(pyMurfErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyMicrosoftErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_microsoft.py"], python, 1).stdout);
assert.deepEqual(pyMicrosoftErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyLovoErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_lovo.py"], python, 1).stdout);
assert.deepEqual(pyLovoErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8, 9, 10, 11].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyKugelAudioErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_kugelaudio.py"], python, 1).stdout);
assert.deepEqual(pyKugelAudioErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyInworldErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_inworld.py"], python, 1).stdout);
assert.deepEqual(pyInworldErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9, 10, 11, 12, 14, 15].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const pyHumeErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_hume.py"], python, 1).stdout);
assert.deepEqual(pyHumeErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [5, 6, 7, 8, 9, 10, 11, 12, 13, 15].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const rustGradiumErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/gradium.rs"], rust, 1);
assert.deepEqual(rustGradiumErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0599", line: 5 }, { code: "E0308", line: 6 }, { code: "E0599", line: 7 }]);

const pyGradiumErrors = JSON.parse(run("pyright", ["--outputjson", "tests/invalid_gradium.py"], python, 1).stdout);
assert.deepEqual(pyGradiumErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })),
  [4, 5, 6, 7, 8, 9, 10].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));

const rustLovoErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/lovo.rs"], rust, 1);
assert.deepEqual(rustLovoErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0308", line: 5 }, { code: "E0308", line: 6 }, { code: "E0609", line: 7 }, { code: "E0308", line: 8 }, { code: "E0308", line: 9 }]);

const rustKugelAudioErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/kugelaudio.rs"], rust, 1);
assert.deepEqual(rustKugelAudioErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0599", line: 2 }, { code: "E0308", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0609", line: 6 }, { code: "E0609", line: 7 }, { code: "E0609", line: 8 }, { code: "E0308", line: 9 }, { code: "E0308", line: 10 }, { code: "E0599", line: 11 }]);

const rustInworldErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/inworld.rs"], rust, 1);
assert.deepEqual(rustInworldErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0609", line: 6 }, { code: "E0599", line: 7 }, { code: "E0599", line: 8 }, { code: "E0599", line: 9 }, { code: "E0308", line: 10 }, { code: "E0609", line: 11 }]);

const rustHumeErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/hume.rs"], rust, 1);
assert.deepEqual(rustHumeErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0609", line: 6 }, { code: "E0599", line: 7 }, { code: "E0609", line: 8 }, { code: "E0308", line: 9 }, { code: "E0599", line: 10 }, { code: "E0609", line: 11 }]);

const rustMicrosoftErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/microsoft.rs"], rust, 1);
assert.deepEqual(rustMicrosoftErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0609", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0599", line: 6 }, { code: "E0308", line: 7 }, { code: "E0599", line: 8 }, { code: "E0609", line: 9 }, { code: "E0308", line: 10 }]);

const rustMiniMaxErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/minimax.rs"], rust, 1);
assert.deepEqual(rustMiniMaxErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 2 }, { code: "E0308", line: 3 }, { code: "E0609", line: 4 }, { code: "E0609", line: 5 }, { code: "E0609", line: 6 }, { code: "E0609", line: 7 }, { code: "E0609", line: 8 }, { code: "E0308", line: 9 }, { code: "E0599", line: 10 }, { code: "E0308", line: 11 }, { code: "E0308", line: 12 }]);

const goMiniMaxErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidminimax"], go, 1);
assert.equal(goMiniMaxErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidminimax
testdata/invalidminimax/invalid.go:7:127: cannot use schema.TtsRequestTexte253c939LanguageAsFa{} (value of struct type minimax.TtsRequestTexte253c939LanguageAsFa) as minimax.TtsRequestText77d171beLanguage value in argument to runtime.Some[schema.TtsRequestText77d171beLanguage]: minimax.TtsRequestTexte253c939LanguageAsFa does not implement minimax.TtsRequestText77d171beLanguage (missing method isTtsRequestText77d171beLanguage)
testdata/invalidminimax/invalid.go:8:124: cannot use schema.TtsRequestTexte253c939EmotionAsWhisper{} (value of struct type minimax.TtsRequestTexte253c939EmotionAsWhisper) as minimax.TtsRequestText77d171beEmotion value in argument to runtime.Some[schema.TtsRequestText77d171beEmotion]: minimax.TtsRequestTexte253c939EmotionAsWhisper does not implement minimax.TtsRequestText77d171beEmotion (missing method isTtsRequestText77d171beEmotion)
testdata/invalidminimax/invalid.go:9:78: r.TextNormalization undefined (type *minimax.TtsRequestStreamingTextVoice9e2e17ce has no field or method TextNormalization)
testdata/invalidminimax/invalid.go:10:75: r.TimestampGranularity undefined (type *minimax.TtsRequestStreamingTextVoice9e2e17ce has no field or method TimestampGranularity)
testdata/invalidminimax/invalid.go:11:76: r.SplitTurns undefined (type *minimax.TtsRequestStreamingTextVoicee206c70a has no field or method SplitTurns)
testdata/invalidminimax/invalid.go:12:60: r.VoiceBlend undefined (type *minimax.TtsRequestTextVoice9b47fc40 has no field or method VoiceBlend)
testdata/invalidminimax/invalid.go:13:59: r.ReferenceAudio undefined (type *minimax.TtsRequestTextVoice9b47fc40 has no field or method ReferenceAudio)
testdata/invalidminimax/invalid.go:14:57: cannot use schema.TtsRequestTextf2dcc77eOutputAsWava066cb88{} (value of struct type minimax.TtsRequestTextf2dcc77eOutputAsWava066cb88) as minimax.TtsRequestStreamingTextaa771f19Output value in variable declaration: minimax.TtsRequestTextf2dcc77eOutputAsWava066cb88 does not implement minimax.TtsRequestStreamingTextaa771f19Output (missing method isTtsRequestStreamingTextaa771f19Output)
testdata/invalidminimax/invalid.go:15:21: undefined: schema.TtsRequestStreamingText12421ea0TextItemAsUpdate
testdata/invalidminimax/invalid.go:16:60: cannot use "chunk" (constant of type string) as minimax_output.MiniMaxEnvelopeCorrelation value in assignment: string does not implement minimax_output.MiniMaxEnvelopeCorrelation (missing method LiteralValue)
testdata/invalidminimax/invalid.go:17:51: cannot use 1 (untyped int constant) as string value in assignment
`);

const goMurfErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidmurf"], go, 1);
assert.equal(goMurfErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidmurf
testdata/invalidmurf/invalid.go:7:50: r.TargetDurationMs undefined (type *murf.TtsRequestTextVoice has no field or method TargetDurationMs)
testdata/invalidmurf/invalid.go:8:52: r.TimestampGranularity undefined (type *murf.TtsRequestTextVoice has no field or method TimestampGranularity)
testdata/invalidmurf/invalid.go:9:60: r.AudioRetention undefined (type *murf.TtsRequestStreamingTextVoice has no field or method AudioRetention)
testdata/invalidmurf/invalid.go:10:51: r.ReferenceAudio undefined (type *murf.TtsRequestTextVoice has no field or method ReferenceAudio)
testdata/invalidmurf/invalid.go:11:71: r.Replacements undefined (type *murf.TtsRequestStreamingTextVoiceTextItemUpdate has no field or method Replacements)
testdata/invalidmurf/invalid.go:12:96: cannot use input (variable of interface type "github.com/speechswitch/client/sdks/go/runtime".Input[string]) as string value in assignment
testdata/invalidmurf/invalid.go:13:69: cannot use schema.TtsRequestStreamingTextVoiceOutputSampleRateHzAsNumber16000{} (value of struct type murf.TtsRequestStreamingTextVoiceOutputSampleRateHzAsNumber16000) as murf.TtsRequestGen2TextVoiceca621e19OutputSampleRateHz value in variable declaration: murf.TtsRequestStreamingTextVoiceOutputSampleRateHzAsNumber16000 does not implement murf.TtsRequestGen2TextVoiceca621e19OutputSampleRateHz (missing method isTtsRequestGen2TextVoiceca621e19OutputSampleRateHz)
testdata/invalidmurf/invalid.go:14:51: cannot use "chunk" (constant of type string) as murf_output.MurfEnvelopeCorrelation value in assignment: string does not implement murf_output.MurfEnvelopeCorrelation (missing method LiteralValue)
testdata/invalidmurf/invalid.go:15:17: undefined: out.SynthesisItemAsUpdated
testdata/invalidmurf/invalid.go:16:50: cannot use 1 (untyped int constant) as string value in assignment
`);

const goMicrosoftErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidmicrosoft"], go, 1);
assert.equal(goMicrosoftErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidmicrosoft
testdata/invalidmicrosoft/invalid.go:7:63: r.LexiconUrl undefined (type *microsoft.TtsRequestTextVoice4ff226b4 has no field or method LexiconUrl)
testdata/invalidmicrosoft/invalid.go:8:65: r.PreferredLanguages undefined (type *microsoft.TtsRequestTextVoice4ff226b4 has no field or method PreferredLanguages)
testdata/invalidmicrosoft/invalid.go:9:59: r.Speed undefined (type *microsoft.TtsRequestDragonHdTextVoice has no field or method Speed)
testdata/invalidmicrosoft/invalid.go:10:80: r.TopK undefined (type *microsoft.TtsRequestDragonHdOmniStreamingTextVoice has no field or method TopK)
testdata/invalidmicrosoft/invalid.go:11:19: undefined: schema.TtsRequestDragonHdFlashStreamingTextVoiceOutputAsWavbcb4c8a6
testdata/invalidmicrosoft/invalid.go:12:96: cannot use input (variable of interface type "github.com/speechswitch/client/sdks/go/runtime".Input[int]) as "github.com/speechswitch/client/sdks/go/runtime".Input[string] value in struct literal: "github.com/speechswitch/client/sdks/go/runtime".Input[int] does not implement "github.com/speechswitch/client/sdks/go/runtime".Input[string] (wrong type for method Next)
\t\thave Next(context.Context) (int, error)
\t\twant Next(context.Context) (string, error)
testdata/invalidmicrosoft/invalid.go:13:17: undefined: out.SynthesisItemAsClear
testdata/invalidmicrosoft/invalid.go:14:59: r.ReferenceAudio undefined (type *microsoft.TtsRequestTextVoice4ff226b4 has no field or method ReferenceAudio)
testdata/invalidmicrosoft/invalid.go:15:62: cannot use "chunk" (untyped string constant) as microsoft_output.MicrosoftEnvelopeCorrelation value in assignment
`);

const goLovoErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidlovo"], go, 1);
assert.equal(goLovoErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidlovo
testdata/invalidlovo/invalid.go:6:38: r.Model undefined (type *lovo.TtsRequest has no field or method Model)
testdata/invalidlovo/invalid.go:7:41: r.Language undefined (type *lovo.TtsRequest has no field or method Language)
testdata/invalidlovo/invalid.go:8:39: r.Output undefined (type *lovo.TtsRequest has no field or method Output)
testdata/invalidlovo/invalid.go:9:49: cannot use []string{…} (value of type []string) as string value in assignment
testdata/invalidlovo/invalid.go:10:46: cannot use 1 (untyped int constant) as string value in assignment
testdata/invalidlovo/invalid.go:11:42: r.ReferenceAudio undefined (type *lovo.TtsRequest has no field or method ReferenceAudio)
testdata/invalidlovo/invalid.go:12:58: cannot use "chunk" (untyped string constant) as lovo_output.LovoAudioEnvelopeCorrelation value in assignment
testdata/invalidlovo/invalid.go:13:56: cannot use [1]struct{}{…} (value of type [1]struct{}) as [0]struct{} value in assignment
`);

const goKugelAudioErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidkugelaudio"], go, 1);
assert.equal(goKugelAudioErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidkugelaudio
testdata/invalidkugelaudio/invalid.go:6:64: undefined: schema.TtsRequestTextVoiceOutputAsMp3
testdata/invalidkugelaudio/invalid.go:7:73: cannot use r.Format (variable of interface type kugelaudio.TtsRequestTextVoiceOutputObjectFormat) as "github.com/speechswitch/client/sdks/go/runtime".Optional[kugelaudio.TtsRequestTextVoiceOutputPcmSampleRateHzNumber8000] value in assignment
testdata/invalidkugelaudio/invalid.go:8:51: r.TextFlushDelayMs undefined (type *kugelaudio.TtsRequestTextVoice has no field or method TextFlushDelayMs)
testdata/invalidkugelaudio/invalid.go:9:47: r.VoiceName undefined (type *kugelaudio.TtsRequestTextVoice has no field or method VoiceName)
testdata/invalidkugelaudio/invalid.go:10:76: r.Voice undefined (type *kugelaudio.TtsRequestStreamingTextVoiceTextItemUpdate has no field or method Voice)
testdata/invalidkugelaudio/invalid.go:11:77: r.Replacements undefined (type *kugelaudio.TtsRequestStreamingTextVoiceTextItemUpdate has no field or method Replacements)
testdata/invalidkugelaudio/invalid.go:12:75: r.Output undefined (type *kugelaudio.TtsRequestStreamingTextVoiceTextItemClear has no field or method Output)
testdata/invalidkugelaudio/invalid.go:13:63: cannot use "chunk" (untyped string constant) as kugelaudio_output.KugelAudioEnvelopeCorrelation value in assignment
testdata/invalidkugelaudio/invalid.go:14:55: cannot use "unknown" (untyped string constant) as "github.com/speechswitch/client/sdks/go/runtime".Optional[kugelaudio.TtsRequestTextVoiceModel] value in assignment
testdata/invalidkugelaudio/invalid.go:15:45: undefined: out.SynthesisItemAsBatch
`);

const goInworldErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidinworld"], go, 1);
assert.equal(goInworldErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidinworld
testdata/invalidinworld/invalid.go:6:64: r.Temperature undefined (type *inworld.TtsRequestInworldTts2TextVoice has no field or method Temperature)
testdata/invalidinworld/invalid.go:7:50: r.DeliveryMode undefined (type *inworld.TtsRequestTextVoice has no field or method DeliveryMode)
testdata/invalidinworld/invalid.go:8:54: r.Instructions undefined (type *inworld.TtsRequestTextVoice has no field or method Instructions)
testdata/invalidinworld/invalid.go:9:68: r.Instructions undefined (type *inworld.TtsRequestInworldTts2StreamingTextVoice has no field or method Instructions)
testdata/invalidinworld/invalid.go:10:58: r.VoiceName undefined (type *inworld.TtsRequestInworldTts2TextVoice has no field or method VoiceName)
testdata/invalidinworld/invalid.go:11:71: undefined: schema.TtsRequestStreamingTextVoiceOutputAsFlac
testdata/invalidinworld/invalid.go:12:74: undefined: schema.TtsRequestStreamingTextVoiceTextItemAsClear
testdata/invalidinworld/invalid.go:13:45: undefined: out.SynthesisItemAsClear
testdata/invalidinworld/invalid.go:14:68: cannot use "chunk" (untyped string constant) as inworld_output.InworldTimelineEnvelopeCorrelation value in assignment
testdata/invalidinworld/invalid.go:15:57: r.ContextBefore undefined (type *inworld.TtsRequestStreamingTextVoice has no field or method ContextBefore)
`);

const goHumeErrors = run("go", ["test", "-gcflags=-e", "./testdata/invalidhume"], go, 1);
assert.equal(goHumeErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidhume
testdata/invalidhume/invalid.go:6:55: r.Instructions undefined (type *hume.TtsRequestOctave2TextVoice has no field or method Instructions)
testdata/invalidhume/invalid.go:7:55: r.VoiceDescription undefined (type *hume.TtsRequestOctave2TextVoice has no field or method VoiceDescription)
testdata/invalidhume/invalid.go:8:59: r.TimestampGranularity undefined (type *hume.TtsRequestOctave1TextVoice has no field or method TimestampGranularity)
testdata/invalidhume/invalid.go:9:54: r.SampleRateHz undefined (type *hume.TtsRequestOctave1TextOutput has no field or method SampleRateHz)
testdata/invalidhume/invalid.go:10:54: r.VoiceName undefined (type *hume.TtsRequestOctave2TextVoice has no field or method VoiceName)
testdata/invalidhume/invalid.go:11:68: undefined: schema.TtsRequestOctave2StreamingTurnsTurnsItemAsClear
testdata/invalidhume/invalid.go:12:76: r.Instructions undefined (type *hume.TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem has no field or method Instructions)
testdata/invalidhume/invalid.go:13:57: cannot use "chunk" (untyped string constant) as hume_output.HumeEnvelopeCorrelation value in assignment
testdata/invalidhume/invalid.go:14:35: undefined: out.SynthesisItemAsFlush
testdata/invalidhume/invalid.go:15:63: r.SplitTurns undefined (type *hume.TtsRequestOctave2StreamingTextVoice has no field or method SplitTurns)
`);

const goGradiumErrors = run("go", ["test", "./testdata/invalidgradium"], go, 1);
assert.equal(goGradiumErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidgradium
testdata/invalidgradium/invalid.go:6:42: r.Speed undefined (type *gradium.TtsRequest has no field or method Speed)
testdata/invalidgradium/invalid.go:7:58: r.SampleRateHz undefined (type *gradium.TtsRequestOutputOggOpus has no field or method SampleRateHz)
testdata/invalidgradium/invalid.go:8:81: r.Rules undefined (type *gradium.TtsRequestTextNormalizationObjecte21202a8 has no field or method Rules)
testdata/invalidgradium/invalid.go:9:69: undefined: schema.TtsRequestTextAsyncIterableItemAsClear
testdata/invalidgradium/invalid.go:10:59: cannot use "chunk" (untyped string constant) as gradium_output.TimelineOutputCorrelation value in assignment
testdata/invalidgradium/invalid.go:11:45: undefined: out.SynthesisItemAsClear
`);

const goGoogleErrors = run("go", ["test", "./testdata/invalidgoogle"], go, 1);
assert.equal(goGoogleErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidgoogle
testdata/invalidgoogle/invalid.go:6:66: r.Instructions undefined (type *google.TtsRequestChirp3Hda92b414c has no field or method Instructions)
testdata/invalidgoogle/invalid.go:7:91: cannot use schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3{} (value of struct type google.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3) as google.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output value in assignment: google.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3 does not implement google.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output (missing method isTtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output)
testdata/invalidgoogle/invalid.go:8:67: cannot use schema.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts{} (value of struct type google.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts) as google.TtsRequestTextModel value in assignment: google.TtsRequestTextVoiceModelAsGemini25FlashLitePreviewTts does not implement google.TtsRequestTextModel (missing method isTtsRequestTextModel)
testdata/invalidgoogle/invalid.go:9:67: r.VolumeDb undefined (type *google.TtsRequestObject7d956f3d has no field or method VolumeDb)
testdata/invalidgoogle/invalid.go:10:68: cannot use schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav{} (value of struct type google.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav) as google.TtsRequestChirp3Hda92b414cOutput value in assignment: google.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav does not implement google.TtsRequestChirp3Hda92b414cOutput (missing method isTtsRequestChirp3Hda92b414cOutput)
testdata/invalidgoogle/invalid.go:11:158: cannot use commands (variable of interface type "github.com/speechswitch/client/sdks/go/runtime".Input[int]) as "github.com/speechswitch/client/sdks/go/runtime".Input[string] value in struct literal: "github.com/speechswitch/client/sdks/go/runtime".Input[int] does not implement "github.com/speechswitch/client/sdks/go/runtime".Input[string] (wrong type for method Next)
\t\thave Next(context.Context) (int, error)
\t\twant Next(context.Context) (string, error)
`);

const rustGoogleErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--extern", "speechswitch_types=target/debug/libspeechswitch_types.rlib", "--error-format=json", "tests/compile_fail/google.rs"], rust, 1);
assert.deepEqual(rustGoogleErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0609", line: 2 }, { code: "E0308", line: 3 }, { code: "E0308", line: 4 }, { code: "E0609", line: 5 }, { code: "E0308", line: 6 }, { code: "E0308", line: 7 }]);

const rustGoogleProtoErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--error-format=json", "tests/compile_fail/google_protobuf.rs"], rust, 1);
assert.deepEqual(rustGoogleProtoErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 4 }, { code: "E0308", line: 5 }, { code: "E0308", line: 6 }, { code: "E0063", line: 7 }, { code: "E0599", line: 8 }, { code: "E0308", line: 9 }]);

const rustGoogleRestErrors = run("rustc", ["--edition=2021", "--crate-type=lib", "--emit=metadata", "--out-dir", "target", "--error-format=json", "tests/compile_fail/google_rest.rs"], rust, 1);
assert.deepEqual(rustGoogleRestErrors.stderr.trim().split("\n").map(line => JSON.parse(line)).filter(error => error.level === "error" && error.code).map(error => ({ code: error.code.code, line: error.spans.find((span: { is_primary: boolean }) => span.is_primary).line_start })),
  [{ code: "E0308", line: 7 }, { code: "E0308", line: 8 }, { code: "E0308", line: 9 }, { code: "E0560", line: 10 }, { code: "E0308", line: 11 }, { code: "E0599", line: 12 }]);

const goGoogleProtoErrors = run("go", ["test", "./testdata/invalidgoogleprotobuf"], go, 1);
assert.equal(goGoogleProtoErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidgoogleprotobuf
testdata/invalidgoogleprotobuf/invalid.go:6:28: cannot use "PCM" (constant of type string) as google_grpc.AudioEncoding value in variable declaration: string does not implement google_grpc.AudioEncoding (missing method isAudioEncoding)
testdata/invalidgoogleprotobuf/invalid.go:7:49: cannot use wire.StreamingSynthesizeRequest_Input{} (value of struct type google_grpc.StreamingSynthesizeRequest_Input) as google_grpc.StreamingSynthesisInputInputSource value in variable declaration: google_grpc.StreamingSynthesizeRequest_Input does not implement google_grpc.StreamingSynthesisInputInputSource (missing method isStreamingSynthesisInputInputSource)
testdata/invalidgoogleprotobuf/invalid.go:8:52: cannot use runtime.Some(24000.5) (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[float64]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[int32] value in struct literal
testdata/invalidgoogleprotobuf/invalid.go:9:46: cannot use runtime.Some((*string)(nil)) (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[*string]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[string] value in struct literal
testdata/invalidgoogleprotobuf/invalid.go:10:100: duplicate field name StreamingRequest in struct literal
testdata/invalidgoogleprotobuf/invalid.go:11:14: undefined: wire.AudioEncoding_MP3_64_KBPS
`);

const goGoogleRestErrors = run("go", ["test", "./testdata/invalidgooglerest"], go, 1);
assert.equal(goGoogleRestErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidgooglerest
testdata/invalidgooglerest/invalid.go:6:41: cannot use runtime.Some("FLAC") (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[string]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[google_rest.AudioConfigAudioEncoding] value in struct literal
testdata/invalidgooglerest/invalid.go:7:43: cannot use runtime.Some(1.5) (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[float64]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[google_rest.AudioConfigSampleRateHertz] value in struct literal
testdata/invalidgooglerest/invalid.go:8:45: cannot use runtime.Some((*wire.SynthesisInput)(nil)) (value of struct type "github.com/speechswitch/client/sdks/go/runtime".Optional[*google_rest.SynthesisInput]) as "github.com/speechswitch/client/sdks/go/runtime".Optional[google_rest.SynthesisInput] value in struct literal
testdata/invalidgooglerest/invalid.go:9:38: unknown field EnableTimePointing in struct literal of type google_rest.SynthesizeSpeechRequest
`);

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
assert.deepEqual(pyOpenaiErrors.generalDiagnostics.map((error: { severity: string; rule: string; range: { start: { line: number } } }) => ({ severity: error.severity, rule: error.rule, line: error.range.start.line + 1 })), [2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map(line => ({ severity: "error", rule: "reportAssignmentType", line })));
const goOpenaiErrors = run("go", ["test", "./testdata/invalidopenai"], go, 1);
assert.equal(goOpenaiErrors.stderr, `# github.com/speechswitch/client/sdks/go/testdata/invalidopenai
testdata/invalidopenai/invalid.go:4:13: request.Instructions undefined (type *openai.TtsRequestTextVoice15a214fc has no field or method Instructions)
testdata/invalidopenai/invalid.go:6:67: request.IncludeUsage undefined (type *openai.TtsRequestTextVoice15a214fc has no field or method IncludeUsage)
testdata/invalidopenai/invalid.go:7:75: cannot use openai.TtsRequestTextVoicef51a0f7eVoiceAsCedar{} (value of struct type openai.TtsRequestTextVoicef51a0f7eVoiceAsCedar) as openai.TtsRequestTextVoice15a214fcVoice value in assignment: openai.TtsRequestTextVoicef51a0f7eVoiceAsCedar does not implement openai.TtsRequestTextVoice15a214fcVoice (missing method isTtsRequestTextVoice15a214fcVoice)
testdata/invalidopenai/invalid.go:8:76: cannot use openai.TtsRequestTextVoice15a214fcModelAsTts1{} (value of struct type openai.TtsRequestTextVoice15a214fcModelAsTts1) as openai.TtsRequestTextVoicef51a0f7eModel value in assignment: openai.TtsRequestTextVoice15a214fcModelAsTts1 does not implement openai.TtsRequestTextVoicef51a0f7eModel (missing method isTtsRequestTextVoicef51a0f7eModel)
testdata/invalidopenai/invalid.go:9:80: request.SampleRateHz undefined (type *openai.TtsRequestTextVoice15a214fcOutputObject has no field or method SampleRateHz)
testdata/invalidopenai/invalid.go:10:98: cannot use text (variable of type <-chan string) as string value in assignment
`);

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
request = dict(required_nullable=None, bytes=b"audio", empty=(), integer=10**1000, fractional_literal=0.25,
    escaped_literal=bytes([92, 117, 48, 48, 48, 48, 0]).decode(), items=[None, "hello"], text=Input())
check = validate_request(request)
check("hello")
check({"command": "clear"})
for value in [None, False, True]: validate_request({**request, "optional": value})
for key, value in [("integer", True), ("integer", 1.5), ("bytes", bytearray(b"audio")),
    ("required_nullable", False), ("fractional_literal", 0.5), ("items", [False]), ("forbidden", None), ("empty", [None])]:
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
        bytes: vec![1], empty: [], integer: "1234567890123456789012345678901234567890".parse().unwrap(),
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
  run("python3", ["-c", `import sys; from typing import get_args; sys.path.insert(0, ${JSON.stringify(temporary)}); import fixture; assert fixture.TtsRequest.__optional_keys__ == frozenset({"optional"}); assert fixture.TtsRequest.__required_keys__ == frozenset({"required_nullable", "bytes", "empty", "integer", "fractional_literal", "escaped_literal", "items", "text"}); assert fixture.TtsRequestFractionalLiteral.VALUE.value == 0.25; assert get_args(fixture.TtsRequestEscapedLiteral.__value__) == (bytes([92, 117, 48, 48, 48, 48, 0]).decode(),)`], python);
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log("Rust, Python and Go compile; all generated validator parity checks, HTTP lifecycle tests, shared SSE/provider fixtures, native WebSockets/gRPC, output streams, runtime primitives, uncommon schema shapes and expected type errors pass.");
