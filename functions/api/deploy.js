const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function onRequestPost({ request }) {
  try {
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "قالب داده‌ها معتبر نیست." }, 400);
    }

    const { accountId, apiToken, workerName, scriptCode, d1Name, bindingName, recreateWorker } = data;

    if (!accountId || !apiToken || !workerName || !scriptCode) {
      return jsonResponse({ success: false, error: "اطلاعات ارسالی ناقص است." }, 400);
    }

    const cfHeaders = { Authorization: `Bearer ${apiToken}` };

    // ۱. مدیریت دیتابیس D1
    const bindings = [];
    let d1DatabaseId = null;

    if (d1Name && bindingName) {
      try {
        const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
          headers: cfHeaders,
        });
        const listData = await listRes.json();

        if (!listData.success) {
          return jsonResponse({ success: false, error: `توکن معتبر نیست یا دسترسی D1 ندارد: ${JSON.stringify(listData.errors)}` }, 400);
        }

        const existingDb = listData.result?.find((db) => db.name === d1Name);

        if (existingDb) {
          d1DatabaseId = existingDb.uuid;
        } else {
          const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
            method: "POST",
            headers: { ...cfHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ name: d1Name }),
          });
          const d1Data = await d1Res.json();
          if (!d1Data.success) {
            return jsonResponse({ success: false, error: `خطا در ایجاد دیتابیس D1: ${JSON.stringify(d1Data.errors)}` }, 400);
          }
          d1DatabaseId = d1Data.result.uuid;
        }

        bindings.push({
          type: "d1",
          name: bindingName,
          id: d1DatabaseId,
        });
      } catch (d1Err) {
        return jsonResponse({ success: false, error: `خطا در دیتابیس D1: ${d1Err.message}` }, 400);
      }
    }

    // ۲. در صورت فعال بودن Clean Rebuild، حذف ورکر قبلی
    if (recreateWorker) {
      try {
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
          method: "DELETE",
          headers: cfHeaders,
        });
      } catch {}
    }

    // ۳. آپلود مستقیم کدهای پردازش‌شده
    const isModule = scriptCode.includes("export default") || scriptCode.includes("export ");
    const formData = new FormData();
    const metadata = {
      ...(isModule ? { main_module: "worker.js" } : { body_part: "worker.js" }),
      bindings: bindings,
      compatibility_date: new Date().toISOString().split("T")[0],
    };

    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("worker.js", new Blob([scriptCode], { type: "application/javascript+module" }), "worker.js");

    const uploadRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: "PUT",
      headers: cfHeaders,
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      return jsonResponse({ success: false, error: `کلودفلر ورکر را نپذیرفت: ${JSON.stringify(uploadData.errors)}` }, 400);
    }

    // ۴. فعال‌سازی دامنه و استخراج آدرس
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
      method: "POST",
      headers: { ...cfHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    let workerUrl = null;
    try {
      const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
        headers: cfHeaders,
      });
      const subData = await subRes.json();
      if (subData.success && subData.result?.subdomain) {
        workerUrl = `https://${workerName}.${subData.result.subdomain}.workers.dev`;
      }
    } catch {}

    return jsonResponse({
      success: true,
      message: "ورکر با موفقیت مستقر شد.",
      workerName,
      workerUrl,
      d1DatabaseId,
      recreated: !!recreateWorker,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: `خطای سرور: ${err.message}` }, 500);
  }
}
