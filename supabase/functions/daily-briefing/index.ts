// @ts-nocheck
import {
  aiEvent,
  candidateRepair,
  buildAiPayload,
  checkComponentData,
  classifyError,
  componentEvents,
  findingToEvent,
  alreadyPushed,
  inspectBriefing,
  isSafePushRetry,
  runStatus,
  runSummary,
  safetyGate,
  saveRun,
  truncateToBytes,
  validateAiVerdict,
  withRetry,
} from "./selfcheck.ts";

const SUPABASE_URL = "https://ggewdpazpeoielbqrcgm.supabase.co";
const UNTIS_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/untis-test`;
const AI_DEBUGGER_URL = `${SUPABASE_URL}/functions/v1/ai-debugger`;

// Callers (the pg_cron jobs) must send header x-cron-secret. Only its SHA-256 is stored here.
// The placeholder below is deliberate: this repository is PUBLIC, so the real hash is never committed.
// When deploying, replace the placeholder with the hash of the live function (copy it from the deployed version).
const CRON_SECRET_SHA256 = "REPLACE_WITH_LIVE_CRON_SECRET_SHA256";

async function authorized(req: Request): Promise<boolean> {
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!given) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(given));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  let diff = hex.length ^ CRON_SECRET_SHA256.length;
  for (let i = 0; i < hex.length && i < CRON_SECRET_SHA256.length; i++) diff |= hex.charCodeAt(i) ^ CRON_SECRET_SHA256.charCodeAt(i);
  return diff === 0;
}

/* SELF-CHECK: every outgoing request gets a timeout so one hung service cannot stall the whole run. */
const REQUEST_TIMEOUT_MS = 20000;
function fetchT(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/* untis-test and ai-debugger only answer callers that present the project's own server key. */
function internalHeaders(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/* DATE */
function parseDate(dateText: string): Date {
  if (!/^\d{8}$/.test(dateText)) throw new Error("date must be YYYYMMDD");
  return new Date(Number(dateText.slice(0, 4)), Number(dateText.slice(4, 6)) - 1, Number(dateText.slice(6, 8)));
}
function dateKey(date: Date): string {
  return String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
}
function formatDate(dateText: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(parseDate(dateText));
}

/* WEATHER */
function weatherDescription(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorms";
  return "Unknown";
}
function formatHour(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" }).format(new Date(value));
}
function getRainPeriods(times: string[], probabilities: number[]): string[] {
  const periods: string[] = [];
  let periodStart: string | null = null;
  let lastRainIndex = -1;
  const endOf = (i: number) => {
    const d = new Date(times[i]);
    d.setHours(d.getHours() + 1);
    return formatHour(d.toISOString());
  };
  for (let i = 0; i < times.length; i++) {
    const raining = Number(probabilities[i] ?? 0) >= 30;
    if (raining) {
      if (periodStart === null) periodStart = formatHour(times[i]);
      lastRainIndex = i;
    } else if (periodStart !== null) {
      periods.push(`${periodStart}–${endOf(lastRainIndex)}`);
      periodStart = null;
      lastRainIndex = -1;
    }
  }
  if (periodStart !== null && lastRainIndex >= 0) periods.push(`${periodStart}–${endOf(lastRainIndex)}`);
  return periods;
}
async function getWeather(targetDate: Date) {
  const isoDate = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
  const weatherUrl = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: "50.60", longitude: "8.80",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max",
    hourly: "precipitation_probability", timezone: "Europe/Berlin", start_date: isoDate, end_date: isoDate,
  }).toString();
  const response = await fetchT(weatherUrl);
  const text = await response.text();
  if (!response.ok) throw new Error(`Weather API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  if (!json.daily) throw new Error("Weather API returned no daily data.");
  const hourlyTimes = Array.isArray(json.hourly?.time) ? json.hourly.time : [];
  const hourlyRain = Array.isArray(json.hourly?.precipitation_probability) ? json.hourly.precipitation_probability : [];
  return {
    todayWeatherCode: json.daily.weather_code?.[0] ?? -1,
    todayLow: json.daily.temperature_2m_min?.[0] ?? null,
    todayHigh: json.daily.temperature_2m_max?.[0] ?? null,
    rainProbability: json.daily.precipitation_probability_max?.[0] ?? null,
    windSpeed: json.daily.wind_speed_10m_max?.[0] ?? null,
    rainPeriods: getRainPeriods(hourlyTimes, hourlyRain),
  };
}

