// functions/api/deploy.js
import { deployWorker } from "../_core.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

import { deployWorker, deployPages } from "../_core.js";

export async function onRequestPost({ request }) {
  try {
    const payload = await request.json();
    const isPages = payload.deployTarget === 'pages';
    const result = isPages
      ? await deployPages({ ...payload, projectName: payload.workerName, recreateProject: payload.recreateWorker })
      : await deployWorker(payload);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
