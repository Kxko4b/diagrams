-- Kxko Briefing: isolated personal accounts and preferences.
-- Existing administrator/business tables are deliberately untouched.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{"theme":"dark","accent":"amber","density":"comfortable","location":"Buseck"}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.user_modules (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null check (module_key in ('weather','webuntis','timetable','homework','calendar','briefing','cycling','cycling_history','business','notifications')),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);

alter table public.user_profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_modules enable row level security;

drop policy if exists "Users manage own profile" on public.user_profiles;
create policy "Users manage own profile" on public.user_profiles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences" on public.user_preferences
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own modules" on public.user_modules;
create policy "Users manage own modules" on public.user_modules
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.bootstrap_briefing_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.user_profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (user_id) do nothing;
  insert into public.user_preferences(user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.user_modules(user_id,module_key,enabled) values
    (new.id,'weather',true),(new.id,'webuntis',false),(new.id,'timetable',false),
    (new.id,'homework',false),(new.id,'calendar',false),(new.id,'briefing',true),
    (new.id,'cycling',false),(new.id,'cycling_history',false),(new.id,'business',false),
    (new.id,'notifications',true)
  on conflict (user_id,module_key) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_briefing on auth.users;
create trigger on_auth_user_created_briefing after insert on auth.users
for each row execute procedure public.bootstrap_briefing_user();

create or replace function public.touch_briefing_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at before update on public.user_profiles
for each row execute procedure public.touch_briefing_updated_at();
drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at before update on public.user_preferences
for each row execute procedure public.touch_briefing_updated_at();
drop trigger if exists user_modules_updated_at on public.user_modules;
create trigger user_modules_updated_at before update on public.user_modules
for each row execute procedure public.touch_briefing_updated_at();

grant select, insert, update, delete on public.user_profiles, public.user_preferences, public.user_modules to authenticated;
