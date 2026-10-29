// quiz-voice: turns a quiz sentence into lively spoken audio (WAV) for the Cycling Quiz in the Android app.
// Only the owner may call it (checked with the database function is_owner() using the caller's own login).
// Provider: a real OpenAI key in OPENAI_TTS_KEY uses OpenAI's speech model; otherwise OpenRouter's audio model is used
// with the OPENROUTER_API_KEY / OPENAI_API_KEY secret (OpenRouter needs at least $0.50 credit for audio).
// On any problem the app falls back to the phone's own voice, so this answers 503 with a short reason instead of failing hard.
import { createClient } from "npm:@supabase/supabase-js@2";
import { audioFromSseLine, cleanText, makeBase64Joiner, pickLang, voiceInstructions, wavFromPcm } from "./logic.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const OPENROUTER_AUDIO_MODEL = "openai/gpt-audio-mini";
const VOICE = "coral";

async function viaOpenAi(key: string, text: string, instructions: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: VOICE, input: text, instructions, response_format: "wav" }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function viaOpenRouter(key: string, text: string, instructions: string): Promise<Uint8Array> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Kxko Cycling Quiz Voice" },
    body: JSON.stringify({
      model: OPENROUTER_AUDIO_MODEL, stream: true, modalities: ["text", "audio"], audio: { voice: VOICE, format: "pcm16" },
      messages: [{ role: "system", content: instructions }, { role: "user", content: text }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(res.status === 402 ? "credits" : `openrouter ${res.status}`);
  const joiner = makeBase64Joiner();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const part = audioFromSseLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (part.error) throw new Error(part.error.toLowerCase().includes("credit") ? "credits" : "openrouter " + part.error);
      if (part.data) joiner.push(part.data);
    }
  }
  const pcm = joiner.finish();
  if (pcm.length < 2000) throw new Error("no audio");
  return wavFromPcm(pcm);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return json({ error: "Only POST is supported." }, 405);
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: "Sign in first." }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const owner = await supabase.rpc("is_owner");
    if (owner.error || owner.data !== true) return json({ error: "Not allowed." }, 403);

    const body = await req.json().catch(() => ({}));
    const text = cleanText(body?.text);
    if (!text) return json({ error: "No text." }, 400);
    const instructions = voiceInstructions(pickLang(body?.lang));

    const openAiKey = Deno.env.get("OPENAI_TTS_KEY");
    const routerKey = Deno.env.get("OPENROUTER_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
    let wav: Uint8Array;
    if (openAiKey) wav = await viaOpenAi(openAiKey, text, instructions);
    else if (routerKey) wav = await viaOpenRouter(routerKey, text, instructions);
    else return json({ error: "voice_unavailable", reason: "no voice key configured" }, 503);

    return new Response(wav, { status: 200, headers: { ...cors, "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("QUIZ VOICE ERROR:", message);
    return json({ error: "voice_unavailable", reason: message.slice(0, 120) }, 503);
  }
});
