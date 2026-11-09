import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
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
  const admin = createClient(url, service);
  const result = await admin.auth.admin.deleteUser(user.id);
  if (result.error) return Response.json({ error: result.error.message }, { status: 400, headers: cors });
  return Response.json({ success: true }, { headers: cors });
});
