import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const OWNER_ID = process.env.OWNER_ID || "";
const SECRET_TOKEN = process.env.SECRET_TOKEN || "my_secret_123";
const VIEWER_KEY = process.env.VIEWER_KEY || SECRET_TOKEN || "my_secret_123";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "db.json");

const MAX_MESSAGES_PER_DIALOG = Number(process.env.MAX_MESSAGES_PER_DIALOG || 1000);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = loadDb();

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return emptyDb();
    }

    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      connections: parsed.connections || {},
      dialogs: parsed.dialogs || {},
      dialogIndex: parsed.dialogIndex || []
    };
  } catch (e) {
    console.error("DB load error:", e);
    return emptyDb();
  }
}

function emptyDb() {
  return {
    connections: {},
    dialogs: {},
    dialogIndex: []
  };
}

function saveDb() {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

function json(res, data, status = 200) {
  return res.status(status)
    .set("Cache-Control", "no-store")
    .json(data);
}

function html(res, text, status = 200) {
  return res.status(status)
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", "no-store")
    .send(text);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(text) {
  return escapeHtml(text).replaceAll('"', "&quot;");
}

function line() {
  return "━━━━━━━━━━━━━━";
}

function nowMs() {
  return Date.now();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function formatTime(unixSeconds) {
  if (!unixSeconds) return "неизвестно";

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(Number(unixSeconds) * 1000)).replace(",", " •");
}

function formatNow() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date()).replace(",", " •");
}

