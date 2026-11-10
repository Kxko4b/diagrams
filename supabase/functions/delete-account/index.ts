import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const cors = { "Access-Control-Allow-Origin": "https://kxko4b.github.io", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return Response.json({ error: "Authentication required" }, { status: 401, headers: cors });
  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return Response.json({ error: "Invalid session" }, { status: 401, headers: cors });
  // Keep the owner account protected from self-service deletion.
  if (user.email?.toLowerCase() === "haleannson@gmail.com") return Response.json({ error: "The administrator account cannot be deleted here." }, { status: 403, headers: cors });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: refreshToken } = await admin.rpc("personal_google_get_refresh_token", { p_user_id: user.id });
  if (refreshToken) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (revokeError) {
      console.warn("Google grant revocation did not complete before account deletion", revokeError instanceof Error ? revokeError.message : "unknown error");
    }
  }
  const { error: cleanupError } = await admin.rpc("personal_google_disconnect", { p_user_id: user.id });
  if (cleanupError) return Response.json({ error: "Could not securely remove connected accounts. Please try again." }, { status: 500, headers: cors });
  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) return Response.json({ error: result.error.message }, { status: 400, headers: cors });
  return Response.json({ success: true }, { headers: cors });
});
