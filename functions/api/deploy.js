// --- هدرهای سراسری جهت جلوگیری قطعی از خطای CORS و NetworkError ---
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

// هندلر درخواست‌های پیش‌پرواز مرورگر (Preflight)
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// --- موتور مبهم‌ساز جاوااسکریپت (XOR Table) ---
const XOR_KEY = 0x4f;

function encodeStringToTable(str, key) {
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(str);
  const xorBytes = new Uint8Array(rawBytes.length);
  for (let i = 0; i < rawBytes.length; i++) {
    xorBytes[i] = rawBytes[i] ^ (key ^ (i % 11));
  }
  let binary = "";
  for (let i = 0; i < xorBytes.byteLength; i++) {
    binary += String.fromCharCode(xorBytes[i]);
  }
  return btoa(binary);
}

function obfuscateWorkerCode(code) {
  const stringRegex = /(["'])(?:(?=(\\?))\2[\s\S])*?\1/g;
  const stringTable = [];
  const stringIndexMap = new Map();

  function getOrAddString(strContent) {
    if (stringIndexMap.has(strContent)) {
      return stringIndexMap.get(strContent);
    }
    const idx = stringTable.length;
    stringTable.push(encodeStringToTable(strContent, XOR_KEY));
    stringIndexMap.set(strContent, idx);
    return idx;
  }

  const transformedCode = code.replace(stringRegex, (match) => {
    if (match.includes("from ") || match.length <= 2) return match;
    try {
      const rawContent = JSON.parse(match.startsWith("'") ? `"${match.slice(1, -1).replace(/"/g, '\\"')}"` : match);
      if (rawContent.length < 2) return match;
      const idx = getOrAddString(rawContent);
      return `func_dec(${idx})`;
    } catch {
      return match;
    }
  });

  const runtimeHeader = `// @ts-nocheck
const _0x_key = ${XOR_KEY};
const _0x_tbl = ${JSON.stringify(stringTable)};
const _0x_cache = new Map();
function func_dec(idx) {
  if (_0x_cache.has(idx)) return _0x_cache.get(idx);
  const raw = atob(_0x_tbl[idx]);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ (_0x_key ^ (i % 11)));
  }
  _0x_cache.set(idx, out);
  return out;
}
`;
  return runtimeHeader + "\n" + transformedCode;
}

// --- پردازش اصلی در بک‌اند کلودفلر ---
export async function onRequestPost({ request }) {
  try {
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "قالب داده‌های ارسالی معتبر نیست." }, 400);
    }

    const { accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, enableObfuscation } = data;

    if (!accountId || !apiToken || !workerName || !scriptUrl) {
      return jsonResponse({ success: false, error: "لطفاً تمامی فیلدهای الزامی را پر کنید." }, 400);
    }

    const cfHeaders = { Authorization: `Bearer ${apiToken}` };

    // ۱. دانلود سورس کد از گیت‌هاب مستقیماً توسط سرورهای کلودفلر (بدون تحریم)
    let workerScript = "";
    try {
      const scriptRes = await fetch(scriptUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PagesDeployer/1.0" },
      });
      if (!scriptRes.ok) {
        return jsonResponse({ success: false, error: `سرور کلودفلر نتوانست فایل کد را دانلود کند: ${scriptRes.status} ${scriptRes.statusText}` }, 400);
      }
      workerScript = await scriptRes.text();
    } catch (fetchErr) {
      return jsonResponse({ success: false, error: `خطا در دانلود سورس از لینک اعلام شده: ${fetchErr.message}` }, 400);
    }

    // ۲. مبهم‌سازی در سرور کلودفلر
    if (enableObfuscation) {
      try {
        workerScript = obfuscateWorkerCode(workerScript);
      } catch (obfErr) {
        return jsonResponse({ success: false, error: `خطا در فرآیند مبهم‌سازی: ${obfErr.message}` }, 400);
      }
    }

    const bindings = [];
    let d1DatabaseId = null;

    // ۳. مدیریت دیتابیس D1 مستقیماً توسط بک‌اند
    if (d1Name && bindingName) {
      try {
        const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
          headers: cfHeaders,
        });
        const listData = await listRes.json();

        if (!listData.success) {
          return jsonResponse({ success: false, error: `کلید API معتبر نیست یا دسترسی D1 ندارد: ${JSON.stringify(listData.errors)}` }, 400);
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
        return jsonResponse({ success: false, error: `خطا در برقراری ارتباط با دیتابیس D1: ${d1Err.message}` }, 400);
      }
    }

    // ۴. ساخت فرم پلود و ارسال به Cloudflare Workers API
    const isModule = workerScript.includes("export default") || workerScript.includes("export ");
    const formData = new FormData();
    const metadata = {
      ...(isModule ? { main_module: "worker.js" } : { body_part: "worker.js" }),
      bindings: bindings,
      compatibility_date: new Date().toISOString().split("T")[0],
    };

    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("worker.js", new Blob([workerScript], { type: "application/javascript+module" }), "worker.js");

    const uploadRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: "PUT",
      headers: cfHeaders,
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      return jsonResponse({ success: false, error: `کلودفلر ورکر را نپذیرفت: ${JSON.stringify(uploadData.errors)}` }, 400);
    }

    // ۵. فعال‌سازی دامنه workers.dev
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
      method: "POST",
      headers: { ...cfHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    return jsonResponse({
      success: true,
      message: "ورکر با موفقیت مستقر و به روزرسانی شد.",
      workerName,
      d1DatabaseId,
      obfuscated: !!enableObfuscation,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: `خطای ناشناخته در بک‌اند: ${err.message}` }, 500);
  }
}
