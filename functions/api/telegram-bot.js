// functions/api/telegram-bot.js
import { deployWorker } from "../_core.js";

const TOKEN_CREATE_URL = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Jasaz%20Deployer";

const PRESETS = {
  nahan: {
    title: "🛡️ نهان (Nahan)",
    url: "https://raw.githubusercontent.com/itsyebekhe/nahan/refs/heads/main/_worker.encode.js",
    binding: "IOT_DB",
    obfuscate: 0,
    recreate: 1,
    d1: 1,
  },
  zeus: {
    title: "⚡ زئوس (Zeus)",
    url: "https://raw.githubusercontent.com/panel-zeus/Z-E-U-S/refs/heads/main/Source.js",
    binding: "DB",
    obfuscate: 1,
    recreate: 1,
    d1: 1,
  },
  custom: {
    title: "🛠️ سفارشی (Custom)",
    url: "",
    binding: "DB",
    obfuscate: 1,
    recreate: 0,
    d1: 0,
  },
};

function generateRandomName(prefix = "worker") {
  const words = ["fast", "turbo", "sky", "pixel", "smart", "flow", "shield", "edge"];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const num = Math.floor(Math.random() * 899) + 100;
  return `${prefix}-${pick(words)}-${num}`;
}

async function tgApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

function encodeAction(act, pKey, obf, clean, d1) {
  return `${act}|${pKey}|${obf}|${clean}|${d1}`;
}

function parseAction(data) {
  const [act, pKey, obf, clean, d1] = data.split("|");
  return {
    act,
    pKey,
    obfuscate: obf === "1",
    recreate: clean === "1",
    d1: d1 === "1",
  };
}

function parseConfigFromText(text = "") {
  const getVal = (key) => {
    const match = text.match(new RegExp(`${key}:\\s*([^\\n\\r<]+)`));
    return match ? match[1].trim() : "";
  };

  return {
    accountId: getVal("ACC"),
    apiToken: getVal("TOK"),
    workerName: getVal("WRK") || generateRandomName("cf"),
    d1Name: getVal("D1N") || generateRandomName("db"),
    bindingName: getVal("BND") || "DB",
    scriptUrl: getVal("URL"),
  };
}

