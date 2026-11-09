-- Per-user Google Calendar OAuth state and encrypted token references.
-- OAuth refresh tokens are stored only in Supabase Vault, never in browser storage.
create table if not exists public.personal_google_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.personal_google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vault_secret_id uuid not null,
  google_email text,
  granted_scope text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_google_oauth_states enable row level security;
alter table public.personal_google_calendar_connections enable row level security;
revoke all on public.personal_google_oauth_states, public.personal_google_calendar_connections from public, anon, authenticated;
grant all on public.personal_google_oauth_states, public.personal_google_calendar_connections to service_role;

create or replace function public.personal_google_store_state(p_state_hash text, p_user_id uuid, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if length(p_state_hash) <> 64 or p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'Invalid OAuth state';
  end if;
  insert into public.personal_google_oauth_states(state_hash,user_id,expires_at)
  values (p_state_hash,p_user_id,p_expires_at);
end;
$$;

create or replace function public.personal_google_consume_state(p_state_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  update public.personal_google_oauth_states set consumed_at = now()
  where state_hash = p_state_hash and consumed_at is null and expires_at > now()
  returning user_id into v_user_id;
  delete from public.personal_google_oauth_states where expires_at <= now() or consumed_at < now() - interval '1 day';
  return v_user_id;
end;
$$;

create or replace function public.personal_google_store_connection(
  p_user_id uuid, p_refresh_token text, p_google_email text, p_scope text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_name text;
begin
  if p_refresh_token is null or length(p_refresh_token) < 20 then
    raise exception 'Invalid Google refresh token';
  end if;
  v_name := 'kxko_personal_google_calendar_' || p_user_id::text;
  select vault_secret_id into v_secret_id from public.personal_google_calendar_connections where user_id = p_user_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_refresh_token, v_name, 'Encrypted Google Calendar refresh token for one Kxko Briefing user', null);
  else
    perform vault.update_secret(v_secret_id, p_refresh_token, v_name, 'Encrypted Google Calendar refresh token for one Kxko Briefing user', null);
  end if;
  insert into public.personal_google_calendar_connections(user_id,vault_secret_id,google_email,granted_scope,connected_at,updated_at)
  values (p_user_id,v_secret_id,p_google_email,coalesce(p_scope,''),now(),now())
  on conflict (user_id) do update set vault_secret_id=excluded.vault_secret_id,
    google_email=excluded.google_email,granted_scope=excluded.granted_scope,
    connected_at=now(),updated_at=now();
end;
$$;

create or replace function public.personal_google_get_refresh_token(p_user_id uuid)
returns text language sql security definer set search_path = '' as $$
  select ds.decrypted_secret from public.personal_google_calendar_connections c
  join vault.decrypted_secrets ds on ds.id=c.vault_secret_id
  where c.user_id=p_user_id limit 1;
$$;

create or replace function public.personal_google_disconnect(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id from public.personal_google_calendar_connections where user_id=p_user_id;
  delete from public.personal_google_calendar_connections where user_id=p_user_id;
  if v_secret_id is not null then delete from vault.secrets where id=v_secret_id; end if;
end;
$$;

revoke all on function public.personal_google_store_state(text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.personal_google_consume_state(text) from public, anon, authenticated;
revoke all on function public.personal_google_store_connection(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.personal_google_get_refresh_token(uuid) from public, anon, authenticated;
revoke all on function public.personal_google_disconnect(uuid) from public, anon, authenticated;
grant execute on function public.personal_google_store_state(text,uuid,timestamptz) to service_role;
grant execute on function public.personal_google_consume_state(text) to service_role;
grant execute on function public.personal_google_store_connection(uuid,text,text,text) to service_role;
grant execute on function public.personal_google_get_refresh_token(uuid) to service_role;
grant execute on function public.personal_google_disconnect(uuid) to service_role;

-- Delete each user's Vault refresh token even when their Auth account is removed
-- outside the self-service Edge Function (e.g. from the Supabase dashboard).
create or replace function public.cleanup_personal_google_calendar_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.personal_google_calendar_connections where user_id = old.id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  return old;
end;
$$;
revoke all on function public.cleanup_personal_google_calendar_secret() from public, anon, authenticated;
drop trigger if exists cleanup_personal_google_calendar_secret on auth.users;
create trigger cleanup_personal_google_calendar_secret
before delete on auth.users
for each row execute function public.cleanup_personal_google_calendar_secret();