/* UNTIS */
async function getUntisData(dateText: string): Promise<any> {
  const response = await fetchT(`${UNTIS_FUNCTION_URL}?date=${encodeURIComponent(dateText)}`, { headers: internalHeaders() });
  const text = await response.text();
  if (!response.ok) throw new Error(`untis-test returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error("untis-test returned invalid JSON: " + text.slice(0, 500)); }
}
function getTimetable(data: any): any[] {
  if (Array.isArray(data?.timetable)) return data.timetable;
  if (Array.isArray(data?.lessons)) return data.lessons;
  if (Array.isArray(data?.data?.timetable)) return data.data.timetable;
  if (Array.isArray(data?.data?.lessons)) return data.data.lessons;
  return [];
}

/* HOMEWORK */
function getHomework(data: any, timetable: any[]): any[] {
  for (const source of [data?.homework, data?.homeworks, data?.data?.homework, data?.data?.homeworks]) {
    if (Array.isArray(source)) return source;
  }
  const out: any[] = [];
  for (const lesson of timetable) {
    const homework = lesson?.homework ?? lesson?.homeworks ?? lesson?.tasks;
    if (Array.isArray(homework)) {
      for (const item of homework) {
        out.push({ ...item, subject: item?.subject ?? lesson?.subject ?? lesson?.actual ?? lesson?.expected ?? "" });
      }
    }
  }
  return out;
}
function getHomeworkText(homework: any): string {
  if (typeof homework === "string") return homework.trim();
  return String(homework?.text ?? homework?.description ?? homework?.title ?? homework?.name ?? homework?.task ?? "").trim();
}
function getHomeworkSubject(homework: any): string {
  return String(homework?.subject ?? homework?.subjectName ?? homework?.subject?.name ?? "").trim();
}

/* GOOGLE CALENDAR */
async function getGoogleCalendarEvents(targetDate: Date): Promise<any[]> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google Calendar secrets. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN");
  }
  const tokenResponse = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  const tokenText = await tokenResponse.text();
  let tokenData: any;
  try { tokenData = JSON.parse(tokenText); } catch { throw new Error(`Google token endpoint returned invalid JSON: ${tokenText.slice(0, 500)}`); }
  if (!tokenResponse.ok) {
    throw new Error(`Google token refresh failed: HTTP ${tokenResponse.status} ${tokenData?.error ?? "unknown_error"}: ${tokenData?.error_description ?? "No error description provided."}`);
  }
  const accessToken = tokenData?.access_token;
  if (!accessToken) throw new Error("Google did not return an access token.");
  const y = targetDate.getFullYear(), m = targetDate.getMonth(), d = targetDate.getDate();
  const calendarUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + new URLSearchParams({
    timeMin: new Date(y, m, d, 0, 0, 0).toISOString(),
    timeMax: new Date(y, m, d + 1, 0, 0, 0).toISOString(),
    singleEvents: "true", orderBy: "startTime", maxResults: "100",
  }).toString();
  const calendarResponse = await fetchT(calendarUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const calendarText = await calendarResponse.text();
  let calendarData: any;
  try { calendarData = JSON.parse(calendarText); } catch { throw new Error(`Google Calendar API returned invalid JSON: ${calendarText.slice(0, 500)}`); }
  if (!calendarResponse.ok) throw new Error("Google Calendar API failed: " + (calendarData?.error?.message ?? `HTTP ${calendarResponse.status}`));
  return Array.isArray(calendarData?.items) ? calendarData.items : [];
}

/* ISERV EXAMS */
function unfoldICS(text: string): string { return text.replace(/\r?\n[ \t]/g, ""); }
function icsValue(block: string, field: string): string | null {
  for (const line of block.split("\n")) {
    if (line.startsWith(field + ":") || line.startsWith(field + ";")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      return line.slice(colon + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").replace(/\\n/g, "\n").trim();
    }
  }
  return null;
}
function parseICSDate(value: string): Date | null {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) return new Date(Number(clean.slice(0, 4)), Number(clean.slice(4, 6)) - 1, Number(clean.slice(6, 8)));
  if (/^\d{8}T\d{6}Z$/.test(clean)) {
    return new Date(Date.UTC(Number(clean.slice(0, 4)), Number(clean.slice(4, 6)) - 1, Number(clean.slice(6, 8)), Number(clean.slice(9, 11)), Number(clean.slice(11, 13)), Number(clean.slice(13, 15))));
  }
  if (/^\d{8}T\d{6}$/.test(clean)) {
    return new Date(Number(clean.slice(0, 4)), Number(clean.slice(4, 6)) - 1, Number(clean.slice(6, 8)), Number(clean.slice(9, 11)), Number(clean.slice(11, 13)), Number(clean.slice(13, 15)));
  }
  return null;
}
async function getIservExams(targetDate: Date): Promise<any[]> {
  const examUrl = Deno.env.get("ISERV_EXAM_CALENDAR_URL");
  if (!examUrl) throw new Error("Missing ISERV_EXAM_CALENDAR_URL secret.");
  const response = await fetchT(examUrl);
  const text = await response.text();
  if (!response.ok) throw new Error(`IServ returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("IServ exam calendar did not return ICS data.");
  const blocks = unfoldICS(text).split("BEGIN:VEVENT");
  const wanted = dateKey(targetDate);
  const exams: any[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const startValue = icsValue(block, "DTSTART");
    if (!startValue) continue;
    const start = parseICSDate(startValue);
    if (!start) continue;
    if (dateKey(start) !== wanted) continue;
    exams.push({
      title: icsValue(block, "SUMMARY") || "Exam",
      start: start.toISOString(),
      description: icsValue(block, "DESCRIPTION") || "",
      location: icsValue(block, "LOCATION") || "",
    });
  }
  return exams;
}

/* CALENDAR TIME */
function formatCalendarTime(start: string | null, allDay: boolean): string {
  if (!start) return "";
  if (allDay) return "All day";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" }).format(new Date(start));
}

/* REQUEST COUNTS */
async function getRequestCounts() {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // SELF-CHECK: this used to warn and silently report 0 requests. Now it fails visibly so it is logged.
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY secret.");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const [pendingResponse, inProgressResponse] = await Promise.all([
    fetchT(`${SUPABASE_URL}/rest/v1/requests?select=id&status=eq.Pending`, { headers }),
    fetchT(`${SUPABASE_URL}/rest/v1/requests?select=id&status=eq.In%20Progress`, { headers }),
  ]);
  if (!pendingResponse.ok) throw new Error(`Could not load pending requests: HTTP ${pendingResponse.status}`);
  if (!inProgressResponse.ok) throw new Error(`Could not load in-progress requests: HTTP ${inProgressResponse.status}`);
  const pending = await pendingResponse.json();
  const inProgress = await inProgressResponse.json();
  return { pending: Array.isArray(pending) ? pending.length : 0, inProgress: Array.isArray(inProgress) ? inProgress.length : 0 };
}

