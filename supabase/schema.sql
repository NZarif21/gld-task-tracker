create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  external_job_id text unique not null,
  customer text not null,
  vehicle text not null,
  detail_job_type text not null,
  service_date date not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.detail_job_presets (
  job_type text primary key,
  display_name text not null,
  tasks jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null,
  priority integer not null,
  status text not null default 'queued' check (status in ('queued', 'paused', 'running', 'completed')),
  elapsed_ms bigint not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, priority)
);

create table if not exists public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.job_tasks(id) on delete cascade,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists trg_job_tasks_updated_at on public.job_tasks;
create trigger trg_job_tasks_updated_at
before update on public.job_tasks
for each row execute function public.set_updated_at();

drop trigger if exists trg_detail_job_presets_updated_at on public.detail_job_presets;
create trigger trg_detail_job_presets_updated_at
before update on public.detail_job_presets
for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;
alter table public.job_tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.detail_job_presets enable row level security;

drop policy if exists "Allow anon read jobs" on public.jobs;
create policy "Allow anon read jobs"
on public.jobs
for select
using (true);

drop policy if exists "Allow anon read tasks" on public.job_tasks;
create policy "Allow anon read tasks"
on public.job_tasks
for select
using (true);

drop policy if exists "Allow anon read presets" on public.detail_job_presets;
create policy "Allow anon read presets"
on public.detail_job_presets
for select
using (true);

drop policy if exists "Allow anon update tasks" on public.job_tasks;
create policy "Allow anon update tasks"
on public.job_tasks
for update
using (true)
with check (true);

drop policy if exists "Allow anon insert events" on public.task_events;
create policy "Allow anon insert events"
on public.task_events
for insert
with check (true);

drop policy if exists "Allow service role full jobs" on public.jobs;
create policy "Allow service role full jobs"
on public.jobs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Allow service role full tasks" on public.job_tasks;
create policy "Allow service role full tasks"
on public.job_tasks
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Allow service role full presets" on public.detail_job_presets;
create policy "Allow service role full presets"
on public.detail_job_presets
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.detail_job_presets (job_type, display_name, tasks)
values
(
  'full_premium',
  'Full Premium',
  '[
    {"title":"Exterior Foam Pre-Wash"},
    {"title":"Contact Wash + Wheel Barrels"},
    {"title":"Clay Bar Decontamination"},
    {"title":"One-Step Paint Correction"},
    {"title":"Ceramic Coating Application"},
    {"title":"Interior Vacuum + Wipe Down"},
    {"title":"Glass and Final QC"}
  ]'::jsonb
),
(
  'full_standard',
  'Full Standard',
  '[
    {"title":"Exterior Rinse and Wash"},
    {"title":"Wheel and Tire Cleaning"},
    {"title":"Interior Vacuum"},
    {"title":"Interior Surface Wipe Down"},
    {"title":"Windows and Mirrors"},
    {"title":"Final Quality Check"}
  ]'::jsonb
),
(
  'partial_standard',
  'Partial Standard',
  '[
    {"title":"Targeted Exterior Wash"},
    {"title":"Quick Wheel Clean"},
    {"title":"Front Cabin Vacuum"},
    {"title":"Spot Interior Wipe"},
    {"title":"Final Check"}
  ]'::jsonb
)
on conflict (job_type) do update
set display_name = excluded.display_name,
    tasks = excluded.tasks,
    updated_at = now();
