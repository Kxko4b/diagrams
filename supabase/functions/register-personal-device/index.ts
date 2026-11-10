import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "POST required." });

  try {
    const authorization = req.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json(401, { success: false, error: "A personal account session is required." });

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase function configuration is incomplete.");

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${match[1]}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json(401, { success: false, error: "Your session is invalid or expired." });

    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const platform = typeof body?.platform === "string" ? body.platform : "android";
    if (token.length < 20 || token.length > 4096) return json(400, { success: false, error: "Invalid device token." });
    if (!["android", "ios", "web"].includes(platform)) return json(400, { success: false, error: "Unsupported platform." });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date().toISOString();
    const { error } = await admin.from("personal_push_devices").upsert({
      user_id: user.id,
      fcm_token: token,
      platform,
      updated_at: now,
      last_seen_at: now,
    }, { onConflict: "user_id,fcm_token" });
    if (error) throw error;

    return json(200, { success: true });
  } catch (error) {
    console.error("Personal device registration failed:", error);
    return json(500, { success: false, error: "Device registration failed." });
  }
});
