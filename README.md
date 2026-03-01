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

## 2. Deploy ingest webhook function
Use Supabase CLI from this repo:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set JOB_INGEST_SHARED_SECRET=YOUR_LONG_SECRET
supabase functions deploy zapier-job-ingest
```

Invoke URL format:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/zapier-job-ingest`

Legacy compatibility:
- `ZAPIER_SHARED_SECRET` still works if already configured.
- Header `x-zapier-secret` still works.

## 3. Configure Zapier (optional)
If you continue using Zapier Webhooks, use:
- Method: `POST`
- URL: your function URL above
- Header: `x-ingest-secret: YOUR_LONG_SECRET` (or `x-zapier-secret`)
- Header: `content-type: application/json`
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

## 4. Configure Google Sheets + Apps Script (free polling path)
If you want to avoid Zapier premium steps, use this flow:

1. Send OrbisX booking data into a Google Sheet (via OrbisX export/webhook/tooling).
2. Add these columns in row 1:
   - `external_job_id`
   - `customer`
   - `vehicle`
   - `service_date`
   - `detail_job_type`
   - `crm_job_number` (optional)
   - `service_package_name` (optional)
   - `sync_status` (empty initially)
   - `synced_at` (empty initially)
   - `sync_response` (empty initially)
3. In the Sheet: Extensions -> Apps Script, then paste this script:

```javascript
const INGEST_URL = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/zapier-job-ingest";
const INGEST_SECRET = "YOUR_LONG_SECRET";
const SHEET_NAME = "Bookings";

function syncBookingsToSupabase() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Missing sheet: ${SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const header = values[0];
  const idx = Object.fromEntries(header.map((name, i) => [String(name).trim(), i]));

  const required = [
    "external_job_id",
    "customer",
    "vehicle",
    "service_date",
    "detail_job_type",
    "sync_status",
    "synced_at",
    "sync_response",
  ];
  required.forEach((name) => {
    if (idx[name] === undefined) throw new Error(`Missing required column: ${name}`);
  });

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const status = String(row[idx.sync_status] || "").toLowerCase();
    if (status === "ok") continue;

    const payload = {
      external_job_id: String(row[idx.external_job_id] || "").trim(),
      customer: String(row[idx.customer] || "").trim(),
      vehicle: String(row[idx.vehicle] || "").trim(),
      service_date: normalizeDate(row[idx.service_date]),
      detail_job_type: String(row[idx.detail_job_type] || "").trim(),
      metadata: {
        crm_job_number: idx.crm_job_number !== undefined ? row[idx.crm_job_number] : null,
        service_package_name:
          idx.service_package_name !== undefined ? row[idx.service_package_name] : null,
      },
    };

    if (
      !payload.external_job_id ||
      !payload.customer ||
      !payload.vehicle ||
      !payload.service_date ||
      !payload.detail_job_type
    ) {
      sheet.getRange(r + 1, idx.sync_status + 1).setValue("error");
      sheet.getRange(r + 1, idx.sync_response + 1).setValue("Missing required fields");
      continue;
    }

    try {
      const resp = UrlFetchApp.fetch(INGEST_URL, {
        method: "post",
        contentType: "application/json",
        headers: {
          "x-ingest-secret": INGEST_SECRET,
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const code = resp.getResponseCode();
      const body = resp.getContentText();
      const ok = code >= 200 && code < 300;

      sheet.getRange(r + 1, idx.sync_status + 1).setValue(ok ? "ok" : "error");
      sheet.getRange(r + 1, idx.synced_at + 1).setValue(new Date());
      sheet.getRange(r + 1, idx.sync_response + 1).setValue(body.slice(0, 500));
    } catch (e) {
      sheet.getRange(r + 1, idx.sync_status + 1).setValue("error");
      sheet.getRange(r + 1, idx.sync_response + 1).setValue(String(e).slice(0, 500));
    }
  }
}

function normalizeDate(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "UTC", "yyyy-MM-dd");
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, "UTC", "yyyy-MM-dd");
  return "";
}
```

4. Click Run on `syncBookingsToSupabase` once to authorize.
5. In Apps Script: Triggers -> Add Trigger:
   - Function: `syncBookingsToSupabase`
   - Event source: `Time-driven`
   - Type: every 5 or 15 minutes
6. Ensure `detail_job_type` values match presets in `detail_job_presets` (`full_premium`, `full_standard`, `partial_standard`, etc.).

The ingest function upserts by `external_job_id`, so re-running the same row updates the existing job safely.

## 5. Host the app publicly
You need HTTPS hosting so iPad users can access it anywhere.

Simple options:
- Cloudflare Pages
- Netlify
- Vercel
- Supabase Storage + CDN (if desired)

Publish the repo as a static site. No build step is required.

## 6. Install on iPad
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
