import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const APP_RETURN_URL = "https://kxko4b.github.io/diagrams/admin/";
const ALLOWED_ORIGINS = new Set([
  "https://kxko4b.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://kxko4b.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!supabaseUrl || !anonKey || !serviceKey || !googleClientId || !googleClientSecret) {
    return json({ error: "Google Calendar is not configured on the server yet." }, 503, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const redirectUri = supabaseUrl + "/functions/v1/personal-google-calendar";

  // Google redirects here without a Supabase JWT. The one-time, short-lived state
  // is bound to the authenticated user who initiated the connection.
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    if (!state || (!code && !providerError)) return new Response("Invalid OAuth callback.", { status: 400 });
    const { data: userId, error: stateError } = await admin.rpc("personal_google_consume_state", {
      p_state_hash: await sha256(state),
    });
    if (stateError || !userId) return Response.redirect(APP_RETURN_URL + "?google_calendar=invalid_state", 303);
    if (providerError) return Response.redirect(APP_RETURN_URL + "?google_calendar=cancelled", 303);

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code!,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.refresh_token || !tokens.access_token) {
        console.error("Google OAuth token exchange failed", tokens.error || tokenResponse.status);
        return Response.redirect(APP_RETURN_URL + "?google_calendar=token_error", 303);
      }

      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: "Bearer " + tokens.access_token },
      });
      const googleProfile = profileResponse.ok ? await profileResponse.json() : {};
      const { error: storeError } = await admin.rpc("personal_google_store_connection", {
        p_user_id: userId,
        p_refresh_token: tokens.refresh_token,
        p_google_email: typeof googleProfile.email === "string" ? googleProfile.email : null,
        p_scope: typeof tokens.scope === "string" ? tokens.scope : "",
      });
      if (storeError) {
        console.error("Could not store encrypted Google connection", storeError.message);
        return Response.redirect(APP_RETURN_URL + "?google_calendar=storage_error", 303);
      }
      return Response.redirect(APP_RETURN_URL + "?google_calendar=connected", 303);
    } catch (error) {
      console.error("Google OAuth callback failed", error instanceof Error ? error.message : "unknown error");
      return Response.redirect(APP_RETURN_URL + "?google_calendar=callback_error", 303);
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401, origin);
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: "Your session is invalid. Please sign in again." }, 401, origin);

  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }

  if (body.action === "connect") {
    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = hex(stateBytes);
    const { error } = await admin.rpc("personal_google_store_state", {
      p_state_hash: await sha256(state),
      p_user_id: user.id,
      p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) return json({ error: "Could not start Google connection. Try again." }, 500, origin);

    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.search = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
      state,
    }).toString();
    return json({ url: googleUrl.toString() }, 200, origin);
  }

  if (body.action === "status") {
    const { data, error } = await admin.from("personal_google_calendar_connections")
      .select("google_email,granted_scope,connected_at").eq("user_id", user.id).maybeSingle();
    if (error) return json({ error: "Could not load connection status." }, 500, origin);
    return json({ connected: !!data, connection: data ?? null }, 200, origin);
  }

  if (body.action === "disconnect") {
    const { error } = await admin.rpc("personal_google_disconnect", { p_user_id: user.id });
    if (error) return json({ error: "Could not disconnect Google Calendar." }, 500, origin);
    return json({ success: true }, 200, origin);
  }

  if (body.action === "calendars") {
    const { data: refreshToken, error: tokenError } = await admin.rpc("personal_google_get_refresh_token", { p_user_id: user.id });
    if (tokenError || !refreshToken) return json({ error: "Connect Google Calendar first." }, 404, origin);
    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const refreshed = await refreshResponse.json();
    if (!refreshResponse.ok || !refreshed.access_token) {
      console.error("Google access-token refresh failed", refreshed.error || refreshResponse.status);
      return json({ error: "Google needs you to reconnect this account." }, 409, origin);
    }
    const calendarResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100", {
      headers: { Authorization: "Bearer " + refreshed.access_token },
    });
    const calendars = await calendarResponse.json();
    if (!calendarResponse.ok) {
      console.error("Google calendar list failed", calendars.error?.status || calendarResponse.status);
      return json({ error: "Google could not return your calendars." }, 502, origin);
    }
    return json({
      calendars: (calendars.items ?? []).map((item: Record<string, unknown>) => ({
        id: item.id,
        summary: item.summary,
        primary: item.primary === true,
        selected: item.selected !== false,
        accessRole: item.accessRole,
      })),
    }, 200, origin);
  }

  return json({ error: "Unknown action." }, 400, origin);
});
