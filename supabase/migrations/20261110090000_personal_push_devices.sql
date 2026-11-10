-- Personal push devices are deliberately isolated from legacy admin FCM devices.
create table if not exists public.personal_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fcm_token text not null,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, fcm_token)
);

create index if not exists personal_push_devices_user_enabled_idx
  on public.personal_push_devices (user_id, notifications_enabled);

alter table public.personal_push_devices enable row level security;
revoke all on table public.personal_push_devices from anon, authenticated;
grant all on table public.personal_push_devices to service_role;

comment on table public.personal_push_devices is
  'Personal-account FCM registrations. Never used by the legacy administrator daily-briefing topic.';
