import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, validateQuestions, buildPrompts } from "../supabase/functions/exam-quiz/logic.ts";

test("extractJson handles fences and chatter", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":2} hope it helps'), { a: 2 });
  assert.throws(() => extractJson("no json here"));
});

test("validateQuestions keeps good questions and drops broken ones", () => {
  const q = validateQuestions({
    cover: [{ front: "Ion", back: "Geladenes Teilchen" }, { front: "x", back: "x" }, { front: "", back: "y" }],
    match: [
      { pairs: [{ term: "a", match: "1" }, { term: "b", match: "2" }, { term: "c", match: "3" }] },
      { pairs: [{ term: "a", match: "1" }, { term: "a", match: "2" }, { term: "c", match: "3" }] },
      { pairs: [{ term: "a", match: "1" }, { term: "b", match: "1" }, { term: "c", match: "3" }] },
      { pairs: [{ term: "a", match: "1" }] },
    ],
    choice: [
      { question: "Q1?", options: ["A", "B", "C", "D"], answer: 2, explain: "because" },
      { question: "Q2?", options: ["A", "B", "C", "D"], answer: 7 },
      { question: "Q3?", options: ["A", "A", "C"], answer: 0 },
      { question: "Q4?", options: ["A", "B"], answer: 0 },
    ],
  });
  assert.deepEqual(q.map((x) => x.kind), ["cover", "match", "choice"]);
  assert.equal(q[2].payload.answer, 2);
});

test("validateQuestions removes duplicate questions and survives junk", () => {
  assert.deepEqual(validateQuestions(null), []);
  assert.deepEqual(validateQuestions({ cover: "nope", match: 5, choice: {} }), []);
  const q = validateQuestions({ cover: [{ front: "Same", back: "1" }, { front: "same", back: "2" }] });
  assert.equal(q.length, 1);
});

test("prompts: three small parts, only the given notes, capped length", () => {
  const ps = buildPrompts("Chemie", "x".repeat(9000));
  assert.deepEqual(ps.map((p) => p.part), ["cover", "match", "choice"]);
  for (const p of ps) {
    assert.ok(p.user.includes("Chemie"));
    assert.ok(p.user.length < 6100);
    assert.ok(p.system.includes("ONLY the topic notes"));
  }
  assert.ok(ps[1].system.includes('"match"') && !ps[1].system.includes('"choice"'));
});

import { daysUntil, examsToPing, buildPingText } from "../supabase/functions/exam-ping/logic.ts";

test("exam-ping: window is today..+7, never past exams", () => {
  const exams = [
    { subject: "A", exam_date: "2026-11-09" }, { subject: "B", exam_date: "2026-11-10" },
    { subject: "C", exam_date: "2026-11-17" }, { subject: "D", exam_date: "2026-11-18" },
  ];
  assert.deepEqual(examsToPing(exams, "2026-11-10").map((e) => e.subject), ["B", "C"]);
  assert.equal(daysUntil("2026-11-30", "2026-12-02"), 2);
});

test("exam-ping: text says what to do next and handles no exams", () => {
  assert.equal(buildPingText([], "evening"), "");
  const t = buildPingText([
    { subject: "Physik", exam_date: "x", days: 0, questionCount: 5 },
    { subject: "Chemie", exam_date: "x", days: 1, topics: "Salze", questionCount: 0 },
    { subject: "Mathe", exam_date: "x", days: 4, topics: "", questionCount: 0 },
  ], "evening");
  assert.match(t, /^Evening quiz/);
  assert.match(t, /Physik test TODAY · quiz is ready/);
  assert.match(t, /Chemie test tomorrow · tap to make your quiz/);
  assert.match(t, /Mathe test in 4 days · add your topics/);
});
