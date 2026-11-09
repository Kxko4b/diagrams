-- Remove default privileges such as TRUNCATE, TRIGGER and REFERENCES.
-- Personal homework only needs ordinary row-level CRUD from signed-in users.
revoke all on public.personal_homework from anon, public, authenticated;
grant select, insert, update, delete on public.personal_homework to authenticated;
