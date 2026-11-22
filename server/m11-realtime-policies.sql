-- Private Kxko M11 control channel.
-- Only the existing Kxko admin auth user can use this topic.
create policy "kxko m11 admin can receive control broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() = 'kxko-m11-control-v1'
  and (select auth.uid()) = 'ea1b170e-192b-43c6-a25a-e5e6bef7e6e2'::uuid
  and extension = 'broadcast'
);

create policy "kxko m11 admin can send control broadcasts"
on realtime.messages
for insert
to authenticated
with check (
  realtime.topic() = 'kxko-m11-control-v1'
  and (select auth.uid()) = 'ea1b170e-192b-43c6-a25a-e5e6bef7e6e2'::uuid
  and extension = 'broadcast'
);
