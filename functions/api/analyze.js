// functions/api/analyze.js

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost({ request }) {
  try {
    const { scriptUrl, geminiApiKey } = await request.json();

    if (!scriptUrl || !geminiApiKey) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "لطفاً هم آدرس سورس کد ورکر و هم کلید Gemini API را وارد کنید." 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // ۱. دانلود سورس ورکر
    const scriptRes = await fetch(scriptUrl, {
      headers: { "User-Agent": "Mozilla/5.0 Jasaz-AI-Analyzer/1.0" }
    });
    if (!scriptRes.ok) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: `خطا در دریافت فایل سورس ورکر: ${scriptRes.status} ${scriptRes.statusText}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const workerCode = await scriptRes.text();

    // محدودسازی حجم ارسالی به مدل جهت جلوگیری از محدودیت Context window
    const maxChars = 80000;
    const truncatedCode = workerCode.length > maxChars 
      ? workerCode.slice(0, maxChars) + "\n// ... [کد کوتاه شده است]"
      : workerCode;

    // ۲. ارسال پرامپت اختصاصی و دقیق به Gemini 1.5 Flash
    const prompt = `You are a cybersecurity and reverse-engineering specialist analyzing a Cloudflare Worker script.
Analyze the following JavaScript code and extract ALL string literals, variables, paths, and configurations related in any way to proxying, VPNs, circumvention tools, and protocols such as:
- V2Ray / Xray (VLESS, VMess, Trojan, Shadowsocks, Hysteria, TUIC, SOCKS5, HTTP)
- Sing-box / Clash / Mihomo / Box formats
- UUIDs, passwords, secrets, tokens, auth headers
- Proxy IPs, Clean IPs, DNS over HTTPS (DoH), ECH configs, SNIs, host headers, WS/gRPC/xHTTP paths
- Routing tags, outbound names, cipher suites, fragment settings
- Hardcoded endpoints, subscription links, admin paths, dashboard routes

Return ONLY valid JSON (without Markdown codeblocks, without backticks, without preamble) in this exact schema:
{
  "summary": "Short explanation of what this worker does",
  "protocols": ["List of detected protocols like vless, trojan, etc."],
  "admin_and_sub_paths": ["List of extracted URL paths, e.g. /panel, /sub, /sync/dash, etc."],
  "keys_and_passwords": ["List of UUIDs, default passwords, secrets, auth tokens found"],
  "hosts_and_clean_ips": ["List of server hosts, sni, cdn domains, fallback proxies, DNS IPs"],
  "transport_and_network": ["List of paths, ws settings, grpc service names, fragment headers, cipher suites"],
  "all_proxy_related_strings": ["Complete flat array of any other unique string that has even a slight relation to proxy/network configuration"]
}

Source Code:
${truncatedCode}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey.trim()}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      const errMsg = geminiData.error?.message || JSON.stringify(geminiData);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `خطا از سوی Gemini API: ${errMsg}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rawReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawReply) {
      throw new Error("پاسخی از مدل هوش مصنوعی دریافت نشد.");
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawReply.replace(/^```json/i, '').replace(/```$/i, '').trim());
    } catch {
      parsedResult = { raw: rawReply };
    }

    return new Response(JSON.stringify({
      success: true,
      analysis: parsedResult,
      codeSize: workerCode.length
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: `خطای سرور: ${err.message}` 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}