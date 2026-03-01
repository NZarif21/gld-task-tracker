-- Expand detail job presets for common detailing packages.
-- Run this in Supabase SQL Editor (or via migration tooling).
-- Safe to re-run: uses upsert semantics on job_type.

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
),
(
  'express_detail',
  'Express Detail',
  '[
    {"title":"Exterior Hand Wash"},
    {"title":"Tire Shine"},
    {"title":"Interior Quick Vacuum"},
    {"title":"Dash + Console Wipe"},
    {"title":"Windows + Final QC"}
  ]'::jsonb
),
(
  'wash_and_vac',
  'Wash and Vac',
  '[
    {"title":"Exterior Wash"},
    {"title":"Wheel Face Clean"},
    {"title":"Dry + Door Jamb Wipe"},
    {"title":"Cabin Vacuum"},
    {"title":"Glass Touch-Up"}
  ]'::jsonb
),
(
  'interior_deep_clean',
  'Interior Deep Clean',
  '[
    {"title":"Cabin Declutter + Prep"},
    {"title":"Deep Vacuum (Seats, Carpets, Trunk)"},
    {"title":"Steam/Brush High-Touch Surfaces"},
    {"title":"Leather/Fabric Treatment"},
    {"title":"Interior Glass + Final QC"}
  ]'::jsonb
),
(
  'exterior_only',
  'Exterior Only',
  '[
    {"title":"Pre-Rinse + Foam"},
    {"title":"Contact Wash"},
    {"title":"Wheels + Tires"},
    {"title":"Dry + Spray Sealant"},
    {"title":"Exterior Glass + Final QC"}
  ]'::jsonb
),
(
  'ceramic_maintenance',
  'Ceramic Maintenance',
  '[
    {"title":"pH-Neutral Foam Wash"},
    {"title":"Careful Contact Wash"},
    {"title":"Decon (Light Iron/Tar if needed)"},
    {"title":"Ceramic Topper Application"},
    {"title":"Dry + Streak-Free Final QC"}
  ]'::jsonb
),
(
  'paint_correction_one_step',
  'Paint Correction - One Step',
  '[
    {"title":"Wash + Chemical Decontamination"},
    {"title":"Clay Bar + Prep"},
    {"title":"Masking + Paint Inspection"},
    {"title":"One-Step Machine Polish"},
    {"title":"Paint Protection + Final QC"}
  ]'::jsonb
),
(
  'paint_correction_two_step',
  'Paint Correction - Two Step',
  '[
    {"title":"Wash + Chemical Decontamination"},
    {"title":"Clay Bar + Prep"},
    {"title":"Masking + Paint Inspection"},
    {"title":"Compounding Stage"},
    {"title":"Polishing Stage"},
    {"title":"Paint Protection + Final QC"}
  ]'::jsonb
),
(
  'engine_bay_detail',
  'Engine Bay Detail',
  '[
    {"title":"Sensitive Area Cover + Prep"},
    {"title":"Degrease + Agitate"},
    {"title":"Low-Pressure Rinse/Wipe"},
    {"title":"Dry + Dress Plastics"},
    {"title":"Final Safety + QC Check"}
  ]'::jsonb
),
(
  'headlight_restoration',
  'Headlight Restoration',
  '[
    {"title":"Mask Surrounding Panels"},
    {"title":"Progressive Wet Sand"},
    {"title":"Compound + Polish"},
    {"title":"UV Protectant/Coating"},
    {"title":"Clarity + Beam Pattern QC"}
  ]'::jsonb
),
(
  'odor_removal',
  'Odor Removal',
  '[
    {"title":"Interior Inspection + Source Check"},
    {"title":"Deep Vacuum + Spot Treatment"},
    {"title":"Shampoo/Steam Affected Areas"},
    {"title":"Cabin Filter Check/Replace (if requested)"},
    {"title":"Ozone/Neutralizer Treatment"},
    {"title":"Post-Treatment Ventilation + QC"}
  ]'::jsonb
),
(
  'new_car_protection',
  'New Car Protection',
  '[
    {"title":"Initial Wash + Prep"},
    {"title":"Paint Surface Inspection"},
    {"title":"Light Prep Polish (if needed)"},
    {"title":"Sealant/Ceramic Application"},
    {"title":"Interior Protectant Application"},
    {"title":"Delivery + Care Instructions"}
  ]'::jsonb
)
on conflict (job_type) do update
set display_name = excluded.display_name,
    tasks = excluded.tasks,
    updated_at = now();

-- Quick verification query:
-- select job_type, display_name, jsonb_array_length(tasks) as task_count
-- from public.detail_job_presets
-- order by job_type;
