// functions/api/telegram-bot.js
import { deployWorker } from "../_core.js";

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

// انکود وضعیت‌های کلیدها در callback_data (زیر ۶۴ بایت)
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

// استخراج و ذخیره اطلاعات کانفیگ در متن پیام (Stateless)
function parseConfigFromText(text = "") {
  const getVal = (key) => {
    const match = text.match(new RegExp(`${key}:\\s*([^\\n\\r]+)`));
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

    // ۱. کلیک روی دکمه‌های شیشه‌ای
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data;
      const msgText = cq.message.text || "";

      if (data === "cancel") {
        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "❌ عملیات لغو شد. برای شروع مجدد /start را بزنید.",
        });
        return new Response("OK");
      }

      // انتخاب پروژه
      if (data.startsWith("pre:")) {
        const pKey = data.split(":")[1];
        const p = PRESETS[pKey];

        const promptText = `شما پروژه <b>${p.title}</b> را انتخاب کردید.

لطفاً اطلاعات کلودفلر را در قالب زیر (در یک پیام) بفرستید:

<code>خط اول: Account ID
خط دوم: API Token</code>
${pKey === "custom" ? "<code>خط سوم: آدرس سورس ورکر (URL)</code>" : ""}

<i>(پیام بالا را کپی و مقادیر خود را جایگزین کنید)</i>`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `${promptText}\n\n[#PRESET_${pKey.toUpperCase()}#]`,
          parse_mode: "HTML",
          reply_markup: {
            force_reply: true,
            selective: true,
          },
        });
        return new Response("OK");
      }

      const parsed = parseAction(data);
      const cfg = parseConfigFromText(msgText);

      // درخواست تغییر متن فیلدها از سوی کاربر با ForceReply
      if (parsed.act === "edit_wrk" || parsed.act === "edit_d1n" || parsed.act === "edit_bnd") {
        const labels = {
          edit_wrk: "نام ورکر (Worker Name)",
          edit_d1n: "نام دیتابیس D1",
          edit_bnd: "نام متغیر Binding (مثال: DB یا IOT_DB)",
        };
        const target = parsed.act.replace("edit_", "").toUpperCase();

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `لطفاً <b>${labels[parsed.act]}</b> جدید را بنویسید و ارسال کنید:\n\n[#FIELD_${target}#]\n[#PREV_MSG_${messageId}#]`,
          parse_mode: "HTML",
          reply_markup: {
            force_reply: true,
            selective: true,
          },
        });
        return new Response("OK");
      }

      // دکمه تولید نام رندوم
      if (parsed.act === "rnd_wrk") {
        cfg.workerName = generateRandomName("cf");
      }
      if (parsed.act === "rnd_d1") {
        cfg.d1Name = generateRandomName("db");
      }

      // سوئیچ‌ها
      if (parsed.act === "tog_obf") parsed.obfuscate = !parsed.obfuscate;
      if (parsed.act === "tog_cln") parsed.recreate = !parsed.recreate;
      if (parsed.act === "tog_d1") parsed.d1 = !parsed.d1;

      // دکمه شروع استقرار نهایی
      if (parsed.act === "deploy") {
        if (!cfg.accountId || !cfg.apiToken) {
          await tgApi(BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "❌ اطلاعات منقضی یا مخدوش شده است. لطفاً با /start از ابتدا آغاز کنید.",
          });
          return new Response("OK");
        }

        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⏳ <b>در حال ساخت دیتابیس، بارگذاری کد و فعال‌سازی دامنه ورکر...</b>\nلطفاً شکیبا باشید.",
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
🔹 <b>مبهم‌سازی سورس:</b> ${deployRes.obfuscated ? "فعال ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز (Clean):</b> ${deployRes.recreated ? "بله ✅" : "خیر"}
${deployRes.d1DatabaseId ? `🔹 <b>دیتابیس D1:</b> <code>${cfg.d1Name}</code> (${deployRes.d1DatabaseId})\n🔹 <b>متغیر بایندینگ:</b> <code>${cfg.bindingName}</code>` : "🔹 <b>دیتابیس D1:</b> غیرفعال"}

🌐 <b>آدرس ورکر:</b>
<a href="${deployRes.workerUrl}">${deployRes.workerUrl}</a>`;

          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: resultMsg,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🌍 باز کردن ورکر", url: deployRes.workerUrl }],
                [{ text: "🔄 نصب ورکر دیگر", callback_data: "cancel" }],
              ],
            },
          });
        } catch (deployErr) {
          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: `❌ <b>خطا در استقرار:</b>\n<code>${deployErr.message}</code>`,
            reply_markup: {
              inline_keyboard: [[{ text: "🔄 تلاش مجدد", callback_data: data }]],
            },
          });
        }
        return new Response("OK");
      }

      // به‌روزرسانی منو
      await renderReviewMenu(BOT_TOKEN, chatId, messageId, cfg, parsed);
      return new Response("OK");
    }

    // ۲. پردازش پیام‌های ورودی کاربر
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();
      const replyTo = update.message.reply_to_message?.text || "";

      if (text === "/start" || text === "/new") {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `سلام! برای راه‌اندازی و مدیریت ورکر، پروژه مورد نظر خود را انتخاب کنید:`,
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

      // الف: بررسی تغییر فیلد تکی (نام ورکر، نام D1 یا بایندینگ)
      if (replyTo.includes("[#FIELD_")) {
        const fieldMatch = replyTo.match(/\[#FIELD_([A-Z0-9]+)#\]/);
        const prevMsgMatch = replyTo.match(/\[#PREV_MSG_([0-9]+)#\]/);

        if (fieldMatch && prevMsgMatch) {
          const field = fieldMatch[1];
          const targetMsgId = parseInt(prevMsgMatch[1], 10);

          // حذف پیام حاوی ورودی کاربر جهت خلوت ماندن صفحه
          try {
            await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: update.message.message_id });
          } catch (_) {}

          // ارسال پیام راهنما به کاربر که مقدار ثبت شد
          await tgApi(BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: `✅ مقدار با موفقیت به <code>${text}</code> تغییر یافت. لطفاً پنل تنظیمات بالا را بررسی فرمایید.`,
            parse_mode: "HTML",
          });
          return new Response("OK");
        }
      }

      // ب: دریافت اولیه اطلاعات حساب (خط اول و دوم)
      let presetKey = "nahan";
      if (replyTo.includes("#PRESET_ZEUS#")) presetKey = "zeus";
      if (replyTo.includes("#PRESET_CUSTOM#")) presetKey = "custom";

      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length < 2) {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ لطفاً اطلاعات را حداقل در دو خط جداگانه بفرستید:\nخط ۱: Account ID\nخط ۲: API Token\n\nبرای شروع دوباره /start را بزنید.",
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

      // حذف پیام کاربر حاوی توکن محرمانه
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

// ساخت و ارسال اینترفیس پیش‌نمایش همراه با تمام دکمه‌های تغییر نام
async function renderReviewMenu(botToken, chatId, messageId, cfg, state) {
  const p = PRESETS[state.pKey];
  const obfFlag = state.obfuscate ? "1" : "0";
  const clnFlag = state.recreate ? "1" : "0";
  const d1Flag = state.d1 ? "1" : "0";

  const text = `📋 <b>تنظیمات استقرار ورکر (${p.title})</b>

🔹 <b>نام ورکر:</b> <code>${cfg.workerName}</code>
🔹 <b>مبهم‌سازی کد:</b> ${state.obfuscate ? "فعال ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز (Clean):</b> ${state.recreate ? "فعال ✅" : "خاموش ❌"}
🔹 <b>پایگاه داده D1:</b> ${state.d1 ? `فعال (<code>${cfg.d1Name}</code>)` : "غیرفعال ❌"}
🔹 <b>متغیر بایندینگ:</b> <code>${cfg.bindingName}</code>

<i>برای تغییر نام‌ها یا سوئیچ‌ها، روی دکمه‌های زیر بزنید:</i>

<pre>
ACC: ${cfg.accountId}
TOK: ${cfg.apiToken}
WRK: ${cfg.workerName}
D1N: ${cfg.d1Name}
BND: ${cfg.bindingName}
URL: ${cfg.scriptUrl}
</pre>`;

  const keyboard = [
    // ردیف تغییر نام ورکر
    [
      { text: "✏️ تغییر نام ورکر", callback_data: encodeAction("edit_wrk", state.pKey, obfFlag, clnFlag, d1Flag) },
      { text: "🎲 نام رندوم ورکر", callback_data: encodeAction("rnd_wrk", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    // ردیف تغییرات D1 (اگر فعال باشد)
    ...(state.d1
      ? [
          [
            { text: "✏️ نام D1", callback_data: encodeAction("edit_d1n", state.pKey, obfFlag, clnFlag, d1Flag) },
            { text: "✏️ نام Binding", callback_data: encodeAction("edit_bnd", state.pKey, obfFlag, clnFlag, d1Flag) },
            { text: "🎲 دیتابیس رندوم", callback_data: encodeAction("rnd_d1", state.pKey, obfFlag, clnFlag, d1Flag) },
          ],
        ]
      : []),
    // ردیف سوئیچ‌ها
    [
      { text: `مبهم‌سازی: ${state.obfuscate ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_obf", state.pKey, obfFlag, clnFlag, d1Flag) },
      { text: `نصب Clean: ${state.recreate ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_cln", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    [
      { text: `دیتابیس D1: ${state.d1 ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_d1", state.pKey, obfFlag, clnFlag, d1Flag) },
    ],
    // ردیف اقدام نهایی
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
