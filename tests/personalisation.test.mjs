import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("admin/index.html");
const auth = read("admin/personalisation.js");
const registry = read("js/feature-registry.js");
const accounts = read("supabase/migrations/20261109211926_personal_briefing_accounts.sql");
const google = read("supabase/functions/personal-google-calendar/index.ts");
const client = read("js/supabase.js");

test("personal login offers account creation and password recovery", () => {
  assert.match(html, /id="admin-email"/);
  assert.match(html, /id="admin-password"/);
  assert.match(auth, /name\.id = "personal-name"/);
  assert.match(auth, /db\.auth\.signUp\(\{email,password,options:\{data:\{full_name\}\}\}\)/);
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /password\.length < 8/);
});

test("personal accounts open a separate portal and load only their own records", () => {
  assert.match(auth, /root\.id="personal-app"/);
  assert.match(auth, /\$\("personal-app"\)\.classList\.remove\("hidden"\)/);
  for (const table of ["user_profiles", "user_preferences", "user_modules"]) {
    assert.match(auth, new RegExp('db\.from\("' + table + '"\)'));
  }
  assert.match(auth, /\.eq\("user_id",user\.id\)/);
});

test("new accounts receive a profile, preferences and default module rows", () => {
  for (const table of ["user_profiles", "user_preferences", "user_modules"]) {
    assert.match(accounts, new RegExp("create table if not exists public\." + table));
  }
  assert.match(accounts, /after insert on auth\.users/);
  assert.match(accounts, /bootstrap_briefing_user/);
  assert.equal((accounts.match(/enable row level security/g) || []).length, 3);
  assert.equal((accounts.match(/\(select auth\.uid\(\)\) = user_id/g) || []).length, 6);
});

test("the feature catalogue distinguishes available modules from future integrations", () => {
  assert.match(registry, /id:"weather".*available:true/);
  assert.match(registry, /id:"calendar".*available:true/);
  assert.match(registry, /id:"webuntis".*available:false/);
  assert.match(registry, /id:"timetable".*available:false/);
  assert.match(registry, /id:"homework".*available:true/);
});

test("Google refresh tokens stay server-side and personal data is user-scoped", () => {
  assert.match(google, /p_refresh_token: tokens\.refresh_token/);
  assert.match(google, /personal_google_store_connection/);
  assert.match(google, /\.eq\("user_id", user\.id\)/);
  assert.match(google, /calendar\.readonly/);
  assert.doesNotMatch(google, /return json\(\{[^}]*refresh_token/s);
  assert.doesNotMatch(client, /service_role/i);
});

test("personal portal has accessible status regions and account controls", () => {
  assert.match(auth, /id="personal-signout"/);
  assert.match(auth, /id="delete-account"/);
  assert.match(auth, /role="status"/);
  assert.match(html, /role="alert"/);
});

test("personal homework is isolated from administrator homework", () => {
  const migration = read("supabase/migrations/20261109215633_personal_homework.sql");
  assert.match(migration, /create table if not exists public\.personal_homework/);
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(migration, /grant select, insert, update, delete on public\.personal_homework to authenticated/);
  assert.match(auth, /db\.from\("personal_homework"\)/);
  assert.match(auth, /user_id:currentUser\.id/);
  assert.match(auth, /title\.textContent=task\.title/);
  assert.match(auth, /notes\.textContent=task\.details/);
  assert.match(auth, /update\(\{completed\}\)/);
  assert.match(auth, /delete\(\)/);
  assert.match(auth, /Homework & school/);
  assert.match(auth, /db\.from\("personal_homework"\)\.select\("subject,title,due_date"\)/);
});

test("personal homework grants only the CRUD permissions it needs", () => {
  const migration = read("supabase/migrations/20261109215712_personal_homework_least_privilege.sql");
  assert.match(migration, /revoke all on public\.personal_homework from anon, public, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on public\.personal_homework to authenticated/);
});

test("homework can be switched on independently of WebUntis", () => {
  assert.match(registry, /id:"homework".*available:true/);
  assert.match(registry, /id:"webuntis".*available:false/);
  assert.match(auth, /id="personal-homework-form"/);
  assert.match(auth, /id="personal-homework-list"/);
  assert.match(auth, /This is separate from WebUntis/);
});

test("native Android and personal portal share sessions without exposing tokens to JavaScript bridge arguments", () => {
  assert.match(auth, /db\.auth\.onAuthStateChange\(\(event, session\)=>/);
  assert.match(auth, /window\.KxkoNative\.onPersonalSessionChanged\(\)/);
  assert.match(auth, /window\.kxkoGetPersonalSession = \(\) =>/);
  assert.match(auth, /if\(!session\?\.user\|\|isAdmin\(session\.user\)\)return null/);
  assert.match(auth, /window\.kxkoApplyNativeSession = async/);
  assert.match(auth, /db\.auth\.setSession\(\{access_token:accessToken,refresh_token:refreshToken\}\)/);
  assert.match(auth, /if\(isAdmin\(current\?\.user\)\)return false/);
  assert.match(auth, /window\.kxkoClearPersonalSession = async/);
});

test("personal push registrations are isolated and require a verified account session", () => {
  const migration = read("supabase/migrations/20261110090000_personal_push_devices.sql");
  const registration = read("supabase/functions/register-personal-device/index.ts");
  assert.match(migration, /create table if not exists public\.personal_push_devices/);
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.personal_push_devices from anon, authenticated/);
  assert.match(registration, /auth\.getUser\(\)/);
  assert.match(registration, /user_id: user\.id/);
  assert.match(registration, /personal_push_devices/);
  assert.doesNotMatch(registration, /body\?\.user_id/);
  assert.doesNotMatch(registration, /SUPABASE_SERVICE_ROLE_KEY.{0,200}return json/);
});

