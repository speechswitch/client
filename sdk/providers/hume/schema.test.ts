import assert from "node:assert/strict";
import { test } from "bun:test";
import { validateRequest } from "../../generated/validators/hume.ts";

const single = { model: "octave-2", voice: "saved", output: { format: "pcm" }, text: "Hello" } as const;
const dialogue = { model: "octave-2", output: { format: "pcm" }, speakers: [{ alias: "a", voice: "saved" }], turns: [{ speaker: "a", text: "Hello" }] } as const;
async function* text() { yield "Hello"; }
async function* turns() { yield { speaker: "a", text: "Hello" }; }

test.each(["octave-1", "octave-2"] as const)("Hume schema owns %s continuation cardinality for text and dialogue", model => {
  for (const request of [{ ...single, model }, { ...single, model, text: text() }, { ...dialogue, model }, { ...dialogue, model, turns: turns() }]) {
    assert.equal(typeof validateRequest({ ...request, contextBefore: { requestIds: ["generation"] } }), "function");
    for (const requestIds of [[], ["first", "second"], Array(1)]) {
      assert.throws(() => validateRequest({ ...request, contextBefore: { requestIds } }), TypeError);
    }
  }
});

test.each(["octave-1", "octave-2"] as const)("Hume schema owns %s dialogue collection bounds and non-empty aliases", model => {
  const request = { ...dialogue, model };
  assert.equal(typeof validateRequest(request), "function");
  assert.equal(typeof validateRequest({ ...request, contextBefore: { turns: request.turns } }), "function");
  for (const fields of [
    { speakers: [] }, { speakers: Array(1) }, { speakers: [{ alias: "", voice: "saved" }] }, { speakers: [{ alias: "", voiceName: "Saved" }] },
    { turns: [] }, { turns: Array(1) }, { contextBefore: { turns: [] } }, { contextBefore: { turns: Array(1) } },
  ]) assert.throws(() => validateRequest({ ...request, ...fields }), TypeError);
  assert.throws(() => validateRequest({ ...request, turns: turns(), speakers: [] }), TypeError);
});
