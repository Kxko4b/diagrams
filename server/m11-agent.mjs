/**
 * Kxko M11 Server Agent
 * Outbound-only private Supabase Realtime connection.
 * No inbound shell port and no arbitrary command execution.
 *
 * Environment: SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...)
 * Start: node --env-file=.env m11-agent.mjs
 */
import { createClient } from "@supabase/supabase-js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const TOPIC = "kxko-m11-control-v1";
const HOME = os.homedir();
const ROOT = path.join(HOME, "server");
const PROJECTS = path.join(ROOT, "projects");
const REPOS = new Set(["Kxko-brief", "V2", "diagrams", "KXKOS", "kxko_admin_app_patch"]);
const MAX_OUTPUT = 18000;

if (!URL || !KEY || !KEY.startsWith("sb_secret_")) {
  console.error("Missing SUPABASE_URL or server-only sb_secret key.");
  process.exit(1);
}
const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const channel = supabase.channel(TOPIC, { config: { private: true } });
let online = false;

const clip = value => String(value ?? "").slice(0, MAX_OUTPUT);
async function run(program, args, timeout = 15000) {
  const result = await execFile(program, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true });
  return clip(result.stdout + (result.stderr ? "\n" + result.stderr : ""));
}
function isSensitivePath(relative) {
  const parts = String(relative || "").split(/[\\/]+/).filter(Boolean).map(x => x.toLowerCase());
  return parts.some(name => name === ".env" || name === ".ssh" || name === "authorized_keys" || name === "hosts.yml" || name.includes("secret") || name.includes("token") || name.endsWith(".pem") || name.endsWith(".key"));
}
async function safePath(relative = ".") {
  if (isSensitivePath(relative)) throw new Error("Access to credential and secret files is blocked.");
  const target = path.resolve(ROOT, relative || ".");
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new Error("Path is outside ~/server.");
  const rootReal = await fs.realpath(ROOT);
  const real = await fs.realpath(target);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error("Path resolves outside ~/server.");
  return real;
}
async function deviceInfo() {
  let model = "Samsung Galaxy M11";
  try { model = (await run("getprop", ["ro.product.model"], 3000)).trim() || model; } catch {}
  const total = os.totalmem(), used = total - os.freemem();
  const pct = Math.round(used / total * 100);
  const sec = Math.floor(os.uptime()), days = Math.floor(sec / 86400);
  const hours = Math.floor(sec % 86400 / 3600), mins = Math.floor(sec % 3600 / 60);
  return {
    device: "Kxko M11", model, platform: os.platform() + " · " + os.arch(),
    node: process.version, termux: true,
    uptimeText: (days ? days + "d " : "") + (hours ? hours + "h " : "") + mins + "m",
    ramPercent: pct, ramUsed: (used / 1024 / 1024 / 1024).toFixed(1) + " GB",
    ramTotal: (total / 1024 / 1024 / 1024).toFixed(1) + " GB"
  };
}
async function broadcast(event, payload) {
  if (!online) return;
  const result = await channel.send({ type: "broadcast", event, payload });
  if (result !== "ok") console.error("Realtime send:", result);
}
async function repoDir(name) {
  if (!REPOS.has(name)) throw new Error("Repository is not on the approved project list.");
  const dir = path.join(PROJECTS, name);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Repository is not cloned locally: " + name);
  return dir;
}
async function verifyRemote(dir, name) {
  const remote = (await run("git", ["-C", dir, "remote", "get-url", "origin"])).trim();
  const ssh = "git@github.com:Kxko4b/" + name + ".git";
  const https = "https://github.com/Kxko4b/" + name + ".git";
  if (remote !== ssh && remote !== https) throw new Error("Blocked: origin is not the expected Kxko4b/" + name + " repository.");
}
async function listProcesses() {
  const raw = await run("pm2", ["jlist"], 10000);
  return JSON.parse(raw || "[]").map(p => ({
    name: p.name, pid: p.pid, status: p.pm2_env?.status || "unknown",
    restarts: p.pm2_env?.restart_time || 0,
    memory: p.monit?.memory ? (p.monit.memory / 1024 / 1024).toFixed(0) + " MB" : "—"
  }));
}
async function listProjects() {
  await fs.mkdir(PROJECTS, { recursive: true });
  const entries = await fs.readdir(PROJECTS, { withFileTypes: true });
  const rows = [];
  for (const entry of entries.filter(x => x.isDirectory() && REPOS.has(x.name))) {
    const dir = path.join(PROJECTS, entry.name);
    try {
      const branch = (await run("git", ["-C", dir, "branch", "--show-current"], 8000)).trim();
      const status = (await run("git", ["-C", dir, "status", "--porcelain"], 8000)).trim();
      rows.push({ name: entry.name, cloned: true, branch: branch || "detached", clean: !status, dirty: !!status });
    } catch { rows.push({ name: entry.name, cloned: true, branch: "unknown", clean: false, dirty: false }); }
  }
  return rows;
}
async function terminal(line) {
  const parts = String(line || "").trim().split(" ").filter(Boolean);
  const head = parts[0], sub = parts[1], arg = parts[2], extra = parts[3];
  if (!head) return "";
  if (head === "help") return [
    "Supported commands:",
    "  status                         server health and resources",
    "  projects                       list approved cloned repositories",
    "  pm2 list                       list running services",
    "  pm2 restart <process>          restart an existing PM2 process",
    "  pm2 logs <process> [lines]      show recent process logs",
    "  git status <repo>              show repository status",
    "  git pull <repo>                fast-forward pull from approved origin",
    "  git push <repo>                push current branch to approved origin",
    "  files [path]                   list files under ~/server",
    "  read <path>                    read a text file under ~/server",
    "  df                             show storage usage",
    "  help                           show this help",
    "",
    "Arbitrary shell, deletion, root access and unrestricted execution are disabled."
  ].join("\n");
  if (head === "status") return JSON.stringify(await deviceInfo(), null, 2);
  if (head === "projects") return JSON.stringify(await listProjects(), null, 2);
  if (head === "df") return await run("df", ["-h", HOME]);
  if (head === "pm2" && sub === "list" && parts.length === 2) return JSON.stringify(await listProcesses(), null, 2);
  if (head === "pm2" && sub === "restart" && arg && parts.length === 3) {
    const processes = await listProcesses();
    if (!processes.some(p => p.name === arg)) throw new Error("Unknown PM2 process: " + arg);
    return await run("pm2", ["restart", arg]);
  }
  if (head === "pm2" && sub === "logs" && arg && parts.length <= 4) {
    const processes = await listProcesses();
    if (!processes.some(p => p.name === arg)) throw new Error("Unknown PM2 process: " + arg);
    const count = Math.max(10, Math.min(200, Number(extra) || 60));
    return await run("pm2", ["logs", arg, "--lines", String(count), "--nostream"]);
  }
  if (head === "git" && ["status", "pull", "push"].includes(sub) && arg && parts.length === 3) {
    const dir = await repoDir(arg);
    await verifyRemote(dir, arg);
    if (sub === "status") return await run("git", ["-C", dir, "status", "--short", "--branch"]);
    if (sub === "pull") return await run("git", ["-C", dir, "pull", "--ff-only"]);
    return await run("git", ["-C", dir, "push"]);
  }
  if (head === "files" && parts.length <= 2) {
    const dir = await safePath(sub || ".");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(x => !isSensitivePath(x.name)).slice(0, 150).map(x => (x.isDirectory() ? "[DIR] " : "      ") + x.name).join("\n") || "(empty)";
  }
  if (head === "read" && parts.length === 2) {
    const file = await safePath(sub);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 200000) throw new Error("Only text files up to 200 KB can be read.");
    return await fs.readFile(file, "utf8");
  }
  throw new Error("Unsupported command. Type help to see supported commands.");
}
async function handle(payload = {}) {
  const id = payload.id || "unknown", action = payload.action;
  try {
    const result = { id, action, output: "Done." };
    if (action === "ping") { result.output = "M11 agent is online."; result.heartbeat = await deviceInfo(); }
    else if (action === "status") { result.heartbeat = await deviceInfo(); result.output = "Server status refreshed."; }
    else if (action === "processes") { result.data = await listProcesses(); result.output = "Loaded " + result.data.length + " PM2 process(es)."; }
    else if (action === "projects") { result.data = await listProjects(); result.output = "Loaded " + result.data.length + " approved project(s)."; }
    else if (action === "pm2_restart") {
      const name = String(payload.args?.name || "");
      const processes = await listProcesses();
      if (!processes.some(p => p.name === name)) throw new Error("Unknown PM2 process.");
      result.output = await run("pm2", ["restart", name]);
    } else if (action === "terminal") result.output = await terminal(payload.args?.line);
    else throw new Error("Unknown action.");
    await broadcast("result", result);
  } catch (error) {
    await broadcast("result", { id, action, error: true, output: error.message || String(error) });
  }
}
channel.on("broadcast", { event: "command" }, ({ payload }) => { handle(payload).catch(error => console.error(error)); });
channel.subscribe(async status => {
  console.log("Realtime:", status);
  online = status === "SUBSCRIBED";
  if (online) await broadcast("heartbeat", await deviceInfo());
});
setInterval(() => { if (online) broadcast("heartbeat", deviceInfo()).catch(() => {}); }, 12000);
console.log("Kxko M11 agent starting; waiting for the private dashboard channel.");