/* BRIEFING */
function buildBriefing(dateText: string, weather: any, timetable: any[], calendarEvents: any[], exams: any[], homework: any[], requestCounts: { pending: number; inProgress: number }): string {
  const sections: string[] = [];
  sections.push(formatDate(dateText).toUpperCase());

  const weatherLines: string[] = [];
  weatherLines.push(weatherDescription(Number(weather?.todayWeatherCode ?? -1)));
  weatherLines.push(`${weather?.todayLow ?? "?"}–${weather?.todayHigh ?? "?"}°C | ${weather?.rainProbability ?? "?"}% rain | ${weather?.windSpeed ?? "?"} km/h`);
  const rainPeriods = Array.isArray(weather?.rainPeriods) ? weather.rainPeriods : [];
  weatherLines.push(rainPeriods.length > 0 ? `Rain: ${rainPeriods.join(", ")}` : "Rain: none expected");
  sections.push("WEATHER\n" + weatherLines.join("\n"));

  const changes = timetable.filter((lesson: any) => lesson?.cancelled || lesson?.changed);
  if (changes.length > 0) {
    const changeLines: string[] = [];
    for (const lesson of changes) {
      if (lesson?.cancelled) {
        changeLines.push(`${lesson?.time ?? "?"} ${lesson?.expected ?? lesson?.subject ?? "Lesson"} - ENTFALL`);
        continue;
      }
      if (lesson?.changed) {
        const subject = lesson?.expected ?? lesson?.subject ?? "Lesson";
        const substitute = lesson?.substituteTeacher ?? lesson?.teacher ?? "Unknown";
        changeLines.push(`${lesson?.time ?? "?"} ${subject} - VERTRETUNG ${substitute}`);
      }
    }
    sections.push("CHANGES\n" + changeLines.join("\n"));
  }

  if (homework.length > 0) {
    const homeworkLines: string[] = [];
    for (const item of homework) {
      const text = getHomeworkText(item);
      if (!text) continue;
      const subject = getHomeworkSubject(item);
      homeworkLines.push(subject ? `${subject}: ${text}` : text);
    }
    if (homeworkLines.length > 0) sections.push("HOMEWORK\n" + homeworkLines.join("\n"));
  }

  if (requestCounts.pending > 0 || requestCounts.inProgress > 0) {
    const requestLines: string[] = [];
    if (requestCounts.pending > 0) requestLines.push(`Pending requests: ${requestCounts.pending}`);
    if (requestCounts.inProgress > 0) requestLines.push(`In progress requests: ${requestCounts.inProgress}`);
    sections.push("REQUESTS\n" + requestLines.join("\n"));
  }

  if (exams.length > 0) {
    const examLines: string[] = [];
    for (const exam of exams) {
      const title = exam?.title ?? exam?.summary ?? exam?.name ?? "Exam";
      let time = "";
      if (exam?.start) {
        time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" }).format(new Date(exam.start));
      }
      let line = `${time ? time + " " : ""}${title}`;
      if (exam?.location) line += ` (${exam.location})`;
      examLines.push(line);
    }
    sections.push("EXAMS\n" + examLines.join("\n"));
  }

  if (calendarEvents.length > 0) {
    const calendarLines: string[] = [];
    for (const event of calendarEvents) {
      const start = event?.start?.dateTime ?? event?.start?.date ?? event?.start ?? null;
      const allDay = Boolean(event?.start?.date && !event?.start?.dateTime);
      const time = formatCalendarTime(start, allDay);
      let line = `${time || "All day"} ${event?.summary ?? event?.title ?? "Calendar event"}`;
      if (event?.location) line += ` (${event.location})`;
      calendarLines.push(line);
    }
    sections.push("CALENDAR\n" + calendarLines.join("\n"));
  }

  return sections.join("\n\n");
}

/* FIREBASE FCM */
function base64UrlEncode(input: Uint8Array | string): string {
  let binary = "";
  if (typeof input === "string") input = new TextEncoder().encode(input);
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const base64 = normalized.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function getFirebaseAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (!clientEmail || !privateKey) throw new Error("Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedJwt));
  const assertion = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;
  const response = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Firebase OAuth returned invalid JSON: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error("Firebase OAuth failed: " + JSON.stringify(data));
  if (!data.access_token) throw new Error("Google did not return an access token");
  return data.access_token;
}
async function sendFCM(message: string, preferences: { sound_mode?: string; vibration_enabled?: boolean } = {}): Promise<void> {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = await getFirebaseAccessToken();
  const response = await fetchT(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { topic: "Kxko-Daily-Briefing", data: { title: "Kxko Daily Briefing", body: message, sound_mode: preferences.sound_mode === "silent" ? "silent" : "loud", vibration_enabled: String(preferences.vibration_enabled !== false) } } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`FCM returned HTTP ${response.status}: ${text}`);
}

async function getScheduleNotificationSettings(scheduleId: string | null): Promise<{ sound_mode: string; vibration_enabled: boolean }> {
  const fallback = { sound_mode: "loud", vibration_enabled: true };
  if (!scheduleId) return fallback;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing Supabase service role key");
  const endpoint = SUPABASE_URL + "/rest/v1/briefing_schedules?id=eq." + encodeURIComponent(scheduleId) + "&select=sound_mode,vibration_enabled&limit=1";
  const response = await fetchT(endpoint, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });
  if (!response.ok) throw new Error("Could not load briefing notification settings: HTTP " + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("The scheduled briefing settings no longer exist");
  return { sound_mode: rows[0].sound_mode === "silent" ? "silent" : "loud", vibration_enabled: rows[0].vibration_enabled !== false };
}

/* COMPONENT RUNNER
   SELF-CHECK REPAIR "retry_component": transient failures (HTTP 429/5xx, timeouts, bad JSON) are retried up to 3 times.
   All five components only read data (untis-test only upserts its own lesson snapshots), so a retry is safe.
   Credential and configuration errors are never retried. */
async function runComponent<T>(name: string, fn: () => Promise<T>) {
  const started = Date.now();
  const result = await withRetry(fn, { attempts: 3, delayMs: 800 });
  if (result.ok) {
    return { name, success: true, data: result.value, durationMs: Date.now() - started, attempts: result.attempts, recovered: result.recovered, firstError: result.firstError };
  }
  console.error(`COMPONENT ERROR [${name}]:`, result.error);
  return { name, success: false, error: result.error, durationMs: Date.now() - started, attempts: result.attempts };
}

/* AI DEBUGGER
   SELF-CHECK: the payload now contains redacted metadata only (component names, redacted errors, finding summaries).
   The briefing text (your schedule, homework, calendar) is no longer sent to the third-party model. */
async function runAIDebugger(dateText: string, failedComponents: any[], allComponents: any[], events: any[]): Promise<any> {
  try {
    console.log("AI DEBUGGER: unresolved failure detected. Requesting diagnosis...");
    const response = await fetchT(AI_DEBUGGER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalHeaders() },
      // ai-debugger drops `problem` and `logs` into a text prompt, so they must be strings (objects print as "[object Object]").
      body: JSON.stringify((() => {
        const p: any = buildAiPayload({ dateKey: dateText, components: allComponents, findings: events });
        return { ...p, problem: JSON.stringify(p.problem), logs: JSON.stringify(p.logs) };
      })()),
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(`AI debugger returned invalid JSON: ${text.slice(0, 1000)}`); }
    if (!response.ok) throw new Error(`AI debugger returned HTTP ${response.status}: ${text.slice(0, 1000)}`);
    console.log("AI DEBUGGER RESULT:", JSON.stringify(data));
    return { triggered: true, success: true, result: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("AI DEBUGGER ERROR:", message);
    return { triggered: true, success: false, error: message };
  }
}

/* MAIN */
const JSON_HEADERS = { "Content-Type": "application/json" };

function componentForFinding(check: string): string {
  if (check.startsWith("untis")) return "webuntis";
  if (check.startsWith("weather")) return "weather";
  return "briefing";
}

/* UNTIS WATCH (runs every 10 minutes, ?mode=untis-watch)
   Only looks at the WebUntis timetable. untis-test compares it with the last stored snapshot and returns the lessons that
   changed. Nothing changed = nothing is sent and nothing is stored. A change = one short push and one dashboard entry. */
const WATCH_FAILED_TEXT = "Timetable check failed.";

function describeChange(c: any): string {
  const time = c?.time ?? "?";
  const subject = c?.expected ?? c?.subject ?? "Lesson";
  if (c?.type === "ENTFALL") return `${time} ${subject} - ENTFALL`;
  if (c?.type === "VERTRETUNG") return `${time} ${subject} - VERTRETUNG ${c?.teacher || "Unknown"}`;
  return `${time} ${subject} - back to normal`;
}

/* A broken WebUntis sync is recorded at most once an hour, so the dashboard is not flooded every 10 minutes. */
async function watchFailedRecently(cfg: { supabaseUrl: string; serviceKey?: string | null }): Promise<boolean> {
  if (!cfg.serviceKey) return false;
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await fetchT(`${cfg.supabaseUrl}/rest/v1/briefing_runs?select=id&briefing=eq.${encodeURIComponent(WATCH_FAILED_TEXT)}&run_at=gte.${encodeURIComponent(since)}&limit=1`,
      { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` } });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

async function untisWatch(dateKeyText: string): Promise<Response> {
  const cfg = { supabaseUrl: SUPABASE_URL, serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") };
  const untis = await runComponent("webuntis", () => getUntisData(dateKeyText));

  if (!untis.success) {
    if (await watchFailedRecently(cfg)) {
      return new Response(JSON.stringify({ success: false, mode: "untis-watch", changed: false, error: "WebUntis check failed (already recorded)." }), { status: 200, headers: JSON_HEADERS });
    }
    const events = componentEvents([untis]);
    const status = runStatus({ hasBriefing: true, pushSent: true, events });
    const saved = await saveRun(cfg, { date_key: dateKeyText, status, briefing: WATCH_FAILED_TEXT, components: [untis], push_sent: false, summary: runSummary(status, events) }, events);
    return new Response(JSON.stringify({ success: false, mode: "untis-watch", changed: false, saved }), { status: 200, headers: JSON_HEADERS });
  }

  const changes = Array.isArray(untis.data?.changes) ? untis.data.changes : [];
  if (changes.length === 0) {
    return new Response(JSON.stringify({ success: true, mode: "untis-watch", changed: false }), { status: 200, headers: JSON_HEADERS });
  }

  const text = "TIMETABLE CHANGE\n" + changes.map(describeChange).join("\n");
  const duplicate = await alreadyPushed(cfg, dateKeyText, text);
  const push = duplicate
    ? { ok: true, attempts: 0, recovered: false, firstError: undefined, error: undefined }
    : await withRetry(() => sendFCM(text), { attempts: 3, delayMs: 1500, isRetryable: isSafePushRetry });
  const fcm: any = push.ok
    ? { name: "firebase-fcm", success: true, attempts: push.attempts, recovered: push.recovered, firstError: push.firstError, skipped: duplicate || undefined }
    : { name: "firebase-fcm", success: false, error: push.error, attempts: push.attempts };
  const events: any[] = [
    { kind: "check", component: "webuntis", severity: "info", outcome: "ok",
      found: `${changes.length} timetable change(s) detected.`, action: duplicate ? "Already pushed earlier, nothing sent." : "Pushed a short timetable notice.", details: { changes: changes.length } },
    ...componentEvents([fcm]),
  ];
  const status = runStatus({ hasBriefing: true, pushSent: fcm.success, events });
  const saved = await saveRun(cfg, { date_key: dateKeyText, status, briefing: text, components: [untis, fcm], push_sent: Boolean(fcm.success), summary: runSummary(status, events) }, events);
  return new Response(JSON.stringify({ success: true, mode: "untis-watch", changed: true, pushed: Boolean(fcm.success), text, saved }), { status: 200, headers: JSON_HEADERS });
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) {
    return new Response(JSON.stringify({ success: false, error: "Not allowed." }), { status: 403, headers: JSON_HEADERS });
  }
  try {
    const url = new URL(req.url);
    const requestedDate = url.searchParams.get("date");
    const targetDate = requestedDate ? parseDate(requestedDate) : new Date();
    const targetDateKey = requestedDate ?? dateKey(targetDate);
    const notificationSettings = await getScheduleNotificationSettings(url.searchParams.get("schedule_id"));
    if (url.searchParams.get("mode") === "untis-watch") return await untisWatch(targetDateKey);

    const [untisResult, calendarResult, weatherResult, examsResult, requestResult] = await Promise.all([
      runComponent("webuntis", () => getUntisData(targetDateKey)),
      runComponent("google-calendar", () => getGoogleCalendarEvents(targetDate)),
      runComponent("weather", () => getWeather(targetDate)),
      runComponent("iserv-exams", () => getIservExams(targetDate)),
      runComponent("request-counts", () => getRequestCounts()),
    ]);

    const untisData = untisResult.success ? untisResult.data : {};
    const calendarEvents = calendarResult.success ? calendarResult.data : [];
    const weather = weatherResult.success ? weatherResult.data : {
      todayWeatherCode: -1, todayLow: null, todayHigh: null, rainProbability: null, windSpeed: null, rainPeriods: [],
    };
    const exams = examsResult.success ? examsResult.data : [];
    const requestCounts = requestResult.success ? requestResult.data : { pending: 0, inProgress: 0 };

    const timetable = getTimetable(untisData);
    const homework = getHomework(untisData, timetable);
    const builtBriefing = buildBriefing(targetDateKey, weather, timetable, calendarEvents, exams, homework, requestCounts);

    /* SELF-CHECK 1: inspect the text and apply the safe cosmetic repairs (sanitize / dedupe / shorten). */
    const inspected = inspectBriefing(builtBriefing);
    let briefing = inspected.text;
    const baseComponents = [untisResult, calendarResult, weatherResult, examsResult, requestResult];
    const dataFindings = checkComponentData({ dateKey: targetDateKey, components: baseComponents });

    /* SELF-CHECK 2: send the push; retry only on an explicit FCM server rejection (never risk a double push). */
    /* The same briefing is never pushed twice on one day: several scheduled checks (and manual retries) can run, but the
       phone is only notified when the text is new or the earlier push failed. */
    /* ?push=always (used by the 07:00 job) skips that rule so the second morning briefing always notifies the phone. */
    const forcePush = url.searchParams.get("push") === "always";
    const duplicatePush = !forcePush && await alreadyPushed(
      { supabaseUrl: SUPABASE_URL, serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }, targetDateKey, briefing);
    const push = duplicatePush
      ? { ok: true, attempts: 0, recovered: false, firstError: undefined, error: undefined }
      : await withRetry(() => sendFCM(briefing, notificationSettings), { attempts: 3, delayMs: 1500, isRetryable: isSafePushRetry });
    let fcmResult: any = push.ok
      ? { name: "firebase-fcm", success: true, attempts: push.attempts, recovered: push.recovered, firstError: push.firstError, skipped: duplicatePush || undefined }
      : { name: "firebase-fcm", success: false, error: push.error, attempts: push.attempts };
    if (!push.ok) console.error("FCM ERROR:", push.error);

    const events: any[] = [
      ...componentEvents([...baseComponents, fcmResult]),
      ...inspected.findings.map((f) => findingToEvent("briefing", f)),
      ...dataFindings.map((f) => findingToEvent(componentForFinding(f.check), f)),
    ];

    /* SELF-CHECK 3: AI triage of problems that are still unresolved. The AI can only confirm or veto a repair
       that the code proposed; it never picks one. */
    let aiDiagnosis: any = { triggered: false };
    let failedComponents = [...baseComponents, fcmResult].filter((c) => !c.success);
    if (failedComponents.length > 0) {
      aiDiagnosis = await runAIDebugger(targetDateKey, failedComponents, [...baseComponents, fcmResult], events);
      const verdict = validateAiVerdict(aiDiagnosis);
      events.push(aiEvent("ai-review", verdict, "medium"));

      if (!fcmResult.success) {
        const proposal = candidateRepair("firebase-fcm", fcmResult.error ?? "");
        if (proposal) {
          const cls = classifyError(fcmResult.error);
          const gate = safetyGate({
            repair: proposal, severity: "medium", category: cls.category, mentionsSecrets: cls.mentionsSecrets,
            requireAi: true, aiCanAutoFix: verdict.ok ? verdict.canAutoFix : null, aiConfidence: verdict.ok ? verdict.confidence : null,
          });
          if (gate.allowed) {
            const shortened = truncateToBytes(briefing, 1800);
            const retry = await withRetry(() => sendFCM(shortened.text, notificationSettings), { attempts: 1 });
            if (retry.ok) {
              briefing = shortened.text;
              fcmResult = { name: "firebase-fcm", success: true, attempts: (push.attempts ?? 1) + 1, recovered: true, firstError: push.error };
              events.push({
                kind: "repair", component: "firebase-fcm", severity: "medium", outcome: "fixed",
                found: "FCM rejected the briefing as invalid or too large.",
                action: "With the AI reviewer's agreement, shortened the pushed text to 1800 bytes and sent it. The full text is in the dashboard.",
                details: { repair: proposal, droppedLines: shortened.droppedLines },
              });
            } else {
              events.push({
                kind: "escalation", component: "firebase-fcm", severity: "high", outcome: "stopped",
                found: "The shortened briefing was rejected as well.", action: "No further automatic attempts. Needs your attention.",
                details: { repair: proposal },
              });
            }
          } else {
            events.push({
              kind: "escalation", component: "firebase-fcm", severity: "high", outcome: "stopped",
              found: "FCM rejected the briefing and a shorter version could have fixed it.",
              action: `Not changed: ${gate.reason}.`, details: { repair: proposal },
            });
          }
        }
      }
      failedComponents = [...baseComponents, fcmResult].filter((c) => !c.success);
    }

    const components = [...baseComponents, fcmResult];
    const overallStatus = failedComponents.length === 0 ? "healthy" : "degraded";

    /* SELF-CHECK 4: record the run and every check/repair for the dashboard. Never throws. */
    const status = runStatus({ hasBriefing: briefing.trim().length > 0, pushSent: fcmResult.success, events });
    const saved = await saveRun(
      { supabaseUrl: SUPABASE_URL, serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
      { date_key: targetDateKey, status, briefing, components, push_sent: Boolean(fcmResult.success), summary: runSummary(status, events) },
      events,
    );
    if (!saved.saved) console.error("SELF-CHECK SAVE ERROR:", saved.error);

    return new Response(JSON.stringify({
      success: true, status: overallStatus, date: targetDateKey, briefing, components, failedComponents,
      aiDiagnosis, weather, homework, requestCounts, timetable, calendar: calendarEvents, exams,
      selfCheck: { status, events, saved },
    }, null, 2), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("BRIEFING ERROR:", message);
    return new Response(JSON.stringify({ success: false, status: "failed", error: message, aiDiagnosis: { triggered: false } }, null, 2), { status: 500, headers: JSON_HEADERS });
  }
});
