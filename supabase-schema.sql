-- MeetManager historical archive schema
-- Paste into Supabase Dashboard -> SQL Editor -> New query, and run once.
--
-- Design notes:
-- * Live timing stays on Firebase. Supabase only stores FINAL results,
--   published from the app's saved races (heatAccumulator) at meet end.
-- * Only signed-in directors can write, and only to their own meets (RLS).
-- * Re-publishing the same meet replaces its results (delete + insert),
--   keyed on (owner, athletic_net_meet_id).

-- ── Tables ──────────────────────────────────────────────────────────────

create table if not exists public.meets (
  id                   bigint generated always as identity primary key,
  owner_uid            uuid not null references auth.users (id) on delete cascade,
  athletic_net_meet_id text,
  name                 text,
  meet_date            date,
  published_at         timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

-- One archived copy of a given Athletic.net meet per director account.
-- (Different directors may archive the same meet independently.)
create unique index if not exists meets_owner_anet_unique
  on public.meets (owner_uid, athletic_net_meet_id)
  where athletic_net_meet_id is not null;

create table if not exists public.race_results (
  id              bigint generated always as identity primary key,
  meet_id         bigint not null references public.meets (id) on delete cascade,
  event_number    text,
  event_name      text not null,
  gender          text,
  age_group       text,
  race_label      text,    -- "Heat 1", "Section 2", combined-race label, etc.
  lane_or_hip     text,
  place           int,
  result_ms       bigint,  -- raw milliseconds; the queryable value
  result_text     text,    -- formatted time as exported, e.g. "1:23.45"
  status          text,    -- OK / DNS
  athlete         text,
  age             text,
  club            text,
  seed            text,
  competitor_type text,    -- Individual / Relay
  created_at      timestamptz not null default now()
);

create index if not exists race_results_meet_idx    on public.race_results (meet_id);
create index if not exists race_results_athlete_idx on public.race_results (athlete, club);
create index if not exists race_results_event_idx   on public.race_results (event_name, gender, age_group);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Directors read and write only their own archive. Nothing is public;
-- if you later want public results pages, add a separate select policy.

alter table public.meets        enable row level security;
alter table public.race_results enable row level security;

drop policy if exists "meets owner select" on public.meets;
create policy "meets owner select" on public.meets
  for select using (owner_uid = auth.uid());

drop policy if exists "meets owner insert" on public.meets;
create policy "meets owner insert" on public.meets
  for insert with check (owner_uid = auth.uid());

drop policy if exists "meets owner update" on public.meets;
create policy "meets owner update" on public.meets
  for update using (owner_uid = auth.uid()) with check (owner_uid = auth.uid());

drop policy if exists "meets owner delete" on public.meets;
create policy "meets owner delete" on public.meets
  for delete using (owner_uid = auth.uid());

drop policy if exists "results owner select" on public.race_results;
create policy "results owner select" on public.race_results
  for select using (exists (
    select 1 from public.meets m
    where m.id = race_results.meet_id and m.owner_uid = auth.uid()));

drop policy if exists "results owner insert" on public.race_results;
create policy "results owner insert" on public.race_results
  for insert with check (exists (
    select 1 from public.meets m
    where m.id = race_results.meet_id and m.owner_uid = auth.uid()));

drop policy if exists "results owner delete" on public.race_results;
create policy "results owner delete" on public.race_results
  for delete using (exists (
    select 1 from public.meets m
    where m.id = race_results.meet_id and m.owner_uid = auth.uid()));

-- ── Setup checklist (outside this file) ─────────────────────────────────
-- 1. Authentication -> Providers: enable Email (directors sign in to the
--    archive with email/password; can be the same email as Firebase).
-- 2. Authentication -> URL Configuration: add your Netlify domain.
-- 3. Project Settings -> API: copy Project URL + anon public key into
--    the SUPABASE_CONFIG block near the top of index.html's script.
