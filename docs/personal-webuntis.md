# Personal WebUntis integration: prerequisites and design

## Current state

The personal portal deliberately does not reuse the administrator's WebUntis credentials, timetable, or notification data. The current `untis-test` Edge Function is a server-only integration that reads one shared set of environment variables and applies a fixed baseline timetable. It is not a per-user account system.

The personal WebUntis card therefore remains unavailable until the official Untis Platform application requirements below are met. The app must not ask a student to paste a WebUntis password, QR-code secret, or one-time-password seed into Kxko.

## Supported integration path

Use the official Untis Platform OIDC Authorization Code flow (v3), not reverse-engineered mobile/internal APIs or a shared service account.

Official documentation:
- Authentication and SSO: https://developer.untis.com/integration-guides/sso/
- Application registration: https://developer.untis.com/getting-started/get-platform-application/
- Timetable API: https://developer.untis.com/api-reference/webuntis-apis/timetable-data/
- Authorization model: https://developer.untis.com/core-concepts/authorization-model/

The official process requires an Untis Platform application configured by the Untis integration team. The application needs a registered domain and exact SSO redirect path, OIDC client ID/secret, a tenant ID, and explicit timetable read permissions. Schools must activate the application according to its activation model. User-context permissions also depend on each user's school role and membership.

## Required configuration before implementation can be enabled

- A platform application registered with Untis.
- The production tenant ID for the participating school.
- OIDC client ID and client secret, stored only as Supabase Edge Function secrets.
- The exact redirect URI registered in the platform application.
- The required read-only timetable permission/scope enabled for the application.
- Confirmation that the school has activated the application and permits the required data exchange.

The official SSO flow uses the tenant-specific v3 authorize and token endpoints. Discover endpoint URLs from the tenant's OIDC well-known configuration rather than hardcoding them. Use unique state and nonce values. Use PKCE where the client configuration supports it. Validate the returned ID token (signature, issuer, audience, expiry and nonce) before associating the Untis identity with a Kxko account.

## Planned account isolation

When the platform application is provisioned:
- Each Kxko user initiates their own Untis sign-in.
- The OAuth state is short-lived, single-use and bound to the initiating Kxko user.
- User tokens are stored encrypted in Supabase Vault; never in local storage or browser-visible tables.
- The backend maps the Untis subject to the signed-in Kxko user and requests only that user's permitted timetable data.
- Disconnect revokes tokens where supported and deletes the user's Vault secret.
- No personal timetable or credentials are shared with another Kxko account.
- The existing admin-only `untis-test` function remains unchanged.

## Why this is not enabled yet

The official Untis documentation says platform applications are configured by the Untis integration team, then tested in an integration environment and promoted to production. This is a partner integration process, not something that can be completed by guessing a school URL or copying the administrator's legacy login.

Until the application and school activation exist, the personal WebUntis module must remain clearly marked as awaiting setup. Do not silently fall back to the shared administrator connection.
