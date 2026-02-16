# gld-task-tracker

Cloud-connected iPad task tracker for a car detailing operation.

## What this build now includes
- iPad-ready PWA shell (`manifest.webmanifest` + `sw.js`)
- Existing task board UI/flow
- Supabase-backed jobs/tasks loading and updates
- Offline queue for timer actions (`Start`, `Pause`, `Finish`) that auto-sync when online
- Zapier webhook Edge Function for CRM -> Supabase ingest

## Project files
- `index.html`: app layout + PWA metadata + Supabase script include
- `styles.css`: responsive iPad-friendly styles
- `app.js`: cloud sync, offline queue, timer/task behavior
- `config.js`: runtime Supabase config (edit this)
- `config.example.js`: config template
- `supabase/schema.sql`: DB schema + RLS policies + triggers
- `supabase/functions/zapier-job-ingest/index.ts`: webhook endpoint for Zapier

## 1. Supabase setup
1. Create a Supabase project.
2. Run SQL from `supabase/schema.sql` in the SQL Editor.
3. If you already created the original schema before this update, also run `supabase/migrations/2026-02-16-detail-job-presets.sql`.
4. Copy your project URL and anon key.
5. Update `config.js`:

```js
window.APP_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

## 2. Deploy Zapier webhook function
Use Supabase CLI from this repo:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ZAPIER_SHARED_SECRET=YOUR_LONG_SECRET
supabase functions deploy zapier-job-ingest
```

Invoke URL format:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/zapier-job-ingest`

## 3. Configure Zapier
In Zapier, use a Webhooks action:
- Method: `POST`
- URL: your function URL above
- Header: `x-zapier-secret: YOUR_LONG_SECRET`
- Header: `content-type: application/json`
- Body (example):
- Body (example):

```json
{
  "external_job_id": "crm-12345",
  "customer": "Jane Doe",
  "vehicle": "2023 BMW X5",
  "service_date": "2026-02-16",
  "detail_job_type": "full_premium",
  "metadata": {
    "crm_job_number": "A-1902",
    "service_package_name": "Full Premium"
  }
}
```

`detail_job_type` is mapped to preset tasks stored in `detail_job_presets`.

## 4. Host the app publicly
You need HTTPS hosting so iPad users can access it anywhere.

Simple options:
- Cloudflare Pages
- Netlify
- Vercel
- Supabase Storage + CDN (if desired)

Publish the repo as a static site. No build step is required.

## 5. Install on iPad
1. Open hosted URL in Safari.
2. Tap Share -> Add to Home Screen.
3. Launch from Home Screen (standalone app mode).

## Offline behavior
- Last loaded jobs/tasks are cached locally.
- Timer actions queue while offline.
- When network returns, queued actions are pushed to Supabase automatically.

## Notes for production hardening
- Add Supabase Auth (email/password or magic link) for per-employee access.
- Tighten RLS by user/team assignment.
- Add job ownership columns (`team_id`, `employee_id`) if needed.
- Add conflict handling strategy for simultaneous edits across devices.
