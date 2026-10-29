// logic.ts — pure helpers for quiz-voice (no Deno APIs, so plain Node can test them).

export const MAX_TEXT_CHARS = 1200;
export const SAMPLE_RATE = 24000;

export type Lang = "de-DE" | "nl-NL" | "en-GB";
const LANGS: Record<string, { name: string; hint: string }> = {
  "de-DE": { name: "German", hint: "Sprich natürliches, lebendiges Deutsch." },
  "nl-NL": { name: "Dutch", hint: "Spreek natuurlijk, levendig Nederlands." },
  "en-GB": { name: "British English", hint: "Speak natural, lively British English." },
};

/** Only known languages are accepted; anything else falls back to German. */
export function pickLang(value: unknown): Lang {
  const v = String(value ?? "");
  return (v in LANGS ? v : "de-DE") as Lang;
}

/** Trim, collapse spaces, cap the length. Returns "" when there is nothing to say. */
export function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

/** Style instructions: lively quiz host, reads the text exactly. */
export function voiceInstructions(lang: Lang): string {
  return [
    `You are the voice of a friendly, upbeat quiz host for a teenager who is cycling. Language: ${LANGS[lang].name}. ${LANGS[lang].hint}`,
    "Sound alive: warm, smiling, natural rhythm, light energy, small pauses between the answer options. Celebrate right answers, be kind and encouraging on wrong ones.",
    "Read ONLY the given text, word for word. Do not add, translate, explain or answer anything yourself.",
  ].join(" ");
}

/** Decode base64 pieces of an audio stream into bytes. Pieces may be cut anywhere, so leftovers are carried over. */
export function makeBase64Joiner() {
  let carry = "";
  const out: Uint8Array[] = [];
  const decode = (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
  return {
    push(piece: string) {
      const all = carry + piece;
      const usable = all.length - (all.length % 4);
      if (usable > 0) out.push(decode(all.slice(0, usable)));
      carry = all.slice(usable);
    },
    finish(): Uint8Array {
      if (carry) { out.push(decode(carry.padEnd(Math.ceil(carry.length / 4) * 4, "="))); carry = ""; }
      const total = out.reduce((n, c) => n + c.length, 0);
      const joined = new Uint8Array(total);
      let at = 0;
      for (const c of out) { joined.set(c, at); at += c.length; }
      return joined;
    },
  };
}

/** Read audio pieces out of a server-sent-events text stream (OpenRouter chat completions with audio output). */
export function audioFromSseLine(line: string): { data?: string; error?: string } {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:") || trimmed.includes("[DONE]")) return {};
  try {
    const json = JSON.parse(trimmed.slice(5));
    if (json?.error) return { error: String(json.error?.message ?? "audio error").slice(0, 200) };
    const data = json?.choices?.[0]?.delta?.audio?.data;
    return typeof data === "string" && data ? { data } : {};
  } catch {
    return {};
  }
}

/** Wrap raw 16-bit mono PCM in a WAV header so any media player can play it. */
export function wavFromPcm(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
