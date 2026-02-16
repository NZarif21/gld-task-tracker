alter table public.jobs
add column if not exists detail_job_type text;

update public.jobs
set detail_job_type = coalesce(detail_job_type, 'full_standard')
where detail_job_type is null;

alter table public.jobs
alter column detail_job_type set not null;

create table if not exists public.detail_job_presets (
  job_type text primary key,
  display_name text not null,
  tasks jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

drop trigger if exists trg_detail_job_presets_updated_at on public.detail_job_presets;
create trigger trg_detail_job_presets_updated_at
before update on public.detail_job_presets
for each row execute function public.set_updated_at();

alter table public.detail_job_presets enable row level security;

drop policy if exists "Allow anon read presets" on public.detail_job_presets;
create policy "Allow anon read presets"
on public.detail_job_presets
for select
using (true);

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
