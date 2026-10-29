import test from "node:test";
import assert from "node:assert/strict";
import { pickLang, cleanText, voiceInstructions, makeBase64Joiner, audioFromSseLine, wavFromPcm, MAX_TEXT_CHARS } from "../supabase/functions/quiz-voice/logic.ts";

test("language and text are sanitised", () => {
  assert.equal(pickLang("nl-NL"), "nl-NL");
  assert.equal(pickLang("fr-FR"), "de-DE");
  assert.equal(cleanText("  Hallo \n  Welt  "), "Hallo Welt");
  assert.equal(cleanText("x".repeat(5000)).length, MAX_TEXT_CHARS);
  assert.equal(cleanText(null), "");
});

test("instructions make the voice lively but read the text verbatim", () => {
  const t = voiceInstructions("de-DE");
  assert.match(t, /upbeat/); assert.match(t, /word for word/); assert.match(t, /German/);
});

test("base64 joiner survives pieces cut at any point", () => {
  const bytes = Uint8Array.from({ length: 1001 }, (_, i) => (i * 7) % 256);
  const b64 = Buffer.from(bytes).toString("base64");
  for (const size of [1, 2, 3, 5, 64, 77, 1000]) {
    const j = makeBase64Joiner();
    for (let i = 0; i < b64.length; i += size) j.push(b64.slice(i, i + size));
    assert.deepEqual(Buffer.from(j.finish()), Buffer.from(bytes), "piece size " + size);
  }
  // independently padded pieces also work
  const a = Buffer.from([1, 2, 3, 4]).toString("base64"), b = Buffer.from([5, 6, 7, 8, 9]).toString("base64");
  const j = makeBase64Joiner(); j.push(a); j.push(b);
  assert.deepEqual([...j.finish()], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("sse lines: audio, errors, noise", () => {
  assert.deepEqual(audioFromSseLine('data: {"choices":[{"delta":{"audio":{"data":"AAAA"}}}]}'), { data: "AAAA" });
  assert.deepEqual(audioFromSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}'), {});
  assert.deepEqual(audioFromSseLine("data: [DONE]"), {});
  assert.deepEqual(audioFromSseLine(": keep-alive"), {});
  assert.equal(audioFromSseLine('data: {"error":{"message":"out of credits"}}').error, "out of credits");
  assert.deepEqual(audioFromSseLine("data: {broken"), {});
});

test("wav header is valid", () => {
  const pcm = new Uint8Array(4800);
  const wav = wavFromPcm(pcm);
  const dv = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + 4800);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(dv.getUint32(24, true), 24000);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), 4800);
  assert.equal(dv.getUint32(4, true), 36 + 4800);
});