export async function onRequestPost({ request, env }) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const SECRET = env.BOT_SECRET;

  if (SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== SECRET) {
    return new Response("Unauthorized", { status: 403 });
  }

  try {
    const update = await request.json();

    // ۱. پردازش کلیک دکمه‌ها
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data;
      const msgText = cq.message.text || "";

      // راهنمای یافتن Account ID
      if (data === "help_acc_id") {
        await tgApi(BOT_TOKEN, "answerCallbackQuery", {
          callback_query_id: cq.id,
          text: "راهنما ارسال شد.",
        });

        const helpMsg = `🔍 <b>نحوه پیدا کردن Account ID:</b>

۱. وارد پنل کاربری کلودفلر شوید:
👉 <a href="https://dash.cloudflare.com/">dash.cloudflare.com</a>
۲. از منوی سمت چپ وارد بخش <b>Workers & Pages</b> شوید.
۳. به آدرس بار مرورگر نگاه کنید؛ رشته ۳۲ حرفی بین آدرس همان آیدی شماست:

<code>https://dash.cloudflare.com/<b>[ACCOUNT_ID]</b>/workers-and-pages</code>

کافیست همان عبارت ۳۲ حرفی را کپی و ارسال کنید.`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          parse_mode: "HTML",
          text: helpMsg,
          disable_web_page_preview: true,
        });
        return new Response("OK");
      }

      if (data === "cancel") {
        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "❌ عملیات لغو شد. برای شروع مجدد /start را بفرستید.",
        });
        return new Response("OK");
      }

      // شروع پروژه و درخواست اطلاعات ورود
      if (data.startsWith("pre:")) {
        const pKey = data.split(":")[1];
        const p = PRESETS[pKey];

        const promptText = `شما پروژه <b>${p.title}</b> را انتخاب کردید.

لطفاً اطلاعات کلودفلر را در قالب دو خط زیر ارسال کنید:

<code>خط اول: Account ID
خط دوم: API Token</code>
${pKey === "custom" ? "<code>خط سوم: آدرس سورس کد ورکر (URL)</code>" : ""}

💡 <i>از دکمه‌های زیر برای دریافت خودکار توکن یا پیدا کردن Account ID استفاده کنید:</i>`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `${promptText}\n\n[#PRESET_${pKey.toUpperCase()}#]`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 ساخت خودکار API Token (کلیک کنید)", url: TOKEN_CREATE_URL }],
              [{ text: "❓ راهنمای پیدا کردن Account ID", callback_data: "help_acc_id" }],
            ],
          },
        });
        return new Response("OK");
      }

      const parsed = parseAction(data);
      const cfg = parseConfigFromText(msgText);

      // تغییر دستی فیلدهای متنی
      if (parsed.act === "edit_wrk" || parsed.act === "edit_d1n" || parsed.act === "edit_bnd") {
        const labels = {
          edit_wrk: "نام ورکر (Worker Name)",
          edit_d1n: "نام دیتابیس D1",
          edit_bnd: "نام متغیر Binding",
        };
        const fieldKey = parsed.act.replace("edit_", "").toUpperCase();

        const replyPayload = `لطفاً <b>${labels[parsed.act]}</b> دلخواه خود را بنویسید و ارسال کنید:

[#TARGET_FIELD_${fieldKey}#]
[#PANEL_MSG_ID_${messageId}#]
[#PKEY_${parsed.pKey}#]
[#FLAGS_${parsed.obfuscate ? "1" : "0"}_${parsed.recreate ? "1" : "0"}_${parsed.d1 ? "1" : "0"}#]

<pre>
ACC: ${cfg.accountId}
TOK: ${cfg.apiToken}
WRK: ${cfg.workerName}
D1N: ${cfg.d1Name}
BND: ${cfg.bindingName}
URL: ${cfg.scriptUrl}
</pre>`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: replyPayload,
          parse_mode: "HTML",
          reply_markup: {
            force_reply: true,
            selective: true,
          },
        });
        return new Response("OK");
      }

      if (parsed.act === "rnd_wrk") cfg.workerName = generateRandomName("cf");
      if (parsed.act === "rnd_d1") cfg.d1Name = generateRandomName("db");

      if (parsed.act === "tog_obf") parsed.obfuscate = !parsed.obfuscate;
      if (parsed.act === "tog_cln") parsed.recreate = !parsed.recreate;
      if (parsed.act === "tog_d1") parsed.d1 = !parsed.d1;

      // اجرای استقرار
      if (parsed.act === "deploy") {
        if (!cfg.accountId || !cfg.apiToken) {
          await tgApi(BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "❌ اطلاعات منقضی یا مخدوش شده است. لطفاً /start را بزنید.",
          });
          return new Response("OK");
        }

        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⏳ <b>در حال برقراری ارتباط با کلودفلر، پردازش کد و ساخت دیتابیس...</b>\nلطفاً چند لحظه صبر کنید.",
          parse_mode: "HTML",
        });

        const p = PRESETS[parsed.pKey];
        const scriptUrl = parsed.pKey === "custom" ? cfg.scriptUrl : p.url;

        try {
          const deployRes = await deployWorker({
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            workerName: cfg.workerName,
            scriptUrl: scriptUrl,
            bindingName: parsed.d1 ? cfg.bindingName : null,
            d1Name: parsed.d1 ? cfg.d1Name : null,
            enableObfuscation: parsed.obfuscate,
            recreateWorker: parsed.recreate,
          });

          const resultMsg = `🎉 <b>ورکر با موفقیت مستقر شد!</b>

🔹 <b>نام ورکر:</b> <code>${deployRes.workerName}</code>
🔹 <b>مبهم‌سازی کد:</b> ${deployRes.obfuscated ? "فعال ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز:</b> ${deployRes.recreated ? "بله ✅" : "خیر"}
${deployRes.d1DatabaseId ? `🔹 <b>دیتابیس D1:</b> <code>${cfg.d1Name}</code>\n🔹 <b>بایندینگ:</b> <code>${cfg.bindingName}</code>` : "🔹 <b>دیتابیس D1:</b> غیرفعال"}

🌐 <b>آدرس نهایی ورکر:</b>
<a href="${deployRes.workerUrl}">${deployRes.workerUrl}</a>`;

          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: resultMsg,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🌍 باز کردن ورکر", url: deployRes.workerUrl }],
                [{ text: "🔄 نصب ورکر جدید", callback_data: "cancel" }],
              ],
            },
          });
        } catch (deployErr) {
          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: `❌ <b>خطا در استقرار ورکر:</b>\n\n<code>${deployErr.message}</code>`,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔑 ساخت مجدد توکن (دسترسی D1)", url: TOKEN_CREATE_URL }],
                [{ text: "🔄 تلاش مجدد", callback_data: data }],
                [{ text: "❌ انصراف", callback_data: "cancel" }],
              ],
            },
          });
        }
        return new Response("OK");
      }

      await renderReviewMenu(BOT_TOKEN, chatId, messageId, cfg, parsed);
      return new Response("OK");
    }

    // ۲. دریافت پیام‌های متنی
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();
      const replyToMsg = update.message.reply_to_message;
      const replyTo = replyToMsg?.text || "";

      if (text === "/start" || text === "/new") {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `سلام! برای نصب و مدیریت ورکر، پروژه مورد نظر خود را انتخاب کنید:`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🛡️ نهان (Nahan)", callback_data: "pre:nahan" },
                { text: "⚡ زئوس (Zeus)", callback_data: "pre:zeus" },
              ],
              [{ text: "🛠️ سورس سفارشی (Custom)", callback_data: "pre:custom" }],
            ],
          },
        });
        return new Response("OK");
      }

      // ویرایش فیلد تکی
      if (replyTo.includes("[#TARGET_FIELD_")) {
        const fieldMatch = replyTo.match(/\[#TARGET_FIELD_([A-Z0-9]+)#\]/);
        const panelMsgMatch = replyTo.match(/\[#PANEL_MSG_ID_([0-9]+)#\]/);
        const pKeyMatch = replyTo.match(/\[#PKEY_([a-z0-9]+)#\]/);
        const flagsMatch = replyTo.match(/\[#FLAGS_([01])_([01])_([01])#\]/);

        if (fieldMatch && panelMsgMatch) {
          const field = fieldMatch[1];
          const targetPanelMsgId = parseInt(panelMsgMatch[1], 10);
          const pKey = pKeyMatch ? pKeyMatch[1] : "nahan";
          
          const cfg = parseConfigFromText(replyTo);

          if (field === "WRK") cfg.workerName = text.replace(/[^a-zA-Z0-9_-]/g, "");
          if (field === "D1N") cfg.d1Name = text.replace(/[^a-zA-Z0-9_-]/g, "");
          if (field === "BND") cfg.bindingName = text.replace(/[^a-zA-Z0-9_]/g, "");

          const state = {
            act: "view",
            pKey: pKey,
            obfuscate: flagsMatch ? flagsMatch[1] === "1" : true,
            recreate: flagsMatch ? flagsMatch[2] === "1" : true,
            d1: flagsMatch ? flagsMatch[3] === "1" : true,
          };

          await renderReviewMenu(BOT_TOKEN, chatId, targetPanelMsgId, cfg, state);

          try {
            await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: update.message.message_id });
            await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: replyToMsg.message_id });
          } catch (_) {}

          return new Response("OK");
        }
      }

      // دریافت اولیه دو خطی اطلاعات
      let presetKey = "nahan";
      if (replyTo.includes("#PRESET_ZEUS#")) presetKey = "zeus";
      if (replyTo.includes("#PRESET_CUSTOM#")) presetKey = "custom";

      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length < 2) {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ لطفاً اطلاعات را در دو خط جداگانه ارسال فرمایید:

خط ۱: Account ID
خط ۲: API Token`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 ساخت خودکار API Token", url: TOKEN_CREATE_URL }],
              [{ text: "❓ راهنمای پیدا کردن Account ID", callback_data: "help_acc_id" }],
            ],
          },
        });
        return new Response("OK");
      }

      const p = PRESETS[presetKey];
      const cfg = {
        accountId: lines[0],
        apiToken: lines[1],
        workerName: generateRandomName("cf"),
        d1Name: generateRandomName("db"),
        bindingName: p.binding,
        scriptUrl: lines[2] || p.url,
      };

      const state = {
        act: "view",
        pKey: presetKey,
        obfuscate: p.obfuscate === 1,
        recreate: p.recreate === 1,
        d1: p.d1 === 1,
      };

      try {
        await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: update.message.message_id });
      } catch (_) {}

      await renderReviewMenu(BOT_TOKEN, chatId, null, cfg, state);
      return new Response("OK");
    }

    return new Response("OK");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 200 });
  }
}

async function renderReviewMenu(botToken, chatId, messageId, cfg, state) {
  const p = PRESETS[state.pKey];
  const obfFlag = state.obfuscate ? "1" : "0";
  const clnFlag = state.recreate ? "1" : "0";
  const d1Flag = state.d1 ? "1" : "0";

  const text = `📋 <b>تنظیمات استقرار ورکر (${p.title})</b>

🔹 <b>نام ورکر:</b> <code>${cfg.workerName}</code>
🔹 <b>مبهم‌سازی کد:</b> ${state.obfuscate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز (Clean):</b> ${state.recreate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>پایگاه داده D1:</b> ${state.d1 ? `روشن (<code>${cfg.d1Name}</code>)` : "خاموش ❌"}
🔹 <b>نام بایندینگ:</b> <code>${cfg.bindingName}</code>

<i>برای تغییر تنظیمات روی دکمه‌های زیر بزنید:</i>

<pre>
ACC: ${cfg.accountId}
TOK: ${cfg.apiToken}
WRK: ${cfg.workerName}
D1N: ${cfg.d1Name}
BND: ${cfg.bindingName}
URL: ${cfg.scriptUrl}
</pre>`;

  const keyboard = [
    [
      { text: "✏️ تغییر نام ورکر", callback_data: encodeAction("edit_wrk", state.pKey, obfFlag, clnFlag, d1Flag) },
      { text: "🎲 نام رندوم ورکر", callback_data: encodeAction("rnd_wrk", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    ...(state.d1
      ? [
          [
            { text: "✏️ نام D1", callback_data: encodeAction("edit_d1n", state.pKey, obfFlag, clnFlag, d1Flag) },
            { text: "✏️ نام Binding", callback_data: encodeAction("edit_bnd", state.pKey, obfFlag, clnFlag, d1Flag) },
            { text: "🎲 دیتابیس رندوم", callback_data: encodeAction("rnd_d1", state.pKey, obfFlag, clnFlag, d1Flag) },
          ],
        ]
      : []),
    [
      { text: `مبهم‌سازی: ${state.obfuscate ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_obf", state.pKey, obfFlag, clnFlag, d1Flag) },
      { text: `نصب Clean: ${state.recreate ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_cln", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    [
      { text: `دیتابیس D1: ${state.d1 ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_d1", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    [
      { text: "🚀 شروع استقرار ورکر", callback_data: encodeAction("deploy", state.pKey, obfFlag, clnFlag, d1Flag) },
      { text: "❌ انصراف", callback_data: "cancel" },
    ],
  ];

  if (messageId) {
    await tgApi(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      text,
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await tgApi(botToken, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text,
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}
