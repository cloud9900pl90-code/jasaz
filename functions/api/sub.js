// functions/api/sub.js

const DEFAULT_FM = '{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["0","104","1"],"delays":["0"],"maxSplit":"0"}},{"type":"fragment","settings":{"packets":"1-1","lengths":["114","1"],"delays":["1"],"maxSplit":"11"}}]}';
const DEFAULT_CS = 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256:TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256';

const DEFAULT_ECH_LIST = [
  "cloudflare-ech.com+udp://1.1.1.1",
  "cloudflare-ech.com+udp://8.8.8.8"
];

const ORDER_KEYS = ['cs', 'path', 'security', 'alpn', 'encryption', 'fm', 'insecure', 'host', 'fp', 'ech', 'type', 'allowInsecure', 'sni'];

function b64decode(str) {
  try {
    const clean = str.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(escape(atob(clean)));
  } catch (_) {
    try {
      return atob(str.trim());
    } catch {
      return '';
    }
  }
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function parseQuery(q) {
  const out = [];
  if (!q) return out;
  q.split('&').forEach((p) => {
    if (!p) return;
    const i = p.indexOf('=');
    const k = i < 0 ? p : p.slice(0, i);
    const v = i < 0 ? '' : p.slice(i + 1);
    try {
      out.push({ k: decodeURIComponent(k), v: decodeURIComponent(v) });
    } catch {
      out.push({ k, v });
    }
  });
  return out;
}

function setParam(params, key, val) {
  const lk = key.toLowerCase();
  let found = false;
  for (let i = params.length - 1; i >= 0; i--) {
    if (params[i].k.toLowerCase() === lk) {
      if (found) { params.splice(i, 1); continue; }
      params[i] = { k: key, v: val };
      found = true;
    }
  }
  if (!found) params.push({ k: key, v: val });
}

function buildQS(params) {
  const idx = {};
  ORDER_KEYS.forEach((k, i) => { idx[k] = i; });
  const a = [], b = [];
  params.forEach((x) => {
    if (idx[x.k.toLowerCase()] !== undefined) a.push(x);
    else b.push(x);
  });
  a.sort((x, y) => idx[x.k.toLowerCase()] - idx[y.k.toLowerCase()]);
  return a.concat(b).map((x) => `${encodeURIComponent(x.k)}=${encodeURIComponent(x.v)}`).join('&');
}

function splitUrl(raw, skip) {
  let b = raw.slice(skip), frag = '';
  const qi = b.indexOf('?');
  const hi = b.indexOf('#', qi >= 0 ? qi : 0);
  if (hi >= 0) {
    frag = b.slice(hi + 1);
    b = b.slice(0, hi);
  }
  let q = '';
  const x = b.indexOf('?');
  if (x >= 0) {
    q = b.slice(x + 1);
    b = b.slice(0, x);
  }
  return { body: b, q, frag };
}

function parseVless(raw) {
  const s = splitUrl(raw, 8);
  const a = s.body.lastIndexOf('@');
  if (a < 0) return null;
  const id = s.body.slice(0, a).trim();
  const hostPort = s.body.slice(a + 1).trim();
  return { proto: 'vless', id, hostPort, p: parseQuery(s.q), f: s.frag };
}

function parseTrojan(raw) {
  const s = splitUrl(raw, 9);
  const a = s.body.lastIndexOf('@');
  if (a < 0) return null;
  const pass = s.body.slice(0, a).trim();
  const hostPort = s.body.slice(a + 1).trim();
  return { proto: 'trojan', pass, hostPort, p: parseQuery(s.q), f: s.frag };
}

function extractIpFromEch(ech) {
  const m = String(ech || '').match(/udp:\/\/([^+\s]+)/i);
  return m ? m[1].replace(/^\[|\]$/g, '') : ech;
}

function extractDomainFromEch(ech) {
  const s = String(ech || '');
  const i = s.indexOf('+');
  return i >= 0 ? s.slice(0, i) : s;
}

// ساخت کانفیگ بهینه‌شده به همراه تمام پارامترها
function processConfig(raw, opts) {
  let item = null;
  const trimmed = raw.trim();
  if (/^vless:\/\//i.test(trimmed)) item = parseVless(trimmed);
  else if (/^trojan:\/\//i.test(trimmed)) item = parseTrojan(trimmed);
  if (!item) return [];

  const out = [];
  const baseName = item.f ? decodeURIComponent(item.f) : item.proto;

  // اعمال ECH چندگانه
  if (opts.enableEch) {
    opts.echList.forEach((echVal) => {
      const clone = JSON.parse(JSON.stringify(item));
      applyAdvancedParams(clone, opts);

      setParam(clone.p, 'ech', echVal);

      const ip = extractIpFromEch(echVal);
      const domain = extractDomainFromEch(echVal);
      const remark = opts.suffix
        ? opts.suffix.replace(/\{name\}/g, baseName).replace(/\{ip\}/g, ip).replace(/\{domain\}/g, domain).replace(/\{type\}/g, item.proto)
        : `${baseName} ECH ${ip}`;

      const qs = buildQS(clone.p);
      const auth = clone.proto === 'vless' ? clone.id : encodeURIComponent(clone.pass);
      out.push(`${clone.proto}://${auth}@${clone.hostPort}${qs ? `?${qs}` : ''}#${encodeURIComponent(remark)}`);
    });
  } else {
    // حالت بهینه‌سازی معمولی بدون ECH (فقط Fragment، Cipher Suites و ...)
    applyAdvancedParams(item, opts);
    const qs = buildQS(item.p);
    const auth = item.proto === 'vless' ? item.id : encodeURIComponent(item.pass);
    out.push(`${item.proto}://${auth}@${item.hostPort}${qs ? `?${qs}` : ''}#${item.f || ''}`);
  }

  return out;
}

function applyAdvancedParams(item, opts) {
  if (opts.customHost) {
    const parts = item.hostPort.split(':');
    const port = parts.length > 1 ? `:${parts[parts.length - 1]}` : '';
    item.hostPort = `${opts.customHost}${port}`;
  }
  if (opts.fp) {
    setParam(item.p, 'fp', opts.fp);
  }
  if (opts.enableFragment) {
    setParam(item.p, 'cs', opts.cs || DEFAULT_CS);
    setParam(item.p, 'fm', opts.fm || DEFAULT_FM);
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const subUrl = url.searchParams.get('url') || url.searchParams.get('sub');
  const customHost = url.searchParams.get('host') || url.searchParams.get('addr') || '';
  const fp = url.searchParams.get('fp') || '';
  const enableFragment = url.searchParams.get('fragment') !== '0';
  const enableEch = url.searchParams.get('ech') === '1';
  const customEchList = url.searchParams.get('ech_list');
  const format = (url.searchParams.get('format') || 'b64').toLowerCase();
  const suffix = url.searchParams.get('suffix') || ' ECH {ip}';

  if (!subUrl) {
    return new Response(JSON.stringify({
      error: "لطفاً لینک ساب‌اسکریپشن را مشخص کنید.",
      usage: `${url.origin}/api/sub?url=https://sub.example.com/...`,
      parameters: {
        host: "آدرس یا IP کلین سرور",
        fp: "فینگرپرینت (chrome, firefox, safari, etc.)",
        fragment: "1 یا 0 (فعال/غیرفعال کردن Fragment و Cipher Suites)",
        ech: "1 یا 0 (فعال/غیرفعال کردن ECH)",
        format: "b64 یا raw (نوع خروجی)"
      }
    }, null, 2), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const echList = customEchList
    ? customEchList.split(',').map((x) => x.trim()).filter(Boolean)
    : DEFAULT_ECH_LIST;

  const opts = {
    customHost,
    fp,
    enableFragment,
    enableEch,
    echList,
    suffix,
    cs: url.searchParams.get('cs') || DEFAULT_CS,
    fm: url.searchParams.get('fm') || DEFAULT_FM
  };

  try {
    let rawText = "";
    if (/^https?:\/\//i.test(subUrl)) {
      const res = await fetch(subUrl, {
        headers: { "User-Agent": "v2rayNG/1.8.12 Jasaz-Optimizer/1.0" }
      });
      if (!res.ok) {
        return new Response(`خطا در دریافت ساب‌لینک: ${res.status}`, { status: 400 });
      }
      rawText = await res.text();
    } else {
      rawText = subUrl;
    }

    const decoded = b64decode(rawText);
    const content = (decoded && (decoded.includes("vless://") || decoded.includes("trojan://"))) ? decoded : rawText;

    const lines = content.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const finalConfigs = [];

    lines.forEach((line) => {
      const generated = processConfig(line, opts);
      finalConfigs.push(...generated);
    });

    if (finalConfigs.length === 0) {
      return new Response("هیچ کانفیگ معتبر Vless یا Trojan یافت نشد.", { status: 404 });
    }

    const outputText = finalConfigs.join('\n');

    if (format === 'raw' || format === 'txt') {
      return new Response(outputText, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    return new Response(b64encode(outputText), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Subscription-Userinfo": "upload=0; download=0; total=107374182400; expire=0"
      }
    });

  } catch (err) {
    return new Response(`خطا در فرایند بهینه‌سازی: ${err.message}`, { status: 500 });
  }
}