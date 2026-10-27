// logic.ts — pure helpers for the exam quiz (no Deno / Supabase APIs, so plain Node can test them).

export type CoverQ = { kind: "cover"; payload: { front: string; back: string } };
export type MatchQ = { kind: "match"; payload: { pairs: Array<{ term: string; match: string }> } };
export type ChoiceQ = { kind: "choice"; payload: { question: string; options: string[]; answer: number; explain: string } };
export type Question = CoverQ | MatchQ | ChoiceQ;

const clean = (value: unknown, max: number): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Pull the first JSON object out of a model answer (it may be wrapped in ``` fences or chatter). */
export function extractJson(text: string): any {
  const stripped = String(text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last <= first) throw new Error("The AI did not return JSON.");
  try { return JSON.parse(stripped.slice(first, last + 1)); } catch { throw new Error("The AI returned malformed JSON."); }
}

/** Keep only well-formed questions. Anything odd is dropped, never repaired by guessing. */
export function validateQuestions(raw: any): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  const push = (q: Question, key: string) => { const k = key.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(q); } };

  for (const item of Array.isArray(raw?.cover) ? raw.cover : []) {
    const front = clean(item?.front, 300), back = clean(item?.back, 500);
    if (front && back && front.toLowerCase() !== back.toLowerCase()) push({ kind: "cover", payload: { front, back } }, "c:" + front);
  }

  for (const set of Array.isArray(raw?.match) ? raw.match : []) {
    const pairs = (Array.isArray(set?.pairs) ? set.pairs : Array.isArray(set) ? set : [])
      .map((p: any) => ({ term: clean(p?.term, 80), match: clean(p?.match, 120) }))
      .filter((p: any) => p.term && p.match);
    const terms = new Set(pairs.map((p: any) => p.term.toLowerCase()));
    const matches = new Set(pairs.map((p: any) => p.match.toLowerCase()));
    // a matching game needs every term and every answer to be unique, otherwise it has two right answers
    if (pairs.length >= 3 && pairs.length <= 6 && terms.size === pairs.length && matches.size === pairs.length) {
      push({ kind: "match", payload: { pairs } }, "m:" + pairs.map((p: any) => p.term).join("|"));
    }
  }

  for (const item of Array.isArray(raw?.choice) ? raw.choice : []) {
    const question = clean(item?.question, 400);
    const options = (Array.isArray(item?.options) ? item.options : []).map((o: unknown) => clean(o, 200)).filter(Boolean);
    const answer = Number(item?.answer);
    const distinct = new Set(options.map((o: string) => o.toLowerCase())).size === options.length;
    if (question && options.length >= 3 && options.length <= 5 && distinct && Number.isInteger(answer) && answer >= 0 && answer < options.length) {
      push({ kind: "choice", payload: { question, options, answer, explain: clean(item?.explain, 400) } }, "q:" + question);
    }
  }
  return out;
}

const RULES = [
  "You write revision questions for a German school student (class 10, Realschule/Gesamtschule level).",
  "Use ONLY the topic notes the student gives you. Never add facts that are not in the notes.",
  "Write in the same language as the notes (German notes -> German questions, Spanish vocabulary -> Spanish/German as in the notes).",
  "Return ONLY valid JSON, no explanations, in exactly the shape below. Keep everything short.",
];

/** Three small prompts instead of one big one: they run in parallel, so a slow model finishes sooner. */
export function buildPrompts(subject: string, topics: string): Array<{ part: "cover" | "match" | "choice"; system: string; user: string }> {
  const user = `Subject: ${subject}\n\nTopic notes:\n${topics.slice(0, 6000)}`;
  const shapes = {
    cover: ['{"cover":[{"front":"question or term","back":"answer"}]}', "Give 10 cards."],
    match: ['{"match":[{"pairs":[{"term":"...","match":"..."}]}]}', "Give 2 sets of 5 pairs. Every term and every match must be unique."],
    choice: ['{"choice":[{"question":"...","options":["...","...","...","..."],"answer":0,"explain":"one short sentence"}]}', "Give 8 questions with 4 options each. answer is the 0-based index of the correct option."],
  } as const;
  return (Object.keys(shapes) as Array<keyof typeof shapes>).map((part) => ({
    part, user, system: [...RULES, "Shape: " + shapes[part][0], shapes[part][1]].join("\n"),
  }));
}
