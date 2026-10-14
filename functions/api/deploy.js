export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    const { accountId, apiToken, workerName, scriptUrl, d1Name, bindingName } = data;

    if (!accountId || !apiToken || !workerName || !scriptUrl) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
    };

    // 1. Fetch worker code from the remote URL
    const scriptRes = await fetch(scriptUrl);
    if (!scriptRes.ok) {
      return new Response(JSON.stringify({ success: false, error: `Failed to fetch worker.js: ${scriptRes.statusText}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const workerScript = await scriptRes.text();

    const bindings = [];

    // 2. Optional: Create D1 Database and bind it
    let d1DatabaseId = null;
    if (d1Name && bindingName) {
      const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: d1Name }),
      });

      const d1Data = await d1Res.json();
      if (!d1Data.success) {
        return new Response(JSON.stringify({ success: false, error: `D1 Creation Failed: ${JSON.stringify(d1Data.errors)}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      d1DatabaseId = d1Data.result.uuid;
      bindings.push({
        type: "d1",
        name: bindingName,
        id: d1DatabaseId,
      });
    }

    // 3. Upload Worker with ES Module syntax and Bindings via Multipart Form Data
    const formData = new FormData();
    const metadata = {
      main_module: "worker.js",
      bindings: bindings,
      compatibility_date: new Date().toISOString().split("T")[0],
    };

    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("worker.js", new Blob([workerScript], { type: "application/javascript+module" }), "worker.js");

    const uploadRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: "PUT",
      headers: headers,
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      return new Response(JSON.stringify({ success: false, error: `Worker Upload Failed: ${JSON.stringify(uploadData.errors)}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Enable workers.dev subdomain for the worker
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Worker deployed successfully!",
        workerName,
        d1DatabaseId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
