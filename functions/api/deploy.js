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

// --- موتور مبهم‌ساز هوشمند و بدون خطا برای انواع ورکرها (Zeus, Nahan, etc.) ---
const XOR_KEY = 0x4f;

function encodeStringToTable(str, key) {
  const utf8Str = unescape(encodeURIComponent(str));
  let out = "";
  for (let i = 0; i < utf8Str.length; i++) {
    out += String.fromCharCode(utf8Str.charCodeAt(i) ^ (key ^ (i % 11)));
  }
  return btoa(out);
}

function obfuscateWorkerCode(code) {
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

  let i = 0;
  const len = code.length;
  let output = "";

  while (i < len) {
    const char = code[i];
    const nextChar = i + 1 < len ? code[i + 1] : "";

    // ۱. نادیده گرفتن کامل کامنت‌های تک‌خطی (//)
    if (char === "/" && nextChar === "/") {
      const end = code.indexOf("\n", i);
      if (end === -1) {
        output += code.slice(i);
        break;
      }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    // ۲. نادیده گرفتن کامل کامنت‌های چندخطی (/* ... */)
    if (char === "/" && nextChar === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) {
        output += code.slice(i);
        break;
      }
      output += code.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // ۳. حفظ ۱۰۰٪ تمپلیت استرینگ‌ها (بک‌تیک ``): قالب‌های HTML و SVG پنل هرگز خراب نمی‌شوند!
    if (char === "`") {
      let end = i + 1;
      while (end < len) {
        if (code[end] === "\\") {
          end += 2;
        } else if (code[end] === "`") {
          end++;
          break;
        } else {
          end++;
        }
      }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    // ۴. تشخیص و عبور ایمن عبارات باقاعده (RegExp Literals)
    if (char === "/") {
      const trimmed = output.trimEnd();
      const lastChar = trimmed.slice(-1);
      const isRegex = !lastChar || "(=:[,!&|?;{}~^+*%-".includes(lastChar) || /(?:return|case|delete|throw|typeof)\s*$/.test(trimmed);

      if (isRegex) {
        let end = i + 1;
        let inClass = false;
        while (end < len) {
          if (code[end] === "\\") {
            end += 2;
          } else if (code[end] === "[" && !inClass) {
            inClass = true;
            end++;
          } else if (code[end] === "]" && inClass) {
            inClass = false;
            end++;
          } else if (code[end] === "/" && !inClass) {
            end++;
            while (end < len && /[gimsuy]/.test(code[end])) end++;
            break;
          } else {
            end++;
          }
        }
        output += code.slice(i, end);
        i = end;
        continue;
      }
    }

    // ۵. پردازش رشته‌های استاندارد ('...' یا "...")
    if (char === '"' || char === "'") {
      const quote = char;
      const strStart = i;
      let strEnd = i + 1;

      while (strEnd < len) {
        if (code[strEnd] === "\\") {
          strEnd += 2;
        } else if (code[strEnd] === quote) {
          strEnd++;
          break;
        } else if (code[strEnd] === "\n") {
          break;
        } else {
          strEnd++;
        }
      }

      const strLiteral = code.slice(strStart, strEnd);

      let rawVal = null;
      try {
        rawVal = quote === '"'
          ? JSON.parse(strLiteral)
          : JSON.parse(`"${strLiteral.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
      } catch {
        rawVal = strLiteral.slice(1, -1);
      }

      const prevTrimmed = output.trimEnd();

      // الف: عدم تغییر در ایمپورت‌ها و اکسپورت‌های ماژولار (import ... from "...")
      const isImportExport = /(?:from|import)\s*$/.test(prevTrimmed);
      const isDirective = rawVal === "use strict";

      if (isImportExport || isDirective || !rawVal || rawVal.length === 0) {
        output += strLiteral;
        i = strEnd;
        continue;
      }

      // ب: تشخیص دقیق کلید آبجکت و جلوگیری از اشتباه گرفتن شرط سه‌گانه (? :)
      let k = strEnd;
      while (k < len && (code[k] === " " || code[k] === "\t" || code[k] === "\r" || code[k] === "\n")) {
        k++;
      }
      const isFollowedByColon = (code[k] === ":" && code[k + 1] !== ":");

      // بررسی توکن قبلی برای تشخیص شرط سه‌گانه
      const lastToken = prevTrimmed.slice(-1);
      const isTernaryOrCondition = lastToken === "?" || /(?:case)\s*$/.test(prevTrimmed);

      if (isFollowedByColon && !isTernaryOrCondition) {
        // کلید یک آبجکت است (مثل "Content-Type": ...). آن را بدون براکت خراب‌کننده نگه می‌داریم تا سینتکس ۱۰۰٪ معتبر بماند
        output += strLiteral;
      } else {
        // مقدار معمولی یا شرط سه‌گانه است (به صورت func_dec انکود می‌شود بدون اینکه آرایه شود)
        const idx = getOrAddString(rawVal);
        output += `func_dec(${idx})`;
      }

      i = strEnd;
      continue;
    }

    output += char;
    i++;
  }

  // اضافه کردن جدول دیکودر و کش
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
  try {
    out = decodeURIComponent(escape(out));
  } catch (_) {}
  _0x_cache.set(idx, out);
  return out;
}
`;

  return runtimeHeader + "\n" + output;
}

// --- پردازش استقرار در کلودفلر ---
export async function onRequestPost({ request }) {
  try {
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "قالب داده‌های ارسالی معتبر نیست." }, 400);
    }

    const { accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, enableObfuscation, recreateWorker } = data;

    if (!accountId || !apiToken || !workerName || !scriptUrl) {
      return jsonResponse({ success: false, error: "لطفاً تمامی فیلدهای الزامی را پر کنید." }, 400);
    }

    const cfHeaders = { Authorization: `Bearer ${apiToken}` };

    // ۱. دانلود سورس کد از گیت‌هاب توسط سرورهای کلودفلر
    let workerScript = "";
    try {
      const scriptRes = await fetch(scriptUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PagesDeployer/1.0" },
      });
      if (!scriptRes.ok) {
        return jsonResponse({ success: false, error: `خطا در دریافت سورس ورکر: ${scriptRes.status} ${scriptRes.statusText}` }, 400);
      }
      workerScript = await scriptRes.text();
    } catch (fetchErr) {
      return jsonResponse({ success: false, error: `خطا در دانلود سورس از لینک: ${fetchErr.message}` }, 400);
    }

    // ۲. اعمال مبهم‌سازی هوشمند و سازگار با HTML
    if (enableObfuscation) {
      try {
        workerScript = obfuscateWorkerCode(workerScript);
      } catch (obfErr) {
        return jsonResponse({ success: false, error: `خطا در فرآیند مبهم‌سازی: ${obfErr.message}` }, 400);
      }
    }

    const bindings = [];
    let d1DatabaseId = null;

    // ۳. مدیریت دیتابیس D1
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

    // ۴. در صورت فعال بودن Recreate، ابتدا ورکر قبلی حذف می‌شود
    if (recreateWorker) {
      try {
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
          method: "DELETE",
          headers: cfHeaders,
        });
      } catch {
        // نادیده گرفتن
      }
    }

    // ۵. آپلود ورکر
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

    // ۶. فعال‌سازی ساب‌دامین و استخراج آدرس کامل
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
    } catch {
      // نادیده گرفتن
    }

    return jsonResponse({
      success: true,
      message: recreateWorker ? "ورکر قبلی حذف و مجدداً از صفر ساخته شد." : "ورکر با موفقیت مستقر شد.",
      workerName,
      workerUrl,
      d1DatabaseId,
      obfuscated: !!enableObfuscation,
      recreated: !!recreateWorker,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: `خطای سرور: ${err.message}` }, 500);
  }
}
