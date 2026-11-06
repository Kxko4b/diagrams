// Run with:  node --test "tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ui = require("../js/briefing-admin.js");

/* ------------------------------------------------------------ formatting */

test("times are shown in Berlin time, summer and winter", () => {
  // 04:00 UTC = 06:00 CEST (summer), 05:00 UTC = 06:00 CET (winter)
  assert.match(ui.formatBriefingTime("2026-10-18T04:00:00Z"), /06:00/);
  assert.match(ui.formatBriefingTime("2026-12-01T05:00:00Z"), /06:00/);
  assert.equal(ui.formatBriefingTime(null), "—");
  assert.equal(ui.formatBriefingTime("not a date"), "—");
});

test("date keys become readable dates", () => {
  assert.match(ui.formatBriefingDateKey("20261018"), /Sunday,? 18 October 2026/);
  assert.equal(ui.formatBriefingDateKey("garbage"), "garbage");
  assert.equal(ui.formatBriefingDateKey(undefined), "—");
});

test("status and outcome labels are stable", () => {
  assert.deepEqual(ui.briefingStatusInfo("healthy"), { label: "Healthy", tone: "good" });
  assert.equal(ui.briefingStatusInfo("repaired").tone, "info");
  assert.equal(ui.briefingStatusInfo("degraded").tone, "warn");
  assert.equal(ui.briefingStatusInfo("failed").tone, "bad");
  assert.equal(ui.briefingStatusInfo("???").tone, "muted");
  assert.equal(ui.briefingOutcomeInfo("fixed").label, "Fixed automatically");
  assert.equal(ui.briefingOutcomeInfo("stopped").tone, "bad");
  assert.equal(ui.briefingOutcomeInfo("reported").tone, "warn");
  assert.equal(ui.briefingKindLabel("ai"), "AI review");
  assert.equal(ui.briefingKindLabel("whatever"), "Check");
});

/* ------------------------------------------------------------- rendering */

const EVENT = {
  id: 1, run_id: 5, created_at: "2026-10-19T04:00:05Z", kind: "repair", component: "weather",
  severity: "low", outcome: "fixed", found: "Failed on the first attempt: HTTP 503", action: "Retried automatically and it succeeded on attempt 2.",
};

test("an event shows what was found, what changed, and when", () => {
  const html = ui.renderBriefingEvent(EVENT);
  assert.match(html, /Fixed automatically/);
  assert.match(html, /Found:/);
  assert.match(html, /HTTP 503/);
  assert.match(html, /Changed:/);
  assert.match(html, /06:00/); // 04:00:05Z in Berlin summer time
  assert.match(html, /weather/);
});

test("reported events say 'Did', not 'Changed'", () => {
  const html = ui.renderBriefingEvent({ ...EVENT, outcome: "reported", action: "Left as is." });
  assert.match(html, /Did:/);
  assert.doesNotMatch(html, /Changed:/);
});

test("anything that came from logs or the briefing is HTML-escaped (no script injection)", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const eventHtml = ui.renderBriefingEvent({ ...EVENT, found: evil, action: evil, component: evil });
  assert.doesNotMatch(eventHtml, /<img/);
  assert.match(eventHtml, /&lt;img/);

  const runHtml = ui.renderBriefingRun(
    { id: 5, date_key: "20261019", run_at: "2026-10-19T04:00:00Z", status: "healthy", briefing: evil, summary: evil, push_sent: true,
      components: [{ name: evil, success: false, error: evil, attempts: 1 }] },
    [],
  );
  assert.doesNotMatch(runHtml, /<img/);
});

test("with no runs the window explains when the first briefing will appear", () => {
  assert.match(ui.renderBriefingRun(null, []), /No briefing has been recorded yet/);
});

test("a run shows counts, the briefing text, the activity feed and the data sources", () => {
  const run = {
    id: 5, date_key: "20261019", run_at: "2026-10-19T04:00:00Z", status: "repaired", push_sent: true,
    summary: "repaired: 1 fixed automatically, 0 stopped for you, 0 reported.",
    briefing: "MONDAY 19 OCTOBER\n\nWEATHER\nClear",
    components: [
      { name: "weather", success: true, attempts: 2, recovered: true },
      { name: "google-calendar", success: false, attempts: 1, error: "invalid_grant" },
    ],
  };
  const html = ui.renderBriefingRun(run, [
    EVENT,
    { ...EVENT, id: 2, kind: "escalation", outcome: "stopped", component: "google-calendar" },
    { ...EVENT, id: 3, kind: "check", outcome: "reported", component: "iserv-exams" },
    { ...EVENT, id: 4, kind: "ai", outcome: "reported", component: "ai-review" },
  ]);
  assert.match(html, /Repaired/);
  assert.match(html, /MONDAY 19 OCTOBER/);
  assert.match(html, /Briefing as sent/);
  assert.match(html, /Push sent/);
  assert.match(html, /Recovered after retry/);
  assert.match(html, /invalid_grant/);
  // 1 fixed, 1 stopped, 1 reported (the AI note is not counted as a separate problem)
  const counts = [...html.matchAll(/stat-value">(\d+)</g)].map((m) => m[1]);
  assert.deepEqual(counts, ["1", "1", "1"]);
});

test("a run whose push failed says so clearly", () => {
  const html = ui.renderBriefingRun(
    { id: 1, date_key: "20261019", run_at: "2026-10-19T04:00:00Z", status: "degraded", push_sent: false, summary: "", briefing: "x", components: [] },
    [],
  );
  assert.match(html, /Push NOT sent/);
  assert.match(html, /nothing to fix or report/);
});

test("events are grouped per run and sorted oldest first", () => {
  const grouped = ui.groupBriefingEvents([
    { run_id: 1, created_at: "2026-10-19T04:00:09Z", id: 2 },
    { run_id: 2, created_at: "2026-10-20T04:00:00Z", id: 3 },
    { run_id: 1, created_at: "2026-10-19T04:00:01Z", id: 1 },
  ]);
  assert.deepEqual(grouped.get(1).map((e) => e.id), [1, 2]);
  assert.deepEqual(grouped.get(2).map((e) => e.id), [3]);
  assert.equal(ui.groupBriefingEvents(null).size, 0);
});

/* ----------------------------------------------- wiring + migration safety */

test("the admin page has the Briefing button, view, script and load call", () => {
  const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="briefing"/);
  assert.match(html, /id="briefing-view"/);
  assert.match(html, /id="briefing-detail"/);
  assert.match(html, /<script src="\.\.\/js\/briefing-admin\.js(\?v=\w+)?"><\/script>/);

  const admin = readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");
  assert.match(admin, /typeof loadBriefing === "function"/);
});

test("the migration is additive, owner-only and read-only for the browser", () => {
  const sql = readFileSync(new URL("../supabase/briefing-self-check.sql", import.meta.url), "utf8").toLowerCase();
  // additive: nothing is dropped or deleted
  assert.doesNotMatch(sql, /drop table|truncate|delete from|alter table [^;]*drop/);
  // RLS on both tables
  assert.match(sql, /alter table public\.briefing_runs\s+enable row level security/);
  assert.match(sql, /alter table public\.briefing_events\s+enable row level security/);
  // only SELECT policies exist, nothing lets a browser write
  const policies = [...sql.matchAll(/create policy [^;]*?for (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(policies, ["select", "select"]);
  assert.doesNotMatch(sql, /grant (insert|update|delete)/);
  assert.match(sql, /revoke all on public\.briefing_runs\s+from anon, authenticated/);
  // only the admin account can read
  assert.equal([...sql.matchAll(/haleannson@gmail\.com/g)].length, 2);
  assert.doesNotMatch(sql, /to anon/);
});

test("briefing schedule editor has no fixed 12-time limit", () => {
  const source = readFileSync(new URL("../js/briefing-settings-admin.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /schedules\.length\s*>=\s*12/);
  assert.doesNotMatch(source, /up to 12 briefing times/i);
});

/* ---- homework window + yellow substitute rows ---- */
import { createRequire as __cr } from "node:module";
{
    const { test: t2 } = await import("node:test");
    const assert2 = (await import("node:assert/strict")).default;
    const m = __cr(import.meta.url)("../js/briefing-admin.js");
    t2("lesson class: substitute is yellow, cancelled wins", () => {
        assert2.equal(m.briefingLessonClass({ changed: true }), "changed");
        assert2.equal(m.briefingLessonClass({ cancelled: true, changed: true }), "cancelled");
        assert2.equal(m.briefingLessonClass({}), "");
    });
    t2("homework: WebUntis only from today to +3 days, with due date", () => {
        const r = m.filterBriefingHomework([
            { text: "a", dueDate: "2026-10-26" }, { text: "b", dueDate: "2026-10-27" }, { text: "far", dueDate: "2026-10-28" },
            { text: "past", dueDate: "2026-10-23" }, { text: "none" }], [], "2026-10-24");
        assert2.deepEqual(r.map(x => x.text), ["a", "b"]);
        assert2.equal(r[0].due_date, "2026-10-26");
    });
    t2("homework: personal tracker hides completed and far-future, keeps overdue", () => {
        const r = m.filterBriefingHomework([], [
            { subject: "M", description: "late", due_date: "2026-10-20", completed: false },
            { subject: "M", description: "soon", due_date: "2026-10-27", completed: false },
            { subject: "M", description: "far", due_date: "2026-10-30", completed: false },
            { subject: "M", description: "done", due_date: "2026-10-25", completed: true }], "2026-10-24");
        assert2.deepEqual(r.map(x => x.text), ["late", "soon"]);
    });
    t2("homework: month boundary", () => {
        assert2.equal(m.briefingAddDays("2026-10-30", 3), "2026-11-02");
    });
}
