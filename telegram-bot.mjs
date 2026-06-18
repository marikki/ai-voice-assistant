// VoiceMind Telegram input bot
// ------------------------------------------------------------------
// A tiny long-polling Telegram bot that forwards Maryna's voice/text
// messages to the iVoice `/api/shortcut` endpoint (transcribe + route),
// then replies with what was filed and where.
//
// No external deps — uses Node's global fetch/FormData/Buffer (Node 18+).
// Runs as a separate pm2 process ("voicemind-telegram") so it never
// collides with the OpenClaw assistant chat.
//
// Required env (read from process env / .env via the start script):
//   TELEGRAM_IVOICE_BOT_TOKEN  dedicated @BotFather token for this bot
//   IVOICE_SHORTCUT_TOKEN      must equal iVoice's SHORTCUT_TOKEN
//   IVOICE_ALLOWED_CHAT_ID     only this chat id is served (e.g. 502083232)
// Optional:
//   IVOICE_URL                 default http://127.0.0.1:3002
//   IVOICE_LANG                default "uk"

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const BOT_TOKEN = process.env.TELEGRAM_IVOICE_BOT_TOKEN;
// Reuse iVoice's existing SHORTCUT_TOKEN unless an explicit override is set.
const SHORTCUT_TOKEN = process.env.IVOICE_SHORTCUT_TOKEN || process.env.SHORTCUT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.IVOICE_ALLOWED_CHAT_ID || "").trim();
const IVOICE_URL = (process.env.IVOICE_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
const LANG = process.env.IVOICE_LANG || "uk";

if (!BOT_TOKEN || !SHORTCUT_TOKEN) {
  console.error("[voicemind-tg] Missing TELEGRAM_IVOICE_BOT_TOKEN or IVOICE_SHORTCUT_TOKEN");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`;
const OFFSET_FILE = path.join(process.cwd(), ".telegram-bot-offset.json");
const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // keep base64 comfortably under server's 8MB cap

function loadOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_FILE, "utf-8")).offset || 0;
  } catch {
    return 0;
  }
}
function saveOffset(offset) {
  try {
    fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }), "utf-8");
  } catch (err) {
    console.error("[voicemind-tg] failed to persist offset:", err.message);
  }
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, replyTo) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_to_message_id: replyTo,
    disable_notification: true,
  });
}

const SERVICE_LABEL = {
  google_calendar: "📅 Google Calendar",
  notion: "📝 Notion",
  reminders: "✅ Google Tasks",
  unclear: "❓ требует уточнения",
};

// Returns the text to send for a capture result, or null if the bot should
// stay silent (e.g. awaiting_clarification — the server already pushed the
// question to this chat).
function formatResult(r) {
  const label = SERVICE_LABEL[r.service] || r.service || "—";
  if (r.status === "awaiting_clarification") {
    return null; // server sent the question itself
  }
  if (r.status === "saved") {
    return `✅ Записала: «${r.title}»\n→ ${label}`;
  }
  if (r.status === "needs_review") {
    return `📥 «${r.title}» → отложила в «требует уточнения»${r.error_message ? `\n(${r.error_message})` : ""}`;
  }
  return `📥 «${r.title}» → ${label} (${r.status})`;
}

async function callClarify(payload) {
  const res = await fetch(`${IVOICE_URL}/api/clarify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SHORTCUT_TOKEN}`,
    },
    body: JSON.stringify({ language: LANG, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `iVoice HTTP ${res.status}`);
  return data;
}

async function getPending() {
  try {
    const res = await fetch(`${IVOICE_URL}/api/pending-clarifications`, {
      headers: { Authorization: `Bearer ${SHORTCUT_TOKEN}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { count: 0, pending: [] };
    return data;
  } catch {
    return { count: 0, pending: [] };
  }
}

async function fetchTelegramFileBase64(fileId) {
  const info = await tg("getFile", { file_id: fileId });
  if (!info.ok) throw new Error("getFile failed: " + JSON.stringify(info));
  const filePath = info.result.file_path;
  const fileRes = await fetch(`${FILE_API}/${filePath}`);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    throw new Error(`audio too large (${buf.length} bytes)`);
  }
  return buf.toString("base64");
}

async function callShortcut(payload) {
  const res = await fetch(`${IVOICE_URL}/api/shortcut`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SHORTCUT_TOKEN}`,
    },
    body: JSON.stringify({ language: LANG, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `iVoice HTTP ${res.status}`);
  return data;
}

async function handleMessage(msg) {
  const chatId = String(msg.chat?.id ?? "");
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
    return; // ignore everyone except the owner
  }
  const replyTo = msg.message_id;

  // 1) voice note or audio file
  const audio = msg.voice || msg.audio || (msg.document?.mime_type?.startsWith("audio/") ? msg.document : null);
  // 2) plain text
  const text = typeof msg.text === "string" ? msg.text.trim() : "";

  if (!audio && !text) return;

  if (text === "/start") {
    await sendMessage(chatId, "🎙️ Готова принимать. Надиктуй голосовое или напиши текст — разложу по местам.", replyTo);
    return;
  }

  try {
    // Resolve the audio payload once (used by both clarify and capture paths).
    const getAudioB64 = async () => (audio ? await fetchTelegramFileBase64(audio.file_id) : null);

    // ── 1) Reply to one of our clarification questions → answer it ──────────
    const repliedId = msg.reply_to_message?.message_id;
    if (repliedId) {
      const payload = audio ? { tg_message_id: repliedId, audio: await getAudioB64() }
                            : { tg_message_id: repliedId, answer: text };
      const c = await callClarify(payload);
      if (c.ok && !c.not_found) {
        if (c.label) await sendMessage(chatId, c.label, replyTo);
        // else: still awaiting → server pushed a fresh question; stay quiet.
        return;
      }
      // not_found → the replied-to message wasn't a question; fall through to capture.
    }

    // ── 2) Plain text with no reply, but exactly one open question → answer it ─
    if (text && !repliedId) {
      const { count, pending } = await getPending();
      if (count === 1) {
        const c = await callClarify({ item_id: pending[0].item_id, answer: text });
        if (c.ok && !c.not_found) {
          if (c.label) await sendMessage(chatId, c.label, replyTo);
          return;
        }
      } else if (count > 1) {
        await sendMessage(
          chatId,
          `❓ Открытых вопросов несколько (${count}). Ответь reply'ем на нужный — и я запишу. Ничего нового не создаю.`,
          replyTo,
        );
        return; // do NOT fall through to capture
      }
    }

    // ── 3) Normal capture ──────────────────────────────────────────────────
    let result;
    if (audio) {
      result = await callShortcut({ audio: await getAudioB64() });
    } else {
      result = await callShortcut({ text });
    }
    const msgText = formatResult(result);
    if (msgText) await sendMessage(chatId, msgText, replyTo);
  } catch (err) {
    console.error("[voicemind-tg] handle error:", err.message);
    await sendMessage(chatId, `⚠️ Не получилось обработать: ${err.message}`, replyTo);
  }
}

async function loop() {
  let offset = loadOffset();
  console.log(`[voicemind-tg] started. iVoice=${IVOICE_URL} chat=${ALLOWED_CHAT_ID || "any"}`);
  // who am I
  const me = await tg("getMe", {}).catch(() => null);
  if (me?.ok) console.log(`[voicemind-tg] bot @${me.result.username}`);

  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}&allowed_updates=["message"]`);
      const data = await res.json();
      if (!data.ok) {
        console.error("[voicemind-tg] getUpdates error:", JSON.stringify(data));
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const update of data.result) {
        offset = update.update_id + 1;
        saveOffset(offset);
        if (update.message) await handleMessage(update.message);
      }
    } catch (err) {
      console.error("[voicemind-tg] loop error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

loop();
