// exam-quiz: turns the topic notes of one exam into quiz questions with the AI and stores them.
// Slow AI models used to outlast the phone's patience ("Load failed"), so this answers at once, keeps working in the
// background and reports progress through exams.quiz_state ('working' -> 'done' | 'error'). The admin page polls that.
// Row-level security decides who may read/write, so anyone who is not the owner simply sees "exam not found".
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPrompts, extractJson, validateQuestions } from "./logic.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function askModel(apiKey: string, p: { system: string; user: string }): Promise<any> {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Kxko Exam Quiz" },
        body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }], temperature: 0.4, max_tokens: 2500, stream: false }),
        signal: AbortSignal.timeout(100000),
      });
      if (!response.ok) throw new Error(`AI service answered HTTP ${response.status}`);
      const data = await response.json();
      let content = data?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) content = content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("");
      if (!content) throw new Error("AI returned nothing");
      return extractJson(String(content));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await sleep(2500);
    }
  }
  throw new Error(lastError);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return json({ success: false, error: "Only POST is supported." }, 405);
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(auth)) return json({ success: false, error: "Sign in first." }, 401);
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY secret.");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });

    const body = await req.json().catch(() => ({}));
    const examId = String(body?.exam_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(examId)) return json({ success: false, error: "exam_id is missing." }, 400);

    const { data: exam, error: examError } = await supabase.from("exams").select("id, subject, topics, quiz_state, quiz_started_at").eq("id", examId).maybeSingle();
    if (examError) throw new Error("Could not load the exam: " + examError.message);
    if (!exam) return json({ success: false, error: "Exam not found." }, 404);
    if (!String(exam.topics ?? "").trim()) return json({ success: false, error: "Add topic notes to this exam first. The AI only quizzes what is written there." }, 400);
    const busyFor = exam.quiz_started_at ? Date.now() - Date.parse(exam.quiz_started_at) : Infinity;
    if (exam.quiz_state === "working" && busyFor < 3 * 60 * 1000) return json({ success: true, started: false, message: "Already working on it." });

    const mark = (state: string, message = "") => supabase.from("exams").update({ quiz_state: state, quiz_message: message }).eq("id", examId);
    const start = await supabase.from("exams").update({ quiz_state: "working", quiz_message: "", quiz_started_at: new Date().toISOString() }).eq("id", examId);
    if (start.error) throw new Error("Could not start: " + start.error.message);

    const work = (async () => {
      try {
        const parts = await Promise.allSettled(buildPrompts(exam.subject, exam.topics).map((p) => askModel(apiKey, p)));
        const merged: any = {};
        const failed: string[] = [];
        parts.forEach((r, i) => {
          if (r.status === "fulfilled") Object.assign(merged, r.value);
          else failed.push(r.reason?.message ?? "failed");
        });
        const questions = validateQuestions(merged);
        if (questions.length === 0) throw new Error(failed[0] ? `The AI did not answer (${failed[0]}). Try again in a minute.` : "The AI answer had no usable questions. Add more detail to the topic notes and try again.");
        if (body?.replace === true) await supabase.from("exam_questions").delete().eq("exam_id", examId);
        const insert = await supabase.from("exam_questions").insert(questions.map((q) => ({ exam_id: examId, kind: q.kind, payload: q.payload })));
        if (insert.error) throw new Error("Could not save the questions: " + insert.error.message);
        await mark("done", `${questions.length} questions added.` + (failed.length ? ` (${failed.length} of 3 parts failed, run it again for more.)` : ""));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("EXAM QUIZ ERROR:", message);
        await mark("error", message.slice(0, 300));
      }
    })();
    // @ts-ignore EdgeRuntime exists in the Supabase edge runtime
    EdgeRuntime.waitUntil(work);
    return json({ success: true, started: true }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("EXAM QUIZ ERROR:", message);
    return json({ success: false, error: message }, 500);
  }
});
