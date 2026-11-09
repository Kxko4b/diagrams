# Personal Google Calendar connection

The personal portal uses a separate OAuth flow for each signed-in Kxko Briefing account. It does not use the administrator's calendar token.

## One-time Google Cloud configuration

1. In the Google Cloud project that owns the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, enable the **Google Calendar API**.
2. Open the OAuth 2.0 client used by the existing `google-calendar-auth` Edge Function. It must be a **Web application** client.
3. Add this exact authorised redirect URI:

   `https://ggewdpazpeoielbqrcgm.supabase.co/functions/v1/personal-google-calendar`

4. In the OAuth consent configuration, include these scopes:
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/calendar.readonly`
5. If the consent screen is in Testing mode, add the Google accounts that should be allowed to test it. Google may require app verification before broad public use of the Calendar read-only scope.

The Edge Function reuses the server-side `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets already used by the existing Google Calendar integration. If either is missing, add it in Supabase **Edge Functions → Secrets**. Never put either value in browser code, a public repository, or a chat message.

## Redirect destination

After Google completes the callback, the function returns the user to:

`https://kxko4b.github.io/diagrams/admin/`

If the hosted portal is moved to another domain or path, update `APP_RETURN_URL` and the allowed browser origins in `supabase/functions/personal-google-calendar/index.ts`, then redeploy the function.

## Security model

- The browser must already have a valid Supabase session to start, check, list or disconnect a connection.
- The callback uses a cryptographically random state value, stores only its SHA-256 hash, expires it after ten minutes, and consumes it once.
- Google refresh tokens are stored encrypted in Supabase Vault. They are not returned to the browser or stored in local storage.
- The Edge Function fetches calendar metadata using a short-lived access token and returns only calendar names/IDs and basic flags.
- Disconnect attempts to revoke the Google grant and always deletes the local Vault secret.
- A database trigger removes the Vault secret if the Supabase Auth user is deleted through another route.
- Calendar permission is read-only. The feature does not create, edit or delete Google events.

The personal Calendar *dashboard module* remains separate work: this connection centre currently proves the account connection and lists calendars, but does not yet render events in the daily briefing.
