
-- Profiles
alter table public.profiles add column if not exists phone text;
-- Policy helpers
create or replace policy "Users can read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create or replace policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Events
alter table public.events add column if not exists participants_public boolean default true;
-- Participants status include 'cant'
alter table public.participants drop constraint if exists participants_status_check;
alter table public.participants add constraint participants_status_check check (status in ('going','interested','cant'));
