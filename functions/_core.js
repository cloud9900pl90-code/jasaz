// functions/_core.js
const XOR_KEY = 0x4f;

function encodeStringToTable(str, key) {
  const utf8Str = unescape(encodeURIComponent(str));
  let out = "";
  for (let i = 0; i < utf8Str.length; i++) {
    out += String.fromCharCode(utf8Str.charCodeAt(i) ^ (key ^ (i % 11)));
  }
  return btoa(out);
}

export function obfuscateWorkerCode(code) {
  const stringTable = [];
  const stringIndexMap = new Map();

  function getOrAddString(strContent) {
    if (stringIndexMap.has(strContent)) return stringIndexMap.get(strContent);
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

    if (char === "/" && nextChar === "/") {
      const end = code.indexOf("\n", i);
      if (end === -1) { output += code.slice(i); break; }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) { output += code.slice(i); break; }
      output += code.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    if (char === "`") {
      let end = i + 1;
      while (end < len) {
        if (code[end] === "\\") end += 2;
        else if (code[end] === "`") { end++; break; }
        else end++;
      }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    if (char === "/") {
      const trimmed = output.trimEnd();
      const lastChar = trimmed.slice(-1);
      const isRegex = !lastChar || "(=:[,!&|?;{}~^+*%-".includes(lastChar) || /(?:return|case|delete|throw|typeof)\s*$/.test(trimmed);

      if (isRegex) {
        let end = i + 1;
        let inClass = false;
        while (end < len) {
          if (code[end] === "\\") end += 2;
          else if (code[end] === "[" && !inClass) { inClass = true; end++; }
          else if (code[end] === "]" && inClass) { inClass = false; end++; }
          else if (code[end] === "/" && !inClass) {
            end++;
            while (end < len && /[gimsuy]/.test(code[end])) end++;
            break;
          } else end++;
        }
        output += code.slice(i, end);
        i = end;
        continue;
      }
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const strStart = i;
      let strEnd = i + 1;

      while (strEnd < len) {
        if (code[strEnd] === "\\") strEnd += 2;
        else if (code[strEnd] === quote) { strEnd++; break; }
        else if (code[strEnd] === "\n") break;
        else strEnd++;
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
      const isImportExport = /(?:from|import)\s*$/.test(prevTrimmed);
      const isDirective = rawVal === "use strict";

      if (isImportExport || isDirective || !rawVal || rawVal.length === 0) {
        output += strLiteral;
        i = strEnd;
        continue;
      }

      let k = strEnd;
      while (k < len && (code[k] === " " || code[k] === "\t" || code[k] === "\r" || code[k] === "\n")) k++;
      const isFollowedByColon = (code[k] === ":" && code[k + 1] !== ":");
      const lastToken = prevTrimmed.slice(-1);
      const isTernaryOrCondition = lastToken === "?" || /(?:case)\s*$/.test(prevTrimmed);

      if (isFollowedByColon && !isTernaryOrCondition) {
        output += strLiteral;
      } else {
        const idx = getOrAddString(rawVal);
        output += `func_dec(${idx})`;
      }

      i = strEnd;
      continue;
    }

    output += char;
    i++;
  }

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

export async function deployWorker({ accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, enableObfuscation, recreateWorker }) {
  if (!accountId || !apiToken || !workerName || !scriptUrl) {
    throw new Error("فیلدهای اجباری (Account ID، Token، نام ورکر و آدرس سورس) ناقص هستند.");
  }

  const cfHeaders = { Authorization: `Bearer ${apiToken}` };

  // ۱. دریافت فایل سورس
  const scriptRes = await fetch(scriptUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PagesDeployer/1.0" },
  });
  if (!scriptRes.ok) {
    throw new Error(`خطا در دانلود سورس: ${scriptRes.status} ${scriptRes.statusText}`);
  }
  let workerScript = await scriptRes.text();

  // ۲. مبهم‌سازی در صورت درخواست
  if (enableObfuscation) {
    workerScript = obfuscateWorkerCode(workerScript);
  }

  // ۳. مدیریت دیتابیس D1
  const bindings = [];
  let d1DatabaseId = null;

  if (d1Name && bindingName) {
    const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
      headers: cfHeaders,
    });
    const listData = await listRes.json();

    if (!listData.success) {
      throw new Error(`خطای احراز هویت دیتابیس D1: ${JSON.stringify(listData.errors)}`);
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
        throw new Error(`خطا در ایجاد D1: ${JSON.stringify(d1Data.errors)}`);
      }
      d1DatabaseId = d1Data.result.uuid;
    }

    bindings.push({ type: "d1", name: bindingName, id: d1DatabaseId });
  }

  // ۴. حذف ورکر قبلی در صورت نیاز
  if (recreateWorker) {
    try {
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
        method: "DELETE",
        headers: cfHeaders,
      });
    } catch (_) {}
  }

  // ۵. بارگذاری سورس روی کلودفلر
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
    throw new Error(`خطا از سوی کلودفلر: ${JSON.stringify(uploadData.errors)}`);
  }

  // ۶. فعال‌سازی ساب‌دامین
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
  } catch (_) {}

  return {
    success: true,
    workerName,
    workerUrl,
    d1DatabaseId,
    obfuscated: !!enableObfuscation,
    recreated: !!recreateWorker,
  };
}
