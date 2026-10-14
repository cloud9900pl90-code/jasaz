// --- موتور انکودر و مبهم‌ساز جاوااسکریپت (مطابق با استانداردهای ورکر) ---
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

  // جایگزینی رشته‌های معمولی با فراخوانی جدول دیکودر
  const transformedCode = code.replace(stringRegex, (match) => {
    // نادیده گرفتن دستورات import و export جهت حفظ ساختار ماژول ورکر
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

  // تزریق توابع دیکودر و جدول رشته‌ها به ابتدای اسکریپت
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

// --- هندلر استقرار و به‌روزرسانی ورکر ---
export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    const { accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, enableObfuscation } = data;

    if (!accountId || !apiToken || !workerName || !scriptUrl) {
      return new Response(JSON.stringify({ success: false, error: "فیلدهای اجباری تکمیل نشده‌اند." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = { Authorization: `Bearer ${apiToken}` };

    // ۱. دریافت کدهای ورکر
    const scriptRes = await fetch(scriptUrl);
    if (!scriptRes.ok) {
      return new Response(JSON.stringify({ success: false, error: `خطا در دریافت سورس ورکر: ${scriptRes.statusText}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    let workerScript = await scriptRes.text();

    // ۲. اعمال مبهم‌سازی در صورت درخواست کاربر
    if (enableObfuscation) {
      workerScript = obfuscateWorkerCode(workerScript);
    }

    const bindings = [];
    let d1DatabaseId = null;

    // ۳. مدیریت دیتابیس D1 (شناسایی دیتابیس موجود یا ساخت دیتابیس جدید)
    if (d1Name && bindingName) {
      // بررسی اینکه آیا دیتابیس قبلاً وجود داشته است؟
      const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
        headers,
      });
      const listData = await listRes.json();
      
      const existingDb = listData.result?.find((db) => db.name === d1Name);

      if (existingDb) {
        d1DatabaseId = existingDb.uuid;
      } else {
        // ایجاد دیتابیس در صورت عدم وجود
        const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ name: d1Name }),
        });
        const d1Data = await d1Res.json();
        if (!d1Data.success) {
          return new Response(JSON.stringify({ success: false, error: `خطا در ساخت دیتابیس D1: ${JSON.stringify(d1Data.errors)}` }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        d1DatabaseId = d1Data.result.uuid;
      }

      bindings.push({
        type: "d1",
        name: bindingName,
        id: d1DatabaseId,
      });
    }

    // ۴. آپلود و به‌روزرسانی ورکر (Upsert)
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
      headers,
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      return new Response(JSON.stringify({ success: false, error: `خطا در آپلود ورکر: ${JSON.stringify(uploadData.errors)}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ۵. فعال‌سازی ساب‌دامین
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "ورکر با موفقیت مستقر / به‌روزرسانی شد.",
        workerName,
        d1DatabaseId,
        obfuscated: !!enableObfuscation,
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
