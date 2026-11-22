# Kxko M11 Server Agent

The agent connects the Samsung M11 **outbound** to the Kxko Admin dashboard through a private Supabase Realtime channel. It does not open an inbound SSH or HTTP port.

## Security model

- The dashboard must be signed in as the existing Kxko admin account.
- Realtime policies permit only that admin user to read/write the dedicated channel.
- The M11 agent uses a Supabase **secret key** stored locally in Termux. It must never be committed or placed in browser JavaScript.
- The console is constrained, not unrestricted PowerShell or a root shell. It supports status, PM2 list/restart/logs, approved GitHub repository status/pull/push, disk usage, and read-only file browsing under ~/server.
- Git pull/push checks that origin is exactly the expected Kxko4b repository. Pulls are fast-forward-only.
- Delete, root, arbitrary shell, port-forwarding, and public endpoints are not provided.

## Install on the M11

1. Ensure Node.js is installed in Termux.
2. Clone or pull this repository, then open its server folder.
3. Install the pinned dependency: `npm install --no-save @supabase/supabase-js@2.119.0`
4. Create a local `.env` file:
   ```env
   SUPABASE_URL=https://ggewdpazpeoielbqrcgm.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_REPLACE_WITH_A_SERVER_ONLY_KEY
   ```
5. Create a server-only secret key in Supabase project settings. Keep it in Termux only; never paste it into chat, GitHub, or the dashboard.
6. Restrict the file: `chmod 600 .env`
7. Test: `node --env-file=.env m11-agent.mjs`
8. Once the dashboard shows the M11 online, keep it running with PM2:
   `pm2 start m11-agent.mjs --name kxko-m11-agent --node-args="--env-file=.env"`
   `pm2 save`

If the phone is lost or reset, revoke the server secret key.

## Realtime policies

Apply `m11-realtime-policies.sql` once to the existing Supabase project. The policy only permits the signed-in admin account to use the private topic.
