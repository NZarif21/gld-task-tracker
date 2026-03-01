import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ZapTask = {
  title: string;
};

type ZapPayload = {
  external_job_id: string;
  customer: string;
  vehicle: string;
  service_date: string;
  detail_job_type: string;
  metadata?: Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-zapier-secret, x-ingest-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const incomingSecret = req.headers.get("x-ingest-secret") ?? req.headers.get("x-zapier-secret");
    const expectedSecret =
      Deno.env.get("JOB_INGEST_SHARED_SECRET") ?? Deno.env.get("ZAPIER_SHARED_SECRET");

    if (!expectedSecret || incomingSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ZapPayload;
    if (
      !body.external_job_id ||
      !body.customer ||
      !body.vehicle ||
      !body.service_date ||
      !body.detail_job_type
    ) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: preset, error: presetError } = await supabase
      .from("detail_job_presets")
      .select("tasks, display_name")
      .eq("job_type", body.detail_job_type)
      .single();

    if (presetError || !preset || !Array.isArray(preset.tasks) || preset.tasks.length === 0) {
      return new Response(JSON.stringify({ error: "Unknown detail_job_type preset" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: upsertedJob, error: upsertError } = await supabase
      .from("jobs")
      .upsert(
        {
          external_job_id: body.external_job_id,
          customer: body.customer,
          vehicle: body.vehicle,
          detail_job_type: body.detail_job_type,
          service_date: body.service_date,
          payload: body,
        },
        { onConflict: "external_job_id" }
      )
      .select("id")
      .single();

    if (upsertError || !upsertedJob) {
      throw upsertError || new Error("Failed to upsert job");
    }

    const jobId = upsertedJob.id;

    const { error: deleteError } = await supabase.from("job_tasks").delete().eq("job_id", jobId);
    if (deleteError) {
      throw deleteError;
    }

    const presetTasks = preset.tasks as ZapTask[];
    const rows = presetTasks.map((task, index) => ({
        job_id: jobId,
        title: task.title,
        priority: index + 1,
        status: "queued",
        elapsed_ms: 0,
      }));

    const { error: insertError } = await supabase.from("job_tasks").insert(rows);
    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: jobId,
        detail_job_type: body.detail_job_type,
        preset_name: preset.display_name,
        tasks_inserted: rows.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