function originOf(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function checkViewerAccess(req) {
  const key = req.query.key || "";
  return key && String(key) === VIEWER_KEY;
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
}

async function tg(method, payload) {
  if (!BOT_TOKEN) {
    console.log("BOT_TOKEN is missing");
    return { ok: false, error: "BOT_TOKEN is missing" };
  }

  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();

  if (!res.ok) {
    console.log("Telegram API error:", method, res.status, text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, raw: text };
  }
}

async function sendTextToChat(chatId, text) {
  if (!chatId) return null;

  return tg("sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

async function sendToOwnerOnly(text) {
  if (!OWNER_ID) return null;
  return sendTextToChat(OWNER_ID, text);
}

async function sendToBusinessUserOnly(businessConnectionId, text) {
  if (!businessConnectionId) return null;

  const owner = await getBusinessOwner(businessConnectionId);

  if (!owner || !owner.chatId) return null;

  if (OWNER_ID && String(owner.chatId) === String(OWNER_ID)) {
    return null;
  }

  return sendTextToChat(owner.chatId, text);
}

async function sendStoredMediaToChat(chatId, media, caption = "") {
  if (!chatId || !media || !media.file_id) return null;

  const common = {
    chat_id: chatId,
    caption: caption ? String(caption).slice(0, 1000) : undefined,
    parse_mode: "HTML"
  };

  if (!common.caption) {
    delete common.caption;
    delete common.parse_mode;
  }

  if (media.type === "photo") {
    return tg("sendPhoto", { ...common, photo: media.file_id });
  }

  if (media.type === "video") {
    return tg("sendVideo", { ...common, video: media.file_id });
  }

  if (media.type === "animation") {
    return tg("sendAnimation", { ...common, animation: media.file_id });
  }

  if (media.type === "audio") {
    return tg("sendAudio", { ...common, audio: media.file_id });
  }

  if (media.type === "voice") {
    return tg("sendVoice", { ...common, voice: media.file_id });
  }

  if (media.type === "sticker") {
    return tg("sendSticker", { chat_id: chatId, sticker: media.file_id });
  }

  if (media.type === "video_note") {
    return tg("sendVideoNote", { chat_id: chatId, video_note: media.file_id });
  }

  return tg("sendDocument", { ...common, document: media.file_id });
}

function userName(user) {
  if (!user) return "unknown";

  let name = [user.first_name, user.last_name].filter(Boolean).join(" ");

  if (user.username) {
    name += ` (@${user.username})`;
  }

  return name || String(user.id || "unknown");
}

function shortUser(user) {
  if (!user) return "unknown";

  if (user.username) {
    return `@${user.username}`;
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const id = user.id ? `ID:${user.id}` : "ID:unknown";

  return name ? `${name} (${id})` : id;
}

function chatName(chat) {
  if (!chat) return "unknown";

  let name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ");

  if (chat.username) {
    name += ` (@${chat.username})`;
  }

  return name || String(chat.id || "unknown");
}

function shortChat(chat) {
  if (!chat) return "unknown";

  if (chat.username) return `@${chat.username}`;

  const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  const id = chat.id ? `ID:${chat.id}` : "ID:unknown";

  return name ? `${name} (${id})` : id;
}

function fallbackOwnerName() {
  return "Business аккаунт";
}

function isBusinessMessage(msg) {
  return Boolean(msg.business_connection_id);
}

function isPrivateChat(chat) {
  return chat && chat.type === "private";
}

async function directionInfo(msg) {
  const chat = msg.chat || {};
  const sender = msg.from || {};

  const senderName = userName(sender);
  const senderShort = shortUser(sender);
  const senderId = sender.id || "";

  const dialogName = chatName(chat);
  const dialogShort = shortChat(chat);
  const dialogId = chat.id || "";

  if (isBusinessMessage(msg)) {
    const owner = await getBusinessOwner(msg.business_connection_id);

    const ownerName = owner?.name || fallbackOwnerName();
    const ownerShort = owner?.shortName || fallbackOwnerName();
    const ownerId = owner?.id || "";

    if (
      isPrivateChat(chat) &&
      sender.id &&
      chat.id &&
      String(sender.id) === String(chat.id)
    ) {
      return {
        side: "left",
        from: senderName,
        fromShort: senderShort,
        fromId: senderId,
        to: ownerName,
        toShort: ownerShort,
        toId: ownerId,
        dialog: `${ownerName} ↔ ${dialogName}`,
        dialogShort: `${ownerShort} ↔ ${dialogShort}`,
        dialogId
      };
    }

    if (isPrivateChat(chat)) {
      return {
        side: "right",
        from: senderName,
        fromShort: ownerShort,
        fromId: senderId,
        to: dialogName,
        toShort: dialogShort,
        toId: dialogId,
        dialog: `${ownerName} ↔ ${dialogName}`,
        dialogShort: `${ownerShort} ↔ ${dialogShort}`,
        dialogId
      };
    }

    return {
      side: "left",
      from: senderName,
      fromShort: senderShort,
      fromId: senderId,
      to: dialogName,
      toShort: dialogShort,
      toId: dialogId,
      dialog: dialogName,
      dialogShort: dialogShort,
      dialogId
    };
  }

  return {
    side: "left",
    from: senderName,
    fromShort: senderShort,
    fromId: senderId,
    to: dialogName,
    toShort: dialogShort,
    toId: dialogId,
    dialog: dialogName,
    dialogShort: dialogShort,
    dialogId
  };
}

function isStartCommand(msg) {
  if (!msg.text) return false;
  return msg.text === "/start" || msg.text.startsWith("/start ");
}

function isGetCommand(msg) {
  if (!msg.text) return false;
  return /^\/get(?:@\w+)?\s+\S+/i.test(String(msg.text).trim());
}

function getCommandId(msg) {
  const text = String(msg.text || "").trim();
  const parts = text.split(/\s+/);
  return parts[1] || "";
}

async function saveBusinessConnection(connection) {
  if (!connection || !connection.id) return;

  const user = connection.user || {};

  db.connections[connection.id] = {
    id: connection.id,
    is_enabled: connection.is_enabled,
    user_id: user.id || "",
    user_name: userName(user),
    user_short_name: shortUser(user),
    user_chat_id: connection.user_chat_id || "",
    date: connection.date || null,
    rights: connection.rights || null,
    saved_at: nowMs()
  };

  saveDb();
}

async function fetchBusinessConnection(businessConnectionId) {
  if (!businessConnectionId) return null;

  const result = await tg("getBusinessConnection", {
    business_connection_id: businessConnectionId
  });

  if (!result || !result.ok || !result.result) {
    console.log("getBusinessConnection failed:", result);
    return null;
  }

  await saveBusinessConnection(result.result);

  const user = result.result.user || {};

  return {
    id: result.result.id,
    is_enabled: result.result.is_enabled,
    user_id: user.id || "",
    user_name: userName(user),
    user_short_name: shortUser(user),
    user_chat_id: result.result.user_chat_id || "",
    date: result.result.date || null,
    rights: result.result.rights || null,
    saved_at: nowMs()
  };
}

async function getBusinessOwner(businessConnectionId) {
  if (!businessConnectionId) return null;

  let saved = db.connections[businessConnectionId];

  if (!saved) {
    saved = await fetchBusinessConnection(businessConnectionId);
  }

  if (!saved) return null;

  return {
    id: saved.user_id || "",
    name: saved.user_name || fallbackOwnerName(),
    shortName: saved.user_short_name || saved.user_name || fallbackOwnerName(),
    chatId: saved.user_chat_id || ""
  };
}

function getText(msg) {
  if (msg.text) return msg.text;
  if (msg.caption) return msg.caption;
  if (msg.photo) return "[🖼 фото]";
  if (msg.video) return "[🎬 видео]";

  if (msg.document) {
    const fileName = msg.document.file_name ? `: ${msg.document.file_name}` : "";
    return `[📄 документ / файл${fileName}]`;
  }

  if (msg.voice) return "[🎤 голосовое сообщение]";
  if (msg.video_note) return "[⭕ видеосообщение / кружочек]";

  if (msg.sticker) {
    const emoji = msg.sticker.emoji ? ` ${msg.sticker.emoji}` : "";
    return `[🌟 стикер${emoji}]`;
  }

  if (msg.animation) return "[🎞 GIF / анимация]";
  if (msg.audio) return "[🎧 аудио]";

  return "[сообщение без текста]";
}

function hasMedia(msg) {
  return Boolean(
    msg.photo ||
    msg.video ||
    msg.document ||
    msg.animation ||
    msg.sticker ||
    msg.audio ||
    msg.voice ||
    msg.video_note
  );
}

function mediaInfo(msg) {
  if (msg.photo && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      type: "photo",
      file_id: photo.file_id,
      label: "Фото",
      mime_type: "image/jpeg",
      file_name: ""
    };
  }

  if (msg.video && msg.video.file_id) {
    return {
      type: "video",
      file_id: msg.video.file_id,
      label: "Видео",
      mime_type: msg.video.mime_type || "video/mp4",
      file_name: msg.video.file_name || ""
    };
  }

  if (msg.document && msg.document.file_id) {
    return {
      type: "document",
      file_id: msg.document.file_id,
      label: "Документ",
      mime_type: msg.document.mime_type || "",
      file_name: msg.document.file_name || ""
    };
  }

  if (msg.animation && msg.animation.file_id) {
    return {
      type: "animation",
      file_id: msg.animation.file_id,
      label: "GIF",
      mime_type: msg.animation.mime_type || "video/mp4",
      file_name: msg.animation.file_name || ""
    };
  }

  if (msg.audio && msg.audio.file_id) {
    return {
      type: "audio",
      file_id: msg.audio.file_id,
      label: "Аудио",
      mime_type: msg.audio.mime_type || "audio/mpeg",
      file_name: msg.audio.file_name || msg.audio.title || ""
    };
  }

  if (msg.voice && msg.voice.file_id) {
    return {
      type: "voice",
      file_id: msg.voice.file_id,
      label: "Голосовое",
      mime_type: msg.voice.mime_type || "audio/ogg",
      file_name: ""
    };
  }

  if (msg.video_note && msg.video_note.file_id) {
    return {
      type: "video_note",
      file_id: msg.video_note.file_id,
      label: "Кружок",
      mime_type: "video/mp4",
      file_name: ""
    };
  }

  if (msg.sticker && msg.sticker.file_id) {
    return {
      type: "sticker",
      file_id: msg.sticker.file_id,
      label: `Стикер${msg.sticker.emoji ? " " + msg.sticker.emoji : ""}`,
      mime_type: msg.sticker.is_animated ? "application/x-tgsticker" : "image/webp",
      file_name: ""
    };
  }

  return null;
}

function replyInfo(msg) {
  const reply = msg.reply_to_message;

  if (!reply) return null;

  return {
    message_id: reply.message_id || null,
    author: shortUser(reply.from),
    text: getText(reply)
  };
}

function dialogIdForMsg(msg) {
  const connectionId = msg.business_connection_id || "normal";
  const chatId = msg.chat?.id || "unknown_chat";
  return `${connectionId}:${chatId}`;
}

function makeShortId() {
  const a = Math.random().toString(36).slice(2, 6);
  const b = Date.now().toString(36).slice(-4);
  return `${a}${b}`;
}

function resolveShortDialogId(shortId) {
  if (!shortId) return "";

  const found = Object.values(db.dialogs).find((d) => d.short_id === shortId);

  return found?.id || "";
}

function getDialog(id) {
  return db.dialogs[id] || null;
}

function putDialog(dialog) {
  if (!dialog || !dialog.id) return;

  if (!dialog.short_id) {
    dialog.short_id = makeShortId();
  }

  db.dialogs[dialog.id] = dialog;

  const exists = db.dialogIndex.some((x) => x.id === dialog.id);

  if (!exists) {
    db.dialogIndex.unshift({
      id: dialog.id,
      short_id: dialog.short_id,
      title: dialog.title,
      shortTitle: dialog.shortTitle,
      created_at: dialog.created_at || nowMs()
    });

    db.dialogIndex = db.dialogIndex.slice(0, 200);
  }

  saveDb();
}

async function getOrCreateDialog(msg, dir) {
  const id = dialogIdForMsg(msg);
  let dialog = getDialog(id);

  if (!dialog) {
    dialog = {
      id,
      short_id: makeShortId(),
      business_connection_id: msg.business_connection_id || null,
      chat_id: msg.chat?.id || null,
      title: dir.dialog || "Диалог",
      shortTitle: dir.dialogShort || dir.dialog || "Диалог",
      owner: {
        id: dir.toId || "",
        name: dir.to || "",
        short: dir.toShort || ""
      },
      peer: {
        id: msg.chat?.id || "",
        name: chatName(msg.chat),
        short: shortChat(msg.chat)
      },
      messages: [],
      notified: false,
      created_at: nowMs(),
      updated_at: nowMs()
    };
  }

  return dialog;
}

function buildStoredMessage(msg, dir) {
  const media = mediaInfo(msg);

  return {
    id: String(msg.message_id || ""),
    message_id: msg.message_id || null,
    side: dir.side || "left",
    from_id: dir.fromId || msg.from?.id || "",
    author: dir.fromShort || dir.from || "unknown",
    author_full: dir.from || "unknown",
    to_id: dir.toId || "",
    to: dir.to || "",
    text: msg.text || msg.caption || "",
    plain: getText(msg),
    date: msg.date || null,
    timeText: formatTime(msg.date),
    edited: false,
    edit_date: null,
    old_text: "",
    deleted: false,
    media,
    reply: replyInfo(msg),
    raw_type: hasMedia(msg) ? media?.type || "media" : "text",
    saved_at: nowMs()
  };
}

async function appendOrUpdateDialogMessage(msg, dir) {
  const dialog = await getOrCreateDialog(msg, dir);
  const stored = buildStoredMessage(msg, dir);

  const idx = dialog.messages.findIndex((m) => String(m.id) === String(stored.id));

  if (idx >= 0) {
    dialog.messages[idx] = {
      ...dialog.messages[idx],
      ...stored
    };
  } else {
    dialog.messages.push(stored);
  }

  dialog.messages = dialog.messages.slice(-MAX_MESSAGES_PER_DIALOG);
  dialog.updated_at = nowMs();

  putDialog(dialog);

  return dialog;
}

function oldFromStoredMessage(m, dialog = null) {
  if (!m) return null;

  return {
    text: m.text || m.plain || "",
    from_id: m.from_id || "",
    from_name: m.author_full || m.author || "unknown",
    from_short: m.author || m.author_full || "unknown",
    to_id: dialog?.owner?.id || "",
    to_name: dialog?.owner?.name || "",
    to_short: dialog?.owner?.short || "",
    dialog_name: dialog?.title || "",
    dialog_short: dialog?.shortTitle || "",
    message_id: m.message_id || m.id || "",
    date: m.date || null,
    raw: null
  };
}

async function getOldMessageFromDialog(msg) {
  const id = dialogIdForMsg(msg);
  const dialog = getDialog(id);

  if (!dialog) return null;

  const messageId = String(msg.message_id || "");
  const found = (dialog.messages || []).find((m) => String(m.id) === messageId);

  return oldFromStoredMessage(found, dialog);
}

async function getOldMessageFromDialogId(dialogId, messageId) {
  const dialog = getDialog(dialogId);

  if (!dialog) return null;

  const found = (dialog.messages || []).find((m) => String(m.id) === String(messageId));

  return oldFromStoredMessage(found, dialog);
}

async function markDialogMessageEdited(msg, dir, old) {
  const dialog = await getOrCreateDialog(msg, dir);
  const id = String(msg.message_id || "");
  const newText = msg.text || msg.caption || getText(msg);

  let idx = dialog.messages.findIndex((m) => String(m.id) === id);

  if (idx >= 0) {
    dialog.messages[idx].old_text = old?.text || dialog.messages[idx].text || dialog.messages[idx].plain || "";
    dialog.messages[idx].text = newText;
    dialog.messages[idx].plain = getText(msg);
    dialog.messages[idx].edited = true;
    dialog.messages[idx].edit_date = msg.edit_date || msg.date || null;
    dialog.messages[idx].timeText = formatTime(msg.edit_date || msg.date);
  } else {
    const stored = buildStoredMessage(msg, dir);
    stored.old_text = old?.text || "";
    stored.text = newText;
    stored.edited = true;
    stored.edit_date = msg.edit_date || msg.date || null;
    dialog.messages.push(stored);
  }

  dialog.messages = dialog.messages.slice(-MAX_MESSAGES_PER_DIALOG);
  dialog.updated_at = nowMs();

  putDialog(dialog);

  return dialog;
}

async function markDialogMessageDeleted(data, old, messageId, owner) {
  const fakeMsg = {
    business_connection_id: data.business_connection_id || null,
    chat: data.chat || {},
    from: {
      id: old?.from_id || "",
      first_name: old?.from_name || "unknown"
    },
    message_id: messageId,
    text: old?.text || "[сообщение удалено]",
    date: nowUnix()
  };

  const dir = {
    side: old?.from_id && old?.to_id && String(old.from_id) === String(old.to_id) ? "right" : "left",
    fromId: old?.from_id || "",
    from: old?.from_name || "unknown",
    fromShort: old?.from_short || old?.from_name || "unknown",
    toId: old?.to_id || owner?.id || "",
    to: old?.to_name || owner?.name || fallbackOwnerName(),
    toShort: old?.to_short || owner?.shortName || fallbackOwnerName(),
    dialog: old?.dialog_name || `${owner?.name || fallbackOwnerName()} ↔ ${chatName(data.chat)}`,
    dialogShort: old?.dialog_short || `${owner?.shortName || fallbackOwnerName()} ↔ ${shortChat(data.chat)}`
  };

  const dialog = await getOrCreateDialog(fakeMsg, dir);
  const id = String(messageId || "");

  let idx = dialog.messages.findIndex((m) => String(m.id) === id);

  if (idx >= 0) {
    dialog.messages[idx].deleted = true;
    if (old?.text) {
      dialog.messages[idx].plain = old.text;
      dialog.messages[idx].text = old.text;
    }
  } else {
    dialog.messages.push({
      id,
      message_id: messageId,
      side: dir.side || "left",
      from_id: old?.from_id || "",
      author: old?.from_short || old?.from_name || "unknown",
      author_full: old?.from_name || "unknown",
      to_id: old?.to_id || "",
      to: old?.to_name || "",
      text: old?.text || "[сообщение удалено]",
      plain: old?.text || "[сообщение удалено]",
      date: old?.date || null,
      timeText: formatNow(),
      edited: false,
      edit_date: null,
      old_text: "",
      deleted: true,
      media: null,
      reply: null,
      raw_type: "deleted",
      saved_at: nowMs()
    });
  }

  dialog.messages = dialog.messages.slice(-MAX_MESSAGES_PER_DIALOG);
  dialog.updated_at = nowMs();

  putDialog(dialog);

  return dialog;
}

async function findMediaById(mediaId) {
  if (!mediaId) return null;

  for (const dialog of Object.values(db.dialogs)) {
    const msg = (dialog.messages || []).find(
      (m) => String(m.id) === String(mediaId) || String(m.message_id) === String(mediaId)
    );

    if (msg && msg.media && msg.media.file_id) {
      return {
        id: mediaId,
        dialog_id: dialog.id,
        dialog_title: dialog.shortTitle || dialog.title || "",
        media: msg.media,
        from: msg.author_full || msg.author || "",
        fromShort: msg.author || "",
        fromId: msg.from_id || "",
        text: msg.text || "",
        date: msg.date || null
      };
    }
  }

  return null;
}

function dialogChatUrl(req, dialogOrId) {
  const key = encodeURIComponent(VIEWER_KEY);

  if (typeof dialogOrId === "object" && dialogOrId && dialogOrId.short_id) {
    return `${originOf(req)}/c?s=${encodeURIComponent(dialogOrId.short_id)}&key=${key}`;
  }

  const id = encodeURIComponent(String(dialogOrId || ""));
  return `${originOf(req)}/chat?id=${id}&key=${key}`;
}

async function notifyOwnerAboutDialog(req, dialog) {
  if (!OWNER_ID || dialog.notified) return;

  const url = dialogChatUrl(req, dialog);

  const text =
    `💬 <b>Новый Web-чат</b>\n` +
    `${line()}\n` +
    `<b>${escapeHtml(dialog.shortTitle || dialog.title)}</b>\n\n` +
    `🔗 Открыть:\n${escapeHtml(url)}\n\n` +
    `🕘 <code>${escapeHtml(formatNow())}</code>`;

  await sendToOwnerOnly(text);

  dialog.notified = true;
  putDialog(dialog);
}

function makeEditedReportForBusinessUser(msg, old, dir) {
  const newText = getText(msg);

  let report =
    `✏️ <b>Сообщение изменено</b>\n` +
    `${line()}\n` +
    `👤 От: <b>${escapeHtml(dir.from)}</b>\n` +
    `🆔 ID: <code>${escapeHtml(dir.fromId || "")}</code>\n\n` +
    `➡️ Кому: <b>${escapeHtml(dir.to)}</b>\n` +
    `🆔 ID: <code>${escapeHtml(dir.toId || "")}</code>\n` +
    `🧾 Msg ID: <code>${escapeHtml(msg.message_id || "")}</code>\n` +
    `🕘 <code>${escapeHtml(formatTime(msg.edit_date || msg.date))}</code>\n` +
    `${line()}\n\n`;

  if (old) {
    report +=
      `📝 Было:\n` +
      `<s>${escapeHtml(old.text)}</s>\n\n` +
      `✅ Стало:\n` +
      `<i>${escapeHtml(newText)}</i>`;
  } else {
    report +=
      `⚠️ Старый текст не найден.\n\n` +
      `✅ Сейчас:\n` +
      `<i>${escapeHtml(newText)}</i>`;
  }

  return report;
}

function makeDeletedReportForBusinessUser(old, messageId, owner) {
  if (old) {
    return (
      `🗑 <b>Сообщение удалено</b>\n` +
      `${line()}\n` +
      `👤 От: <b>${escapeHtml(old.from_name || "unknown")}</b>\n` +
      `🆔 ID: <code>${escapeHtml(old.from_id || "")}</code>\n\n` +
      `➡️ Кому: <b>${escapeHtml(old.to_name || fallbackOwnerName())}</b>\n` +
      `🆔 ID: <code>${escapeHtml(old.to_id || "")}</code>\n` +
      `🧾 Msg ID: <code>${escapeHtml(messageId || old.message_id || "")}</code>\n` +
      `🕘 <code>${escapeHtml(formatNow())}</code>\n` +
      `${line()}\n` +
      `🔴 <i>${escapeHtml(old.text || "[сообщение без текста]")}</i>`
    );
  }

  return (
    `🗑 <b>Сообщение удалено</b>\n` +
    `${line()}\n` +
    `👤 От: <b>неизвестно</b>\n` +
    `🆔 ID: <code>неизвестно</code>\n\n` +
    `➡️ Кому: <b>${escapeHtml(owner?.name || fallbackOwnerName())}</b>\n` +
    `🆔 ID: <code>${escapeHtml(owner?.id || "")}</code>\n` +
    `🧾 Msg ID: <code>${escapeHtml(messageId || "")}</code>\n` +
    `🕘 <code>${escapeHtml(formatNow())}</code>\n` +
    `${line()}\n` +
    `⚠️ <i>Текст не найден.</i>`
  );
}

function splitLongReports(reports, maxLength = 3500) {
  const chunks = [];
  let current = "";

  for (const report of reports) {
    const next = current ? current + "\n\n" + report : report;

    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = report;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

async function handleTelegramUpdate(req, update) {
  if (update.business_connection) {
    await handleBusinessConnection(update.business_connection);
  }

  if (update.message) {
    if (isStartCommand(update.message)) {
      await handleStart(update.message);
    } else if (isGetCommand(update.message)) {
      await handleGetCommand(update.message);
    } else {
      await handleMessage(req, update.message);
    }
  }

  if (update.edited_message) {
    await handleEditedMessage(req, update.edited_message);
  }

  if (update.business_message) {
    if (isStartCommand(update.business_message)) {
      await handleStart(update.business_message);
    } else {
      await handleMessage(req, update.business_message);
    }
  }

  if (update.edited_business_message) {
    await handleEditedMessage(req, update.edited_business_message);
  }

  if (update.deleted_business_messages) {
    await handleDeletedBusinessMessages(req, update.deleted_business_messages);
  }
}

async function handleGetCommand(msg) {
  const chatId = msg.chat?.id;
  const id = getCommandId(msg);

  if (!id) {
    await sendTextToChat(chatId, "Напиши так: <code>/get 63718</code>");
    return;
  }

  const data = await findMediaById(id);

  if (!data || !data.media || !data.media.file_id) {
    await sendTextToChat(
      chatId,
      `⚠️ Медиа с ID <code>${escapeHtml(id)}</code> не найдено.\n\n` +
      `Проверь ID в Web-чате. Старые медиа, сохранённые до обновления, могут не иметь file_id.`
    );
    return;
  }

  const caption =
    `📎 <b>${escapeHtml(data.media.label || "Медиа")}</b>\n` +
    `🧾 Media ID: <code>${escapeHtml(id)}</code>\n` +
    `💬 Диалог: <b>${escapeHtml(data.dialog_title || "")}</b>\n` +
    `👤 От: ${escapeHtml(data.fromShort || data.from || "")}\n` +
    `🕘 ${escapeHtml(formatTime(data.date))}` +
    (data.text ? `\n\n💬 ${escapeHtml(data.text)}` : "");

  const result = await sendStoredMediaToChat(chatId, data.media, caption);

  if (!result || !result.ok) {
    await sendTextToChat(
      chatId,
      `⚠️ Не получилось отправить медиа ID <code>${escapeHtml(id)}</code>.\n\n` +
      `<code>${escapeHtml(JSON.stringify(result || {}))}</code>`
    );
  }
}

async function handleStart(msg) {
  const chatId = msg.chat?.id;

  const text =
    `🛡 <b>AllSaveModBot Web Chat</b>\n\n` +

    `Это бот для сохранения и просмотра важных Telegram Business-сообщений в удобном формате.\n\n` +

    `Бот помогает не потерять сообщения, даже если они были изменены или удалены.\n\n` +

    `${line()}\n\n` +

    `🔹 <b>Что умеет бот:</b>\n\n` +

    `💬 <b>Сохраняет переписки</b>\n` +
    `Сообщения отображаются в Web-чате как настоящая переписка: слева и справа, с именами пользователей.\n\n` +

    `✏️ <b>Показывает изменения</b>\n` +
    `Если сообщение изменили, бот показывает старый и новый вариант.\n\n` +

    `🗑 <b>Показывает удалённые сообщения</b>\n` +
    `Если сообщение было сохранено до удаления, его можно увидеть в Web-чате.\n\n` +

    `🖼 <b>Работает с медиа</b>\n` +
    `Фото, видео, голосовые, кружочки, документы, GIF и стикеры.\n\n` +

    `🔎 <b>Поиск по Media ID</b>\n` +
    `Если файл не открывается в Web-чате, отправь команду:\n` +
    `<code>/get MEDIA_ID</code>\n\n` +

    `${line()}\n\n` +

    `🔌 <b>Как подключить бота к своему аккаунту:</b>\n\n` +
    `1. Открой профиль бота.\n` +
    `2. Нажми <b>Start</b>.\n` +
    `3. Открой <b>Telegram Business</b> в настройках Telegram.\n` +
    `4. Перейди в раздел <b>Чат-боты</b>.\n` +
    `5. Добавь этого бота и выдай нужные права.\n\n` +

    `После подключения бот начнёт сохранять сообщения автоматически.\n\n` +

    `✅ <b>Бот активен и готов к работе.</b>`;

  await sendTextToChat(chatId, text);
}
async function handleBusinessConnection(connection) {
  await saveBusinessConnection(connection);

  const user = connection.user || {};
  const status = connection.is_enabled
    ? "✅ <b>Бот подключён</b>"
    : "⛔ <b>Бот отключён</b>";

  const actionTime = connection.date ? formatTime(connection.date) : formatNow();

  const report =
    `${status}\n` +
    `${line()}\n\n` +
    `👤 <b>Аккаунт:</b> ${escapeHtml(userName(user))}\n` +
    `🆔 <b>ID:</b> <code>${escapeHtml(user.id || "")}</code>\n\n` +
    `🔗 <b>Business Connection ID:</b>\n<code>${escapeHtml(connection.id || "")}</code>\n\n` +
    `💬 <b>User Chat ID:</b> <code>${escapeHtml(connection.user_chat_id || "")}</code>\n` +
    `🕘 <b>${escapeHtml(actionTime)}</b>`;

  await sendToOwnerOnly(report);
}

async function handleMessage(req, msg) {
  const dir = await directionInfo(msg);

  const dialog = await appendOrUpdateDialogMessage(msg, dir);

  await notifyOwnerAboutDialog(req, dialog);
}

async function handleEditedMessage(req, msg) {
  const businessConnectionId = msg.business_connection_id || null;
  const dir = await directionInfo(msg);

  const old = await getOldMessageFromDialog(msg);

  const dialog = await markDialogMessageEdited(msg, dir, old);

  await notifyOwnerAboutDialog(req, dialog);

  await sendToBusinessUserOnly(
    businessConnectionId,
    makeEditedReportForBusinessUser(msg, old, dir)
  );
}

async function handleDeletedBusinessMessages(req, data) {
  const connectionId = data.business_connection_id || "normal";
  const chatId = data.chat?.id || "unknown_chat";
  const ids = data.message_ids || [];
  const owner = await getBusinessOwner(connectionId);

  const reportsForBusinessUser = [];
  const limitedIds = ids.slice(0, 30);

  let lastDialog = null;

  for (const messageId of limitedIds) {
    const dialogId = `${connectionId}:${chatId}`;
    const old = await getOldMessageFromDialogId(dialogId, messageId);

    lastDialog = await markDialogMessageDeleted(data, old, messageId, owner);

    reportsForBusinessUser.push(makeDeletedReportForBusinessUser(old, messageId, owner));
  }

  if (lastDialog) {
    await notifyOwnerAboutDialog(req, lastDialog);
  }

  if (ids.length > 30) {
    reportsForBusinessUser.push(
      `⚠️ <b>Показаны первые 30 удалённых сообщений из ${ids.length}.</b>`
    );
  }

  const chunks = splitLongReports(reportsForBusinessUser, 3500);

  for (const chunk of chunks.slice(0, 2)) {
    await sendToBusinessUserOnly(connectionId, chunk);
  }
}

async function handleApiChat(req, res) {
  let id = req.query.id || "";
  const shortId = req.query.s || "";

  if (!id && shortId) {
    id = resolveShortDialogId(shortId);
  }

  if (id) {
    const dialog = getDialog(id);

    if (!dialog) {
      return json(res, { ok: false, error: "Dialog not found" }, 404);
    }

    return json(res, {
      ok: true,
      dialog
    });
  }

  const dialogs = [];

  for (const item of db.dialogIndex) {
    const dialog = getDialog(item.id);

    if (!dialog) {
      dialogs.push(item);
      continue;
    }

    const last = (dialog.messages || [])[dialog.messages?.length - 1] || null;

    dialogs.push({
      id: dialog.id,
      short_id: dialog.short_id || item.short_id || "",
      title: dialog.title || item.title || "",
      shortTitle: dialog.shortTitle || item.shortTitle || "",
      updated_at: dialog.updated_at || item.updated_at || 0,
      count: dialog.messages?.length || 0,
      lastText: last ? (last.plain || last.text || "") : ""
    });
  }

  dialogs.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));

  return json(res, {
    ok: true,
    dialogs
  });
}

async function handleFileProxy(req, res) {
  const fileId = req.query.file_id || "";

  if (!fileId) {
    return res.status(400).send("Missing file_id");
  }

  const fileRes = await tg("getFile", { file_id: fileId });

  if (!fileRes || !fileRes.ok || !fileRes.result || !fileRes.result.file_path) {
    return res.status(404).send("Cannot get file");
  }

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileRes.result.file_path}`;

  const upstream = await fetch(fileUrl);

  if (!upstream.ok) {
    return res.status(upstream.status).send("Cannot download file");
  }

  res.set("Cache-Control", "private, max-age=3600");

  const contentType = upstream.headers.get("content-type");
  if (contentType) res.set("Content-Type", contentType);

  const arrayBuffer = await upstream.arrayBuffer();
  return res.send(Buffer.from(arrayBuffer));
}

function homePage(req) {
  const key = encodeURIComponent(VIEWER_KEY);
  const apiUrl = `${originOf(req)}/api/chat?key=${key}`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Web Chats</title>
  <style>
    :root {
      --bg: #0d1b24;
      --card: #192b38;
      --card2: #1e3342;
      --text: #f2f7fb;
      --muted: #9fb0bd;
      --line: rgba(255,255,255,.08);
      --accent: #4396f6;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 0%, rgba(64, 119, 255, .16), transparent 28%),
        radial-gradient(circle at 90% 10%, rgba(51, 184, 255, .10), transparent 24%),
        var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }

    .wrap {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: max(18px, env(safe-area-inset-top)) 14px 90px;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 5;
      margin: calc(max(18px, env(safe-area-inset-top)) * -1) -14px 14px;
      padding: max(18px, env(safe-area-inset-top)) 14px 14px;
      background: rgba(13, 27, 36, .92);
      backdrop-filter: blur(18px);
      border-bottom: 1px solid var(--line);
    }

    .headRow {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    h1 {
      margin: 0;
      font-size: 26px;
      letter-spacing: -.3px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .dot {
      width: 9px;
      height: 9px;
      background: #43d17c;
      border-radius: 50%;
      display: inline-block;
      box-shadow: 0 0 14px rgba(67,209,124,.8);
    }

    .count {
      color: var(--muted);
      font-size: 14px;
      white-space: nowrap;
    }

    .search {
      width: min(100%, 620px);
      height: 54px;
      border: 1px solid rgba(255,255,255,.11);
      outline: none;
      border-radius: 16px;
      padding: 0 18px;
      background: rgba(255,255,255,.075);
      color: var(--text);
      font-size: 17px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.02);
    }

    .search::placeholder {
      color: #94a5b3;
    }

    .list {
      display: grid;
      gap: 12px;
    }

    .card {
      display: grid;
      grid-template-columns: 54px 1fr auto;
      gap: 12px;
      align-items: center;
      text-decoration: none;
      color: inherit;
      padding: 14px 14px;
      background: linear-gradient(180deg, var(--card2), var(--card));
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 18px;
      box-shadow: 0 10px 22px rgba(0,0,0,.13);
      position: relative;
    }

    .card.unread {
      border-color: rgba(255, 75, 75, .78);
      box-shadow: 0 0 0 1px rgba(255, 75, 75, .25), 0 12px 28px rgba(255, 25, 25, .10);
    }

    .card.unread::after {
      content: "";
      position: absolute;
      top: 12px;
      right: 12px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ff3b3b;
      box-shadow: 0 0 14px rgba(255, 59, 59, .9);
    }

    .avatar {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #4da3ff, #2c6cc4);
      font-weight: 800;
      font-size: 17px;
      color: white;
    }

    .title {
      font-weight: 800;
      font-size: 16px;
      line-height: 1.25;
      margin-bottom: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .last {
      color: var(--muted);
      font-size: 20px;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card.unread .title,
    .card.unread .last,
    .card.unread .meta {
      color: #ff6b6b;
    }

    .unreadBadge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: #ff3b3b;
      color: white;
      font-size: 12px;
      font-weight: 900;
      margin-top: 6px;
      box-shadow: 0 0 14px rgba(255, 59, 59, .45);
    }

    .meta {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
      align-self: start;
      padding-top: 3px;
    }

    .empty {
      color: var(--muted);
      text-align: center;
      padding: 42px 12px;
      background: rgba(255,255,255,.04);
      border: 1px solid var(--line);
      border-radius: 18px;
    }

    @media (max-width: 520px) {
      .wrap { padding-left: 12px; padding-right: 12px; }
      header { margin-left: -12px; margin-right: -12px; padding-left: 12px; padding-right: 12px; }
      h1 { font-size: 24px; }
      .search { width: 100%; height: 52px; font-size: 16px; }
      .card { grid-template-columns: 46px 1fr auto; padding: 12px; border-radius: 16px; }
      .avatar { width: 46px; height: 46px; font-size: 15px; }
      .title { font-size: 15px; }
      .last { font-size: 18px; }
      .meta { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="headRow">
        <h1>Web Chats <span class="dot"></span></h1>
        <div class="count" id="count">0 диалогов</div>
      </div>
      <input class="search" id="search" placeholder="Поиск по диалогам..." autocomplete="off">
    </header>

    <main class="list" id="list">
      <div class="empty">Загрузка...</div>
    </main>
  </div>

  <script>
    const API_URL = ${JSON.stringify(apiUrl)};
    const KEY = ${JSON.stringify(key)};
    let dialogs = [];

    function esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, m => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[m]));
    }

    function initials(title) {
      const t = String(title || "CH").replace(/[@()]/g, " ").trim();
      const words = t.split(/\\s+/).filter(Boolean);
      if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
      return t.slice(0, 2).toUpperCase() || "CH";
    }

    function lastText(d) {
      return d.lastText || d.preview || ("Сообщений: " + (d.count || 0));
    }

    function matches(d, q) {
      if (!q) return true;
      q = q.toLowerCase();
      return [d.title, d.shortTitle, d.id, d.short_id, d.lastText, d.preview]
        .filter(Boolean)
        .some(x => String(x).toLowerCase().includes(q));
    }

    function readKey(d) {
      return 'read_at:' + (d.short_id || d.id || '');
    }

    function isUnread(d) {
      const readAt = Number(localStorage.getItem(readKey(d)) || 0);
      const updatedAt = Number(d.updated_at || 0);
      return updatedAt > readAt;
    }

    function render() {
      const q = document.getElementById("search").value.trim();
      const list = document.getElementById("list");
      const items = dialogs.filter(d => matches(d, q));

      document.getElementById("count").textContent =
        dialogs.length + " " + (dialogs.length === 1 ? "диалог" : "диалогов");

      if (items.length === 0) {
        list.innerHTML = '<div class="empty">Ничего не найдено</div>';
        return;
      }

      list.innerHTML = items.map(d => {
        const href = d.short_id
          ? '/c?s=' + encodeURIComponent(d.short_id) + '&key=' + KEY
          : '/chat?id=' + encodeURIComponent(d.id) + '&key=' + KEY;

        const unread = isUnread(d);
        const cardClass = unread ? 'card unread' : 'card';
        const badge = unread ? '<div class="unreadBadge">NEW</div>' : '';

        return '<a class="' + cardClass + '" href="' + href + '">' +
          '<div class="avatar">' + esc(initials(d.shortTitle || d.title)) + '</div>' +
          '<div style="min-width:0">' +
            '<div class="title">' + esc(d.shortTitle || d.title || d.id) + '</div>' +
            '<div class="last">' + esc(lastText(d)) + '</div>' +
            badge +
          '</div>' +
          '<div class="meta">' + esc(d.count || 0) + '</div>' +
        '</a>';
      }).join('');
    }

    async function load() {
      const res = await fetch(API_URL, { cache: "no-store" });
      const data = await res.json();

      if (!data.ok || !data.dialogs) {
        document.getElementById("list").innerHTML = '<div class="empty">Ошибка загрузки</div>';
        return;
      }

      dialogs = data.dialogs;
      render();
    }

    document.getElementById("search").addEventListener("input", render);

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}

function blockedPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Forbidden</title>
  <style>
    body{font-family:system-ui;background:#101820;color:white;padding:30px}
    .box{max-width:520px;margin:auto;background:#1b2c39;padding:20px;border-radius:18px}
  </style>
</head>
<body>
  <div class="box">
    <h2>403 Forbidden</h2>
    <p>Неверный key в ссылке.</p>
  </div>
</body>
</html>`;
}

function chatPage(req) {
  const id = req.query.id || "";
  const shortId = req.query.s || "";
  const key = req.query.key || "";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Web Chat</title>
  <style>
    :root {
      --bg: #0d1b24;
      --panel: rgba(15, 27, 36, .92);
      --left: #223645;
      --right: #2e6294;
      --text: #f4f8fb;
      --muted: #a7b7c4;
      --danger: #ff7777;
      --line: rgba(255,255,255,.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background:
        radial-gradient(circle at 20% 10%, rgba(90, 77, 255, .18), transparent 32%),
        radial-gradient(circle at 90% 20%, rgba(0, 186, 255, .12), transparent 30%),
        var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      min-height: 100vh;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 5;
      background: var(--panel);
      backdrop-filter: blur(18px);
      border-bottom: 1px solid var(--line);
      padding: max(12px, env(safe-area-inset-top)) 14px 12px;
    }

    .top {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .backChats {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      text-decoration: none;
      color: #dff0ff;
      background: rgba(255,255,255,.09);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      padding: 10px 12px;
      font-weight: 800;
      font-size: 14px;
      white-space: nowrap;
    }

    .refreshBtn {
      border: 0;
      color: #dff0ff;
      background: rgba(255,255,255,.09);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      width: 42px;
      height: 42px;
      font-size: 19px;
      font-weight: 800;
    }

    .headText { min-width: 0; flex: 1; }

    h1 {
      margin: 0;
      font-size: 18px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .searchWrap { margin-top: 10px; }

    input {
      width: 100%;
      height: 52px;
      border: 1px solid rgba(255,255,255,.12);
      outline: none;
      border-radius: 16px;
      padding: 0 17px;
      background: rgba(255,255,255,.08);
      color: var(--text);
      font-size: 16px;
    }

    input::placeholder { color: #9aaab7; }

    main {
      padding: 14px 10px 90px;
      max-width: 920px;
      margin: 0 auto;
    }

    .day { text-align: center; margin: 14px 0; }

    .day span {
      display: inline-block;
      background: rgba(255,255,255,.12);
      border-radius: 999px;
      padding: 6px 12px;
      font-weight: 700;
      font-size: 13px;
    }

    .row { display: flex; margin: 8px 0; }
    .row.left { justify-content: flex-start; }
    .row.right { justify-content: flex-end; }

    .bubble {
      max-width: min(78%, 560px);
      border-radius: 18px;
      padding: 9px 10px 8px;
      box-shadow: 0 8px 18px rgba(0,0,0,.16);
      overflow: hidden;
      word-wrap: break-word;
      white-space: pre-wrap;
    }

    .left .bubble { background: var(--left); border-bottom-left-radius: 5px; }
    .right .bubble { background: var(--right); border-bottom-right-radius: 5px; }

    .author {
      font-size: 12px;
      color: rgba(255,255,255,.72);
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .text { font-size: 16px; line-height: 1.28; }

    .meta {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      align-items: center;
      color: rgba(255,255,255,.58);
      font-size: 11px;
      margin-top: 4px;
      white-space: nowrap;
    }

    .editedTag { color: #ffd58a; }

    .deleted .text {
      color: rgba(255,255,255,.65);
      text-decoration: line-through;
    }

    .deleted .bubble { outline: 1px solid rgba(255, 119, 119, .25); }

    .old {
      display: block;
      color: rgba(255,255,255,.55);
      text-decoration: line-through;
      margin-bottom: 4px;
    }

    .reply {
      border-left: 3px solid rgba(255,255,255,.55);
      background: rgba(255,255,255,.09);
      padding: 5px 8px;
      border-radius: 9px;
      margin-bottom: 6px;
      color: rgba(255,255,255,.78);
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mediaBox {
      margin-top: 6px;
      border-radius: 14px;
      overflow: hidden;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.07);
    }

    .mediaBox img,
    .mediaBox video {
      display: block;
      width: 100%;
      max-height: 420px;
      object-fit: contain;
      background: rgba(0,0,0,.22);
    }

    .mediaPad { padding: 10px; }

    audio { width: 100%; }

    .fileLink {
      color: #cfe9ff;
      text-decoration: none;
      display: block;
      padding: 10px;
      font-weight: 700;
    }

    .mediaId {
      font-size: 12px;
      color: rgba(255,255,255,.65);
      margin-top: 4px;
    }

    .empty {
      color: var(--muted);
      text-align: center;
      padding: 40px 0;
    }

    mark {
      background: #ffd54a;
      color: #111;
      border-radius: 4px;
      padding: 0 2px;
    }
  </style>
</head>
<body>
  <header>
    <div class="top">
      <a class="backChats" href="/?key=${escapeAttr(key)}">‹ Чаты</a>
      <div class="headText">
        <h1 id="title">Загрузка...</h1>
        <div class="sub" id="subtitle">ID: ${escapeHtml(id || shortId)}</div>
      </div>
      <button class="refreshBtn" onclick="load()">↻</button>
    </div>
    <div class="searchWrap">
      <input id="search" placeholder="Поиск по тексту или Media ID..." autocomplete="off">
    </div>
  </header>

  <main id="chat">
    <div class="empty">Загрузка...</div>
  </main>

  <script>
    const DIALOG_ID = ${JSON.stringify(id)};
    const SHORT_ID = ${JSON.stringify(shortId)};
    const KEY = ${JSON.stringify(key)};
    const API_URL = SHORT_ID
      ? '/api/chat?s=' + encodeURIComponent(SHORT_ID) + '&key=' + encodeURIComponent(KEY)
      : '/api/chat?id=' + encodeURIComponent(DIALOG_ID) + '&key=' + encodeURIComponent(KEY);

    let lastHash = "";
    let dialog = null;

    function esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, m => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[m]));
    }

    function fileUrl(fileId) {
      return '/file?file_id=' + encodeURIComponent(fileId) + '&key=' + encodeURIComponent(KEY);
    }

    function textWithSearch(s, q) {
      const safe = esc(s);
      if (!q) return safe;

      const idx = safe.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return safe;

      return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' + safe.slice(idx + q.length);
    }

    function mediaHtml(m) {
      if (!m || !m.media || !m.media.file_id) return "";

      const media = m.media;
      const url = fileUrl(media.file_id);
      const idLine = '<div class="mediaId">Media ID: ' + esc(m.message_id || m.id || "") + '</div>';

      if (media.type === 'photo') {
        return '<div class="mediaBox"><img src="' + url + '" loading="lazy"></div>' + idLine;
      }

      if (media.type === 'video' || media.type === 'video_note') {
        return '<div class="mediaBox"><video src="' + url + '" controls playsinline></video></div>' + idLine;
      }

      if (media.type === 'voice' || media.type === 'audio') {
        return '<div class="mediaBox mediaPad"><audio src="' + url + '" controls></audio><div class="mediaId">Если на iPhone ошибка — отправь боту /get ' + esc(m.message_id || m.id || "") + '</div></div>' + idLine;
      }

      if (media.type === 'animation' || media.type === 'sticker' || media.type === 'document') {
        const name = media.file_name || media.label || 'Медиа';
        const cmd = '/get ' + esc(m.message_id || m.id || "");
        return '<div class="mediaBox mediaPad">' +
          '<b>📎 ' + esc(name) + '</b><br>' +
          '<span class="mediaId">Чтобы получить файл в Telegram, отправь боту:</span><br>' +
          '<code>' + cmd + '</code>' +
        '</div>' + idLine;
      }

      return '<div class="mediaBox"><a class="fileLink" href="' + url + '" target="_blank">📎 Открыть медиа</a></div>' + idLine;
    }

    function messageMatches(m, q) {
      if (!q) return true;
      q = q.toLowerCase();

      return [
        m.text,
        m.plain,
        m.author,
        m.author_full,
        m.id,
        m.message_id,
        m.media && m.media.file_name,
        m.media && m.media.label
      ].filter(Boolean).some(x => String(x).toLowerCase().includes(q));
    }

    function render() {
      const root = document.getElementById('chat');
      const q = document.getElementById('search').value.trim();

      if (!dialog) {
        root.innerHTML = '<div class="empty">Нет данных</div>';
        return;
      }

      document.getElementById('title').textContent = dialog.shortTitle || dialog.title || 'Диалог';
      document.getElementById('subtitle').textContent =
        'Business: ' + (dialog.owner?.short || '') +
        ' · Chat ID: ' + (dialog.chat_id || '') +
        ' · сообщений: ' + (dialog.messages?.length || 0);

      const messages = (dialog.messages || []).filter(m => messageMatches(m, q));

      if (messages.length === 0) {
        root.innerHTML = '<div class="empty">Ничего не найдено</div>';
        return;
      }

      let html = '<div class="day"><span>Сегодня</span></div>';

      for (const m of messages) {
        const side = m.side === 'right' ? 'right' : 'left';
        const cls = 'row ' + side + (m.deleted ? ' deleted' : '');
        const author = esc(m.author || 'unknown');
        const time = esc(m.timeText || '');
        const media = mediaHtml(m);

        let content = '';

        if (m.reply) {
          content += '<div class="reply">' + esc(m.reply.author || '') + ': ' + esc(m.reply.text || '') + '</div>';
        }

        if (m.edited && m.old_text && m.old_text !== m.text) {
          content += '<span class="old">' + esc(m.old_text) + '</span>';
        }

        const shownText = m.text || m.plain || '';
        content += '<div class="text">' + textWithSearch(shownText, q) + '</div>';
        content += media;

        html +=
          '<div class="' + cls + '">' +
            '<div class="bubble">' +
              '<div class="author">' + author + '</div>' +
              content +
              '<div class="meta">' +
                '<span>ID:' + esc(m.id || '') + '</span>' +
                '<span>' + time + '</span>' +
                (m.edited ? '<span class="editedTag">изменено</span>' : '') +
                (m.deleted ? '<span>удалено</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
      }

      root.innerHTML = html;
      if (!q) {
        setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 0);
      }
    }

    async function load() {
      const res = await fetch(API_URL, { cache: 'no-store' });
      const data = await res.json();
      const hash = JSON.stringify(data);

      if (hash === lastHash) return;
      lastHash = hash;

      if (!data.ok) {
        document.getElementById('chat').innerHTML = '<div class="empty">Ошибка: ' + esc(data.error || 'unknown') + '</div>';
        return;
      }

      dialog = data.dialog;

      if (dialog) {
        const rk = 'read_at:' + (dialog.short_id || DIALOG_ID || SHORT_ID || dialog.id || '');
        localStorage.setItem(rk, String(dialog.updated_at || Date.now()));
      }

      render();
    }

    document.getElementById('search').addEventListener('input', render);

    load();
    setInterval(load, 3000);
  </script>
</body>
</html>`;
}

function setWebhookHelpPage(req) {
  const webhookUrl = `${originOf(req)}/webhook`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AllSaveModBot Render</title>
  <style>
    body{font-family:system-ui;background:#0d1b24;color:white;padding:24px}
    code{background:#182b38;padding:3px 6px;border-radius:6px}
    .box{max-width:760px;margin:auto;background:#132634;padding:20px;border-radius:18px}
  </style>
</head>
<body>
  <div class="box">
    <h2>AllSaveModBot Render работает ✅</h2>
    <p>Webhook URL:</p>
    <code>${escapeHtml(webhookUrl)}</code>
    <p>Список чатов:</p>
    <code>${escapeHtml(originOf(req))}/?key=${escapeHtml(VIEWER_KEY)}</code>
  </div>
</body>
</html>`;
}

app.get("/", (req, res) => {
  if (!checkViewerAccess(req)) {
    return html(res, setWebhookHelpPage(req));
  }

  return html(res, homePage(req));
});

app.get("/chat", (req, res) => {
  if (!checkViewerAccess(req)) return html(res, blockedPage(), 403);
  return html(res, chatPage(req));
});

app.get("/c", (req, res) => {
  if (!checkViewerAccess(req)) return html(res, blockedPage(), 403);
  return html(res, chatPage(req));
});

app.get("/api/chat", async (req, res) => {
  if (!checkViewerAccess(req)) return json(res, { ok: false, error: "Forbidden" }, 403);
  return handleApiChat(req, res);
});

app.get("/file", async (req, res) => {
  if (!checkViewerAccess(req)) return res.status(403).send("Forbidden");
  return handleFileProxy(req, res);
});

app.post("/webhook", async (req, res) => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];

  if (SECRET_TOKEN && secret !== SECRET_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  try {
    await handleTelegramUpdate(req, req.body);
    return json(res, { ok: true });
  } catch (e) {
    console.error("Webhook error:", e);

    await sendToOwnerOnly(
      "⚠️ <b>Ошибка Render Bot</b>\n\n<code>" + escapeHtml(String(e)) + "</code>"
    );

    return json(res, { ok: true, error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`AllSaveModBot Render running on port ${PORT}`);
  console.log(`DB path: ${DB_PATH}`);
});
