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
    title: "🛠️ سفارشی",
    url: "",
    binding: "DB",
    obfuscate: 1,
    recreate: 0,
    d1: 0,
  },
};

function generateRandomName(prefix = "worker") {
  const words = ["fast", "turbo", "sky", "pixel", "smart", "flow", "shield"];
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

// انکود ساده وضعیت در callback_data (زیر ۶۴ بایت)
// فرمت: act:preset:obf:clean:d1:name
function encodeAction(act, pKey, obf, clean, d1, name) {
  return `${act}|${pKey}|${obf}|${clean}|${d1}|${name}`.slice(0, 64);
}

function parseAction(data) {
  const [act, pKey, obf, clean, d1, name] = data.split("|");
  return {
    act,
    pKey,
    obfuscate: obf === "1",
    recreate: clean === "1",
    d1: d1 === "1",
    name,
  };
}

// استخراج اطلاعات اکانت و توکن از متن پیام پیش‌نمایش
function extractCredentialsFromText(text) {
  const accMatch = text.match(/ACC_ID:\s*([^\n\r]+)/);
  const tokMatch = text.match(/API_TOK:\s*([^\n\r]+)/);
  const urlMatch = text.match(/SRC_URL:\s*([^\n\r]+)/);
  return {
    accountId: accMatch ? accMatch[1].trim() : null,
    apiToken: tokMatch ? tokMatch[1].trim() : null,
    customUrl: urlMatch ? urlMatch[1].trim() : null,
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

    // ۱. پردازش دکمه‌های شیشه‌ای
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data;
      const msgText = cq.message.text || "";

      // انصراف
      if (data === "cancel") {
        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "❌ عملیات لغو شد. برای شروع /start را بفرستید.",
        });
        return new Response("OK");
      }

      // انتخاب پریست
      if (data.startsWith("pre:")) {
        const pKey = data.split(":")[1];
        const p = PRESETS[pKey];

        const promptText = `شما پروژه <b>${p.title}</b> را انتخاب کردید.

لطفاً اطلاعات کلودفلر خود را در یک پیام و به صورت <b>دو خط زیر هم</b> بفرستید:

<code>خط اول: Account ID
خط دوم: API Token</code>
${pKey === "custom" ? "<code>خط سوم: آدرس سورس کد (URL)</code>" : ""}

<i>(کافیست پیام را کپی و مقادیر خود را جایگزین کرده و ارسال کنید)</i>`;

        // ارسال به صورت ForceReply به طوری که نوع پروژه در پیام ذخیره باشد
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: promptText + `\n\n[#PRESET_${pKey.toUpperCase()}#]`,
          parse_mode: "HTML",
          reply_markup: {
            force_reply: true,
            selective: true,
          },
        });
        return new Response("OK");
      }

      // سوئیچ‌ها و دکمه استقرار
      const parsed = parseAction(data);
      const creds = extractCredentialsFromText(msgText);

      if (parsed.act === "tog_obf") parsed.obfuscate = !parsed.obfuscate;
      if (parsed.act === "tog_cln") parsed.recreate = !parsed.recreate;
      if (parsed.act === "tog_d1") parsed.d1 = !parsed.d1;
      if (parsed.act === "rnd_nm") parsed.name = generateRandomName("cf");

      // اگر کاربر روی استقرار نهایی کلیک کرد
      if (parsed.act === "deploy") {
        if (!creds.accountId || !creds.apiToken) {
          await tgApi(BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "❌ اطلاعات منقضی یا مخدوش شده است. لطفاً با /start مجدد شروع کنید.",
          });
          return new Response("OK");
        }

        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⏳ <b>در حال ساخت دیتابیس D1، پردازش سورس و استقرار روی لبه کلودفلر...</b>\nلطفاً شکیبا باشید.",
          parse_mode: "HTML",
        });

        const p = PRESETS[parsed.pKey];
        const scriptUrl = parsed.pKey === "custom" ? creds.customUrl : p.url;
        const d1Name = parsed.d1 ? `${parsed.name}-db` : null;

        try {
          const deployRes = await deployWorker({
            accountId: creds.accountId,
            apiToken: creds.apiToken,
            workerName: parsed.name,
            scriptUrl: scriptUrl,
            bindingName: p.binding,
            d1Name: d1Name,
            enableObfuscation: parsed.obfuscate,
            recreateWorker: parsed.recreate,
          });

          // پیام پایانی (تمام اطلاعات محرمانه از صفحه پاک می‌شوند)
          const resultMsg = `🎉 <b>ورکر با موفقیت مستقر شد!</b>

🔹 <b>نام ورکر:</b> <code>${deployRes.workerName}</code>
🔹 <b>مبهم‌سازی کد:</b> ${deployRes.obfuscated ? "فعال ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز:</b> ${deployRes.recreated ? "بله ✅" : "خیر"}
${deployRes.d1DatabaseId ? `🔹 <b>دیتابیس D1:</b> <code>${deployRes.d1DatabaseId}</code>` : "🔹 <b>دیتابیس D1:</b> غیرفعال"}

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
                [{ text: "🔄 نصب ورکر جدید", callback_data: "cancel" }],
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

      // آپدیت منوی تنظیمات در صورت زدن سوئیچ‌ها
      await renderReviewMenu(BOT_TOKEN, chatId, messageId, creds, parsed);
      return new Response("OK");
    }

    // ۲. پردازش پیام متنی کاربر (ارسال اطلاعات ورود)
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === "/start" || text === "/new") {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `سلام! برای نصب و راه‌اندازی ورکر، پروژه مورد نظر خود را انتخاب کنید:`,
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

      // بررسی پاسخ به پیام ForceReply
      const replyTo = update.message.reply_to_message?.text || "";
      let presetKey = "nahan";
      if (replyTo.includes("#PRESET_ZEUS#")) presetKey = "zeus";
      if (replyTo.includes("#PRESET_CUSTOM#")) presetKey = "custom";

      // پارس کردن خطوط پیام کاربر
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length < 2) {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: "⚠️ لطفاً اطلاعات را در دو خط جداگانه بفرستید:\nخط ۱: Account ID\nخط ۲: API Token\n\nبرای شروع دوباره /start را بزنید.",
        });
        return new Response("OK");
      }

      const accountId = lines[0];
      const apiToken = lines[1];
      const customUrl = lines[2] || "";

      const p = PRESETS[presetKey];
      const initialState = {
        act: "view",
        pKey: presetKey,
        obfuscate: p.obfuscate === 1,
        recreate: p.recreate === 1,
        d1: p.d1 === 1,
        name: generateRandomName("cf"),
      };

      const creds = { accountId, apiToken, customUrl };

      // حذف پیام حاوی توکن از چت برای امنیت کاربر
      try {
        await tgApi(BOT_TOKEN, "deleteMessage", {
          chat_id: chatId,
          message_id: update.message.message_id,
        });
      } catch (_) {}

      // ارسال فاکتور و منوی تایید
      await renderReviewMenu(BOT_TOKEN, chatId, null, creds, initialState);
      return new Response("OK");
    }

    return new Response("OK");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 200 });
  }
}

// ساخت و ویرایش پیام تنظیمات (کامپوننت ویزارد)
async function renderReviewMenu(botToken, chatId, messageId, creds, state) {
  const p = PRESETS[state.pKey];
  const obfFlag = state.obfuscate ? "1" : "0";
  const clnFlag = state.recreate ? "1" : "0";
  const d1Flag = state.d1 ? "1" : "0";

  // مقادیر سکرت داخل متن به صورت بلوک کد قرار می‌گیرند تا بتوان دوباره استخراج کرد
  const text = `📋 <b>تنظیمات نهایی ورکر (${p.title})</b>

🔹 <b>نام ورکر:</b> <code>${state.name}</code>
🔹 <b>مبهم‌سازی سورس:</b> ${state.obfuscate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز (Clean):</b> ${state.recreate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>دیتابیس D1:</b> ${state.d1 ? "متصل شود ✅" : "بدون دیتابیس ❌"}

<i>تنظیمات دلخواه را با دکمه‌های زیر اعمال کرده و سپس استقرار را لمس کنید:</i>

<pre>
ACC_ID: ${creds.accountId}
API_TOK: ${creds.apiToken}
${creds.customUrl ? `SRC_URL: ${creds.customUrl}` : ""}
</pre>`;

  const keyboard = [
    [
      {
        text: `مبهم‌سازی: ${state.obfuscate ? "روشن 🟢" : "خاموش ⚪"}`,
        callback_data: encodeAction("tog_obf", state.pKey, obfFlag, clnFlag, d1Flag, state.name),
      },
      {
        text: `نصب Clean: ${state.recreate ? "روشن 🟢" : "خاموش ⚪"}`,
        callback_data: encodeAction("tog_cln", state.pKey, obfFlag, clnFlag, d1Flag, state.name),
      },
    ],
    [
      {
        text: `دیتابیس D1: ${state.d1 ? "روشن 🟢" : "خاموش ⚪"}`,
        callback_data: encodeAction("tog_d1", state.pKey, obfFlag, clnFlag, d1Flag, state.name),
      },
      {
        text: "🎲 نام رندوم",
        callback_data: encodeAction("rnd_nm", state.pKey, obfFlag, clnFlag, d1Flag, state.name),
      },
    ],
    [
      {
        text: "🚀 شروع استقرار ورکر",
        callback_data: encodeAction("deploy", state.pKey, obfFlag, clnFlag, d1Flag, state.name),
      },
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
