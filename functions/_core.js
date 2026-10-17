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

export async function deployWorker({ accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, kvName, kvBindingName, enableObfuscation, recreateWorker }) {
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

  const bindings = [];
  let d1DatabaseId = null;
  let kvNamespaceId = null;

  // ۳. مدیریت دیتابیس D1
  if (d1Name && bindingName) {
    const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
      headers: cfHeaders,
    });
    const listData = await listRes.json();

    if (!listData.success) {
      const isAuthErr = listData.errors?.some(e => e.code === 10000);
      if (isAuthErr) {
        throw new Error("خطای دسترسی کلودفلر (کد ۱۰۰۰۰): توکن دسترسی 'D1: Edit' را ندارد یا Account ID اشتباه است.");
      }
      throw new Error(`خطای دیتابیس D1: ${JSON.stringify(listData.errors)}`);
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

  // ۴. مدیریت KV Namespace
  if (kvName && kvBindingName) {
    const kvListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
      headers: cfHeaders,
    });
    const kvListData = await kvListRes.json();

    if (!kvListData.success) {
      throw new Error(`خطا در دسترسی KV: ${JSON.stringify(kvListData.errors)}`);
    }

    const existingKv = kvListData.result?.find((ns) => ns.title === kvName);

    if (existingKv) {
      kvNamespaceId = existingKv.id;
    } else {
      const createKvRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
        method: "POST",
        headers: { ...cfHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ title: kvName }),
      });
      const createKvData = await createKvRes.json();
      if (!createKvData.success) {
        throw new Error(`خطا در ایجاد KV Namespace: ${JSON.stringify(createKvData.errors)}`);
      }
      kvNamespaceId = createKvData.result.id;
    }

    bindings.push({ type: "kv_namespace", name: kvBindingName, namespace_id: kvNamespaceId });
  }

  // ۵. حذف ورکر قبلی در صورت نیاز
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
    deployTarget: 'workers',
    workerName,
    workerUrl,
    d1DatabaseId,
    kvNamespaceId,
    obfuscated: !!enableObfuscation,
    recreated: !!recreateWorker,
  };
}

// موتور استقرار مستقیم، استاندارد و پایدار روی Cloudflare Pages
export async function deployPages({ accountId, apiToken, projectName, scriptUrl, d1Name, bindingName, kvName, kvBindingName, enableObfuscation, recreateProject }) {
  if (!accountId || !apiToken || !projectName || !scriptUrl) {
    throw new Error("فیلدهای اجباری برای Pages ناقص هستند.");
  }

  const cfHeaders = { Authorization: `Bearer ${apiToken}` };

  // ۱. دریافت مستقیم سورس کد اصلی
  const scriptRes = await fetch(scriptUrl, {
    headers: { "User-Agent": "Mozilla/5.0 PagesDeployer/1.0" },
  });
  if (!scriptRes.ok) {
    throw new Error(`خطا در دانلود سورس: ${scriptRes.status} ${scriptRes.statusText}`);
  }
  let finalScript = await scriptRes.text();

  // اگر سورس از قبل مبهم شده باشد یا نیازی نباشد، تغییری روی آن اعمال نمی‌کنیم تا جدول دیکودر نشکند
  const isAlreadyObfuscated = finalScript.includes("_0x_tbl") || finalScript.includes("_0x_key");
  if (enableObfuscation && !isAlreadyObfuscated) {
    try {
      finalScript = obfuscateWorkerCode(finalScript);
    } catch (_) {}
  }

  let d1DatabaseId = null;
  let kvNamespaceId = null;

  // ۲. مدیریت و ساخت خودکار دیتابیس ابری D1
  if (d1Name && bindingName) {
    const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, { headers: cfHeaders });
    const listData = await listRes.json();
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
      if (!d1Data.success) throw new Error(`خطا در ایجاد D1: ${JSON.stringify(d1Data.errors)}`);
      d1DatabaseId = d1Data.result.uuid;
    }
  }

  // ۳. مدیریت و ساخت خودکار حافظه KV
  if (kvName && kvBindingName) {
    const kvListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, { headers: cfHeaders });
    const kvListData = await kvListRes.json();
    const existingKv = kvListData.result?.find((ns) => ns.title === kvName);

    if (existingKv) {
      kvNamespaceId = existingKv.id;
    } else {
      const createKvRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
        method: "POST",
        headers: { ...cfHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ title: kvName }),
      });
      const createKvData = await createKvRes.json();
      if (!createKvData.success) throw new Error(`خطا در ایجاد KV: ${JSON.stringify(createKvData.errors)}`);
      kvNamespaceId = createKvData.result.id;
    }
  }

  // ۴. حذف پروژه در صورت فعال بودن Clean Rebuild
  if (recreateProject) {
    try {
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`, {
        method: "DELETE",
        headers: cfHeaders,
      });
    } catch (_) {}
  }

  const today = new Date().toISOString().split("T")[0];

  // ۵. ایجاد پروژه Pages در صورت عدم وجود
  const projCheck = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`, { headers: cfHeaders });
  if (projCheck.status === 404) {
    const createProjRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
      method: "POST",
      headers: { ...cfHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    });
    const createProjData = await createProjRes.json();
    if (!createProjData.success) {
      throw new Error(`خطا در ایجاد پروژه Pages: ${JSON.stringify(createProjData.errors)}`);
    }
  }

  // ۶. اعمال بایندینگ‌های D1 با نام متغیر مورد نظر کد (مثلاً IOT_DB یا DB) و تنظیم سازگاری پروداکشن
  const deploymentConfigs = {
    compatibility_date: today,
    compatibility_flags: ["nodejs_compat"],
    env_vars: {},
    d1_databases: d1DatabaseId ? { [bindingName]: { id: d1DatabaseId } } : {},
    kv_namespaces: kvNamespaceId ? { [kvBindingName]: { namespace_id: kvNamespaceId } } : {},
  };

  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`, {
    method: "PATCH",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      deployment_configs: {
        production: deploymentConfigs,
      },
    }),
  });

  // ۷. استاندارد رسمی کلودفلر Pages برای Advanced Mode (_worker.js)
  async function sha256(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // فایل استاتیک روت جهت راه‌اندازی روتر Pages
  const dummyHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Loading...</body></html>`;
  const dummyHash = await sha256(dummyHtml);

  // در API کلودفلر، مانیفست فایل‌های استاتیک را نگاشت می‌کند
  const manifest = {
    "/index.html": dummyHash,
  };

  const formData = new FormData();
  formData.append("manifest", JSON.stringify(manifest));
  formData.append(dummyHash, new Blob([dummyHtml], { type: "text/html" }), "index.html");
  
  // فیلد رسمی کلودفلر برای دریافت کد ورکر در Pages Functions
  formData.append("_worker.bundle", new Blob([finalScript], { type: "application/javascript" }), "_worker.js");

  const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    method: "POST",
    headers: cfHeaders,
    body: formData,
  });

  const deployData = await deployRes.json();
  if (!deployData.success) {
    throw new Error(`خطا در دیپلوی Pages: ${JSON.stringify(deployData.errors)}`);
  }

  const pagesUrl = `https://${projectName}.pages.dev`;

  return {
    success: true,
    deployTarget: 'pages',
    workerName: projectName,
    workerUrl: pagesUrl,
    d1DatabaseId,
    kvNamespaceId,
    obfuscated: isAlreadyObfuscated || !!enableObfuscation,
    recreated: !!recreateProject,
  };
}
