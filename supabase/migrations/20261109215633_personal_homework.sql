-- Personal homework is separate from the administrator's existing manual homework.
-- Every row belongs to one authenticated user and is protected by RLS.
create table if not exists public.personal_homework (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 80),
  title text not null check (char_length(trim(title)) between 1 and 200),
  details text not null default '' check (char_length(details) <= 2000),
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_homework_user_due_idx
  on public.personal_homework (user_id, due_date, completed);

alter table public.personal_homework enable row level security;

drop policy if exists "Users manage their own personal homework" on public.personal_homework;
create policy "Users manage their own personal homework"
  on public.personal_homework
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.personal_homework from anon, public;
grant select, insert, update, delete on public.personal_homework to authenticated;

drop trigger if exists personal_homework_updated_at on public.personal_homework;
create trigger personal_homework_updated_at
  before update on public.personal_homework
  for each row execute function public.touch_briefing_updated_at();
