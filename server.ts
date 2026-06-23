import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import { google } from "googleapis";
import { Client as NotionClient } from "@notionhq/client";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import compression from "compression";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3002;

app.use(compression());

// ─── Token encryption (AES-256-GCM) ──────────────────────
// Key derived from API_SECRET; falls back to a random key if not set (tokens
// will be unreadable across restarts in that case — always set API_SECRET).
const ENC_KEY = crypto
  .createHash("sha256")
  .update(process.env.API_SECRET ?? crypto.randomBytes(32).toString("hex"))
  .digest(); // 32 bytes

function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptToken(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

// ─── CSRF state store (in-memory, 10-min TTL) ────────────
const oauthStates = new Map<string, number>();
const CSRF_TTL_MS = 10 * 60 * 1000;

function generateOAuthState(): string {
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, Date.now());
  return state;
}

function validateOAuthState(state: string): boolean {
  const ts = oauthStates.get(state);
  if (!ts) return false;
  oauthStates.delete(state);
  return Date.now() - ts < CSRF_TTL_MS;
}

// Trust nginx reverse proxy (needed for correct IP in rate limiter)
app.set("trust proxy", 1);

// ─── Security middleware ───────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-eval removed
      styleSrc:  ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:   ["'self'", "https://fonts.gstatic.com"],
      imgSrc:    ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.openai.com"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  crossOriginEmbedderPolicy: false,
}));

const isProd = process.env.NODE_ENV === "production";
const allowedOrigins: string[] = [
  process.env.CORS_ORIGIN ?? "https://ai-assistance-voice.marikkish.com",
  ...(!isProd ? ["http://localhost:3002", "http://127.0.0.1:3002"] : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));

// Rate limit expensive AI endpoints
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

// Rate limit auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Dashboard auth (cookie-based) ────────────────────────

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie ?? "";
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map(c => {
      const idx = c.indexOf("=");
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
}

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "";
const SESSION_TOKEN = DASHBOARD_PASSWORD
  ? crypto.createHmac("sha256", "voicemind_session_v1").update(DASHBOARD_PASSWORD).digest("hex")
  : "";

function requireDashboardAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!DASHBOARD_PASSWORD) return next();
  // These have their own Bearer-token (SHORTCUT_TOKEN) auth inside the handler.
  const PUBLIC_PATHS = ["/auth/login", "/shortcut", "/clarify", "/pending-clarifications", "/auth/google", "/morning-digest"];
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) return next();
  const cookies = parseCookies(req);
  if (cookies.vm_auth === SESSION_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

app.use("/api", requireDashboardAuth);

// ─── API key guard for sensitive write endpoints ───────────

function requireApiSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = process.env.API_SECRET;
  if (!secret) return next();

  const provided =
    req.headers["x-api-secret"] as string |undefined ??
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);

  if (provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── DB ───────────────────────────────────────────────────

const DB_FILE = path.join(process.cwd(), "db.json");

interface AISchema {
  type: "calendar_event" | "reminder" | "notion_note" | "task" | "unclear";
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  priority: "low" | "medium" | "high" | null;
  target_service: "google_calendar" | "notion" | "reminders" | "unclear";
  tags: string[];
  auto_save: boolean;
  needs_review: boolean;
  confidence: number;
}

interface Clarification {
  reason: "missing_datetime" | "ambiguous_type";
  question: string;
  tg_message_id?: number | null; // Telegram message id of the question (for reply linkage)
  attempts: number;
  resolved?: boolean;
}

interface Item {
  id: string;
  original_transcript: string;
  ai_parsed_result: AISchema;
  item_type: "calendar_event" | "reminder" | "notion_note" | "task" | "unclear";
  target_service: "google_calendar" | "notion" | "reminders" | "internal_tasks" | "unclear";
  external_service_id: string | null;
  status: "saved" | "error" | "needs_review" | "awaiting_clarification";
  confidence: number;
  error_message: string | null;
  clarification?: Clarification | null;
  created_at: string;
  updated_at: string;
}

interface Settings {
  google_calendar_connected: boolean;
  notion_connected: boolean;
  google_tasks_connected: boolean;
  notion_database_id: string;
  notion_token: string;
  auto_save_threshold: number;
  default_language: "ru" | "en" | "uk";
  mock_mode: boolean;
  morning_digest_enabled?: boolean;
  morning_digest_hour?: number;   // 0-23, local Kyiv time (default 8)
}

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
  scope?: string;
}

// In db.json, tokens are stored encrypted; at runtime they are plain objects.
interface Database {
  items: Item[];
  settings: Settings;
  simulated_calendar: any[];
  simulated_notion: any[];
  simulated_tasks: any[];
  google_tokens?: GoogleTokens;          // runtime (decrypted)
  _google_tokens_enc?: string;           // persisted (encrypted)
}

const DEFAULT_DB: Database = {
  items: [
    {
      id: "item_1",
      original_transcript: "Завтра в 15:00 встреча с дизайнером по сайту",
      ai_parsed_result: {
        type: "calendar_event",
        title: "Встреча с дизайнером по сайту",
        description: "Обсуждение макетов новой страницы сайта",
        date: "2026-06-15",
        start_time: "15:00",
        end_time: "16:00",
        duration_minutes: 60,
        priority: "high",
        target_service: "google_calendar",
        tags: ["сайт", "дизайн", "встреча"],
        auto_save: true,
        needs_review: false,
        confidence: 0.95,
      },
      item_type: "calendar_event",
      target_service: "google_calendar",
      external_service_id: "cal_evt_112233",
      status: "saved",
      confidence: 0.95,
      error_message: null,
      created_at: "2026-06-14T08:15:00Z",
      updated_at: "2026-06-14T08:15:05Z",
    },
    {
      id: "item_3",
      original_transcript: "Запиши идею: сделать отдельную страницу для клиентов B2B",
      ai_parsed_result: {
        type: "notion_note",
        title: "Страница для B2B клиентов",
        description: "Идея создания выделенного лендинга со специальными условиями и формой обратной связи для оптовых заказчиков.",
        date: null,
        start_time: null,
        end_time: null,
        duration_minutes: null,
        priority: "low",
        target_service: "notion",
        tags: ["идея", "сайт", "B2B"],
        auto_save: true,
        needs_review: false,
        confidence: 0.96,
      },
      item_type: "notion_note",
      target_service: "notion",
      external_service_id: null,
      status: "needs_review",
      confidence: 0.96,
      error_message: "Notion не настроен. Добавь токен в настройках.",
      created_at: "2026-06-14T08:45:00Z",
      updated_at: "2026-06-14T08:45:02Z",
    },
  ],
  settings: {
    google_calendar_connected: false,
    notion_connected: false,
    google_tasks_connected: false,
    notion_database_id: "",
    notion_token: "",
    auto_save_threshold: 0.85,
    default_language: "ru",
    mock_mode: false,
  },
  simulated_calendar: [],
  simulated_notion: [],
  simulated_tasks: [],
};

function getDb(): Database {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw: Database = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      // Decrypt tokens on read
      if (raw._google_tokens_enc) {
        try {
          raw.google_tokens = JSON.parse(decryptToken(raw._google_tokens_enc));
        } catch {
          console.error("Failed to decrypt google_tokens — clearing stored tokens");
          delete raw._google_tokens_enc;
        }
      }
      // Decrypt notion_token if stored encrypted (prefixed with "enc:")
      if (raw.settings.notion_token?.startsWith("enc:")) {
        try {
          raw.settings.notion_token = decryptToken(raw.settings.notion_token.slice(4));
        } catch {
          console.error("Failed to decrypt notion_token — clearing it");
          raw.settings.notion_token = "";
        }
      }
      return raw;
    }
  } catch {
    console.error("DB read failed, using defaults");
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), "utf-8");
  return DEFAULT_DB;
}

function saveDb(data: Database) {
  try {
    const toWrite: Database = { ...data };
    // Encrypt google_tokens before writing
    if (toWrite.google_tokens) {
      toWrite._google_tokens_enc = encryptToken(JSON.stringify(toWrite.google_tokens));
      delete (toWrite as any).google_tokens;
    } else {
      delete toWrite._google_tokens_enc;
    }
    // Encrypt notion_token before writing (only if non-empty and not already encrypted)
    if (toWrite.settings.notion_token && !toWrite.settings.notion_token.startsWith("enc:")) {
      toWrite.settings = {
        ...toWrite.settings,
        notion_token: "enc:" + encryptToken(toWrite.settings.notion_token),
      };
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(toWrite, null, 2), "utf-8");
  } catch (err) {
    console.error("DB save failed:", err);
  }
}

// ─── OpenAI ───────────────────────────────────────────────

let ai: OpenAI | null = null;
const api_key = process.env.OPENAI_API_KEY;
if (api_key && !api_key.startsWith("YOUR_")) {
  ai = new OpenAI({ apiKey: api_key });
  console.log("OpenAI initialized.");
}

// ─── Google OAuth ─────────────────────────────────────────

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

async function getAuthedClient(tokens: GoogleTokens, db: Database): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const client = createOAuthClient();
  client.setCredentials(tokens);

  // Refresh if expired or about to expire within 60 seconds
  if (tokens.expiry_date && tokens.expiry_date <= Date.now() + 60_000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      Object.assign(tokens, credentials);
      db.google_tokens = tokens;
      saveDb(db);
      client.setCredentials(tokens);
      console.log("[Auth] Google access token refreshed.");
    } catch (err: any) {
      console.error("[Auth] Token refresh failed:", err.message);
      // invalid_grant = refresh token is permanently dead (revoked/expired).
      // Flip connection flags to false and drop the dead token so the UI
      // stops claiming "Connected" and prompts a reconnect. Leave transient
      // failures (network blips) alone so a temporary glitch doesn't log out.
      const reason = err?.response?.data?.error ?? err?.message ?? "";
      if (String(reason).includes("invalid_grant")) {
        delete db.google_tokens;
        db.settings.google_calendar_connected = false;
        db.settings.google_tasks_connected = false;
        saveDb(db);
        console.warn("[Auth] invalid_grant — cleared Google tokens, marked disconnected.");
      }
      throw new Error("Google token expired and refresh failed. Please reconnect.");
    }
  }

  return client;
}

// ─── Notion ───────────────────────────────────────────────

function getNotionClient(token: string) {
  return new NotionClient({ auth: token });
}

// ─── Real integrations sync ───────────────────────────────

async function syncToRealServices(item: Item, db: Database): Promise<void> {
  if (item.status !== "saved") return;

  const parsed = item.ai_parsed_result;
  const isRealMode = !db.settings.mock_mode;

  // ── Google Calendar ────────────────────────────────────
  if (parsed.target_service === "google_calendar" && db.settings.google_calendar_connected) {
    if (isRealMode && db.google_tokens) {
      try {
        const auth = await getAuthedClient(db.google_tokens, db);
        const cal = google.calendar({ version: "v3", auth });

        const startDate = parsed.date ?? new Date().toISOString().split("T")[0];
        const startTime = parsed.start_time ?? "09:00";
        const endTime = parsed.end_time ?? `${String(parseInt(startTime.split(":")[0]) + 1).padStart(2, "0")}:00`;

        const event = await cal.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: parsed.title,
            description: `${parsed.description}\n\n[Создано через VoiceMind AI]`,
            start: { dateTime: `${startDate}T${startTime}:00`, timeZone: process.env.TZ || "Europe/Kyiv" },
            end:   { dateTime: `${startDate}T${endTime}:00`,   timeZone: process.env.TZ || "Europe/Kyiv" },
          },
        });

        item.external_service_id = event.data.id ?? null;
        console.log("Google Calendar event created:", event.data.id);
      } catch (err: any) {
        console.error("Google Calendar sync failed:", err.message);
        item.status = "error";
        item.error_message = `Google Calendar: ${err.message}`;
        return;
      }
    } else {
      // Mock fallback
      const id = `cal_${Date.now()}`;
      item.external_service_id = id;
      db.simulated_calendar.push({
        id,
        title: parsed.title,
        start: parsed.date ? `${parsed.date}T${parsed.start_time ?? "09:00"}:00` : new Date().toISOString(),
        end:   parsed.date ? `${parsed.date}T${parsed.end_time ?? "10:00"}:00`   : new Date().toISOString(),
        description: parsed.description,
        tags: parsed.tags,
      });
    }
  }

  // ── Google Tasks (Reminders) ───────────────────────────
  else if (parsed.target_service === "reminders" && db.settings.google_tasks_connected) {
    if (isRealMode && db.google_tokens) {
      try {
        const auth = await getAuthedClient(db.google_tokens, db);
        const tasks = google.tasks({ version: "v1", auth });

        // Get default task list
        const lists = await tasks.tasklists.list({ maxResults: 1 });
        const taskListId = lists.data.items?.[0]?.id ?? "@default";

        const task = await tasks.tasks.insert({
          tasklist: taskListId,
          requestBody: {
            title: parsed.title,
            notes: parsed.description,
            due: parsed.date ? `${parsed.date}T00:00:00.000Z` : undefined,
          },
        });

        item.external_service_id = task.data.id ?? null;
        console.log("Google Task created:", task.data.id);
      } catch (err: any) {
        console.error("Google Tasks sync failed:", err.message);
        item.status = "error";
        item.error_message = `Google Tasks: ${err.message}`;
        return;
      }
    } else {
      const id = `tsk_${Date.now()}`;
      item.external_service_id = id;
      db.simulated_tasks.push({
        id,
        title: parsed.title,
        due: parsed.date,
        completed: false,
        priority: parsed.priority ?? "medium",
        tags: parsed.tags,
      });
    }
  }


  // ── Notion ─────────────────────────────────────────────
  else if (parsed.target_service === "notion" && db.settings.notion_connected) {
    const token = db.settings.notion_token || process.env.NOTION_TOKEN;
    const dbId  = db.settings.notion_database_id;

    if (isRealMode && token && dbId) {
      try {
        const notion = getNotionClient(token);

        const page = await notion.pages.create({
          parent: { database_id: dbId },
          properties: {
            Name: {
              title: [{ text: { content: parsed.title } }],
            },
          },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "text", text: { content: parsed.description } }],
              },
            },
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: `🎙️ Оригинал: "${item.original_transcript}"` },
                    annotations: { italic: true, color: "gray" },
                  },
                ],
              },
            },
          ],
        } as any);

        item.external_service_id = (page as any).id ?? null;
        console.log("Notion page created:", (page as any).id);
      } catch (err: any) {
        console.error("Notion sync failed:", err.message);
        item.status = "error";
        item.error_message = `Notion: ${err.message}`;
        return;
      }
    } else if (token && dbId) {
      // Mock if mock_mode
      const id = `notion_${Date.now()}`;
      item.external_service_id = id;
      db.simulated_notion.push({
        id,
        title: parsed.title,
        content: parsed.description,
        tags: parsed.tags,
        created_at: new Date().toISOString(),
      });
    } else {
      item.status = "needs_review";
      item.error_message = "Notion не настроен: добавь токен и ID базы в настройках.";
    }
  }
}

// ─── Update existing item in external service ─────────────

async function updateInExternalService(item: Item, db: Database): Promise<void> {
  const extId = item.external_service_id;
  if (!extId || db.settings.mock_mode) return;

  const parsed = item.ai_parsed_result;
  const service = item.target_service;

  if (service === "google_calendar" && db.settings.google_calendar_connected && db.google_tokens) {
    try {
      const auth = await getAuthedClient(db.google_tokens, db);
      const cal = google.calendar({ version: "v3", auth });
      const startDate = parsed.date ?? new Date().toISOString().split("T")[0];
      const startTime = parsed.start_time ?? "09:00";
      const endTime   = parsed.end_time ?? `${String(parseInt(startTime.split(":")[0]) + 1).padStart(2, "0")}:00`;
      await cal.events.patch({
        calendarId: "primary",
        eventId: extId,
        requestBody: {
          summary:     parsed.title,
          description: parsed.description,
          start: { dateTime: `${startDate}T${startTime}:00`, timeZone: process.env.TZ || "Europe/Kyiv" },
          end:   { dateTime: `${startDate}T${endTime}:00`,   timeZone: process.env.TZ || "Europe/Kyiv" },
        },
      });
      console.log("[sync] Google Calendar event updated:", extId);
    } catch (err: any) {
      console.error("[sync] Google Calendar update failed:", err.message);
    }

  } else if (service === "reminders" && db.settings.google_tasks_connected && db.google_tokens) {
    try {
      const auth = await getAuthedClient(db.google_tokens, db);
      const tasks = google.tasks({ version: "v1", auth });
      const lists = await tasks.tasklists.list({ maxResults: 1 });
      const listId = lists.data.items?.[0]?.id ?? "@default";
      await tasks.tasks.patch({
        tasklist: listId,
        task: extId,
        requestBody: {
          title:  parsed.title,
          notes:  parsed.description,
          due:    parsed.date ? `${parsed.date}T00:00:00.000Z` : undefined,
          status: (parsed as any).completed ? "completed" : "needsAction",
        },
      });
      console.log("[sync] Google Task updated:", extId);
    } catch (err: any) {
      console.error("[sync] Google Tasks update failed:", err.message);
    }

  } else if (service === "notion" && db.settings.notion_connected) {
    const token = db.settings.notion_token || process.env.NOTION_TOKEN;
    if (!token) return;
    try {
      const notion = getNotionClient(token);
      await notion.pages.update({
        page_id: extId,
        properties: {
          Name: { title: [{ text: { content: parsed.title } }] },
        },
      } as any);
      console.log("[sync] Notion page updated:", extId);
    } catch (err: any) {
      console.error("[sync] Notion update failed:", err.message);
    }
  }
}

// ─── AI fallback parser ────────────────────────────────────

function fallbackParseTranscript(transcript: string, _locale: string): AISchema {
  const norm = transcript.toLowerCase();
  let type: AISchema["type"] = "unclear";
  let target_service: AISchema["target_service"] = "unclear";
  let title = transcript;
  let description = `Зафиксировано: "${transcript}"`;
  let date: string | null = null;
  let start_time: string | null = null;
  let end_time: string | null = null;
  let duration_minutes: number | null = null;
  let priority: AISchema["priority"] = "medium";
  let tags: string[] = ["голос"];

  const now = new Date();
  const addDays = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r.toISOString().split("T")[0];
  };

  if (norm.includes("завтра") || norm.includes("tomorrow"))    date = addDays(now, 1);
  else if (norm.includes("пятниц") || norm.includes("friday")) date = addDays(now, (5 - now.getDay() + 7) % 7 || 7);
  else if (norm.includes("понедельник") || norm.includes("monday")) date = addDays(now, (1 - now.getDay() + 7) % 7 || 7);

  const timeMatch = norm.match(/(\d{1,2})[:\s](\d{2})?/);
  if (timeMatch) {
    const h = String(parseInt(timeMatch[1])).padStart(2, "0");
    const m = timeMatch[2] ? String(parseInt(timeMatch[2])).padStart(2, "0") : "00";
    start_time = `${h}:${m}`;
  }

  if (norm.includes("созвон") || norm.includes("встреч") || norm.includes("meeting") || (date && start_time)) {
    type = "calendar_event"; target_service = "google_calendar"; duration_minutes = 60; tags.push("встреча");
    title = transcript.replace(/(встреча|созвон|завтра|в \d+:\d+)/gi, "").trim() || "Новое событие";
  } else if (norm.includes("идея") || norm.includes("запиши") || norm.includes("заметка") || norm.includes("note") || norm.includes("idea")) {
    type = "notion_note"; target_service = "notion"; tags.push("идея");
    title = transcript.replace(/(запиши идею?|заметка|idea|note)/gi, "").trim() || "Новая идея";
  } else if (norm.includes("напомни") || norm.includes("remind")) {
    type = "reminder"; target_service = "google_calendar"; tags.push("напоминание");
    title = transcript.replace(/(напомни мне?|remind me?)/gi, "").trim() || "Напоминание";
    if (!start_time) start_time = "09:00"; // default 9 AM if no time specified
  } else {
    type = "task"; target_service = "reminders"; tags.push("задача");
    title = transcript.replace(/(сделать|надо|купить|хочу)/gi, "").trim() || transcript;
    priority = norm.includes("срочно") || norm.includes("важно") ? "high" : "medium";
  }

  title = title.charAt(0).toUpperCase() + title.slice(1);
  title = title.substring(0, 80);

  const confidence = !date && type === "calendar_event" ? 0.65 : 0.88;

  return {
    type, title, description, date, start_time, end_time, duration_minutes,
    priority, target_service, tags: Array.from(new Set(tags)),
    auto_save: confidence >= 0.85,
    needs_review: confidence < 0.85,
    confidence,
  };
}

// ─── Telegram push (server-side question delivery) ─────────
// The dedicated voice-input bot owns long-polling, but the server sends
// clarification questions directly so that items captured anywhere (app,
// shortcut, Telegram) all surface their question in the same Telegram chat.

const TG_BOT_TOKEN = process.env.TELEGRAM_IVOICE_BOT_TOKEN;
const TG_CHAT_ID = String(process.env.IVOICE_ALLOWED_CHAT_ID || "").trim();

async function sendTelegram(text: string, replyTo?: number | null): Promise<number | null> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.warn("[clarify] Telegram not configured; cannot push question");
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        reply_to_message_id: replyTo ?? undefined,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error("[clarify] Telegram sendMessage failed:", JSON.stringify(data));
      return null;
    }
    return data.result?.message_id ?? null;
  } catch (err: any) {
    console.error("[clarify] Telegram send error:", err.message);
    return null;
  }
}

// ─── Shared parse + routing helpers ────────────────────────

const SHORTCUT_PARSE_PROMPT = (transcript: string, language: string, today: string) => `You are an AI command router. Analyze this spoken transcript and return JSON.

TRANSCRIPT: "${transcript.replace(/"/g, "'")}"
TODAY: ${today}. Language: ${language} (ru=Russian, uk=Ukrainian, en=English). Generate title/description in the same language as the transcript.

RULES:
1. calendar_event → scheduled meeting/call/event → target_service: google_calendar. Needs both date AND start_time; leave them null if not stated (do NOT invent them).
2. reminder → "remind me", "напомни", "нагадай" → target_service: google_calendar. Needs a date; leave date/start_time null if not stated.
3. notion_note → idea, thought, note, concept → target_service: notion
4. task → todo without specific time: buy, do, make, clean, call (e.g. "купить корм коту") → target_service: reminders
5. unclear → genuinely ambiguous between the above → target_service: unclear

Return ONLY valid JSON:
{
  "type": "calendar_event|reminder|notion_note|task|unclear",
  "title": "short readable title",
  "description": "expanded description",
  "date": "YYYY-MM-DD or null",
  "start_time": "HH:mm or null",
  "end_time": "HH:mm or null",
  "duration_minutes": number or null,
  "priority": "low|medium|high|null",
  "target_service": "google_calendar|notion|reminders|unclear",
  "tags": ["tag1"],
  "auto_save": true,
  "needs_review": false,
  "confidence": 0.0-1.0
}`;

async function aiParse(transcript: string, language: string, db: Database): Promise<AISchema> {
  const threshold = db.settings.auto_save_threshold || 0.85;
  let parsed: AISchema;
  if (ai) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only valid JSON. No other text." },
          { role: "user", content: SHORTCUT_PARSE_PROMPT(transcript, language, today) },
        ],
      });
      parsed = JSON.parse(response.choices[0].message.content?.trim() ?? "{}");
    } catch {
      parsed = fallbackParseTranscript(transcript, language);
    }
  } else {
    parsed = fallbackParseTranscript(transcript, language);
  }
  if (typeof parsed.confidence !== "number") parsed.confidence = 0.8;
  if (parsed.confidence < threshold) {
    parsed.auto_save = false;
    parsed.needs_review = true;
  }
  // Drop a date/time the model invented but the user never said — otherwise the
  // clarification gate thinks the calendar item is complete and never asks.
  if (parsed.target_service === "google_calendar") {
    if (parsed.date && !mentionsDate(transcript)) parsed.date = null;
    if (parsed.start_time && !mentionsTime(transcript)) parsed.start_time = null;
  }
  return parsed;
}

// Deterministic relative date/time parser for short clarification answers.
// Date arithmetic must not be left to the LLM (gpt-4o-mini mis-resolves
// "завтра"); we resolve common ru/uk/en words in code against today.
function parseRelativeDateTime(answer: string): { date: string | null; start_time: string | null } {
  const norm = answer.toLowerCase().trim();
  const now = new Date();
  const addDays = (n: number) => {
    const r = new Date(now);
    r.setDate(r.getDate() + n);
    return r.toISOString().split("T")[0];
  };

  // NOTE: no \b word boundaries — in JS \b is ASCII-only and never matches
  // around Cyrillic, so plain substring tests are used for ru/uk words.
  let date: string | null = null;
  const iso = norm.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dm = norm.match(/(?<!\d)(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?!\d)/);
  if (iso) {
    date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  } else if (/послезавтра|післязавтра|day after tomorrow/.test(norm)) {
    date = addDays(2);
  } else if (/завтра|tomorrow/.test(norm)) {
    date = addDays(1);
  } else if (/сегодня|сьогодні|today/.test(norm)) {
    date = addDays(0);
  } else if (dm && parseInt(dm[2]) <= 12) {
    const d = String(parseInt(dm[1])).padStart(2, "0");
    const m = String(parseInt(dm[2])).padStart(2, "0");
    const y = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : String(now.getFullYear());
    date = `${y}-${m}-${d}`;
  } else {
    const WD: Array<[RegExp, number]> = [
      [/понедельник|понеділок|monday/, 1],
      [/вторник|вівторок|tuesday/, 2],
      [/сред|серед|wednesday/, 3],
      [/четверг|четвер|thursday/, 4],
      [/пятниц|п.?ятниц|friday/, 5],
      [/суббот|субот|saturday/, 6],
      [/воскресень|неділ|sunday/, 0],
    ];
    for (const [re, target] of WD) {
      if (re.test(norm)) { date = addDays((target - now.getDay() + 7) % 7 || 7); break; }
    }
  }

  // Time: prefer "HH:MM", then "в/о HH[:MM]", then verbal words, then a bare hour.
  // Colon-only for the no-prefix case so a dotted date ("20.06") is never read as a time.
  let start_time: string | null = null;
  const colon = norm.match(/(\d{1,2}):(\d{2})/);
  // "в 16-00" / "о 16-00" (dash-separated)
  const dashtime = norm.match(/(?:в|о|об|at)\s*(\d{1,2})-(\d{2})(?!\d)/);
  const prefixed = norm.match(/(?:в|о|об|at)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  const bare = norm.match(/^\D*?(\d{1,2})(?:[:.](\d{2}))?\s*(?:час|годин|h)?\D*$/);
  const set = (h: number, m: number) => {
    if (h < 24 && m < 60) start_time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  if (colon) set(parseInt(colon[1]), parseInt(colon[2]));
  else if (dashtime) set(parseInt(dashtime[1]), parseInt(dashtime[2]));
  else if (/утром|вранці|ранком|morning/.test(norm)) set(9, 0);
  else if (/полдень|полудн|опівдень|noon|в обед|в обіді/.test(norm)) set(12, 0);
  else if (/обед|обід|lunch/.test(norm)) set(13, 0);
  else if (/вечер|ввечері|evening/.test(norm)) set(19, 0);
  else if (/ноч|вночі|night/.test(norm)) set(22, 0);
  else if (prefixed) set(parseInt(prefixed[1]), prefixed[2] ? parseInt(prefixed[2]) : 0);
  else if (bare) set(parseInt(bare[1]), bare[2] ? parseInt(bare[2]) : 0);

  return { date, start_time };
}

// Cue detectors — does the text actually mention a date / a time? Used to
// discard a date/time the LLM hallucinated when the user never stated one
// (gpt-4o-mini tends to fill today's date for date-less events).
function mentionsDate(text: string): boolean {
  const n = text.toLowerCase();
  return /\d{1,2}[.\/]\d{1,2}|\d{4}-\d{2}-\d{2}|сегодня|сьогодні|today|завтра|tomorrow|послезавтра|післязавтра|понедельник|понеділок|вторник|вівторок|сред|серед|четверг|четвер|пятниц|п.?ятниц|суббот|субот|воскресень|неділ|monday|tuesday|wednesday|thursday|friday|saturday|sunday|январ|феврал|март|апрел|\bма[яй]\b|июн|июл|август|сентябр|октябр|ноябр|декабр|січн|лют|березн|квітн|травн|червн|липн|серпн|вересн|жовтн|листопад|груд|через|числа/.test(n);
}
function mentionsTime(text: string): boolean {
  const n = text.toLowerCase();
  return /\d{1,2}:\d{2}|(?:в|о|об|до|к|к)\s*\d{1,2}(\D|$)|утра|вечер|дня|ноч|обед|обід|полдень|полудн|полноч|опівн|ранку|дин/.test(n);
}

// Targeted extraction of a date/time from a short clarification answer.
// Tries the deterministic parser first; falls back to the LLM only for
// phrasings the regex parser can't handle (e.g. "через неделю", "в обед").
async function extractDateTime(
  context: string, answer: string, language: string
): Promise<{ date: string | null; start_time: string | null; end_time: string | null }> {
  const local = parseRelativeDateTime(answer);
  if (local.date && local.start_time) {
    return { date: local.date, start_time: local.start_time, end_time: null };
  }

  const today = new Date().toISOString().split("T")[0];
  const empty = { date: local.date, start_time: local.start_time, end_time: null };
  if (!ai) return empty;
  try {
    const prompt = `TODAY is ${today}. Language: ${language}.
An event: "${context.replace(/"/g, "'")}".
The user was asked for its DATE and TIME and answered: "${answer.replace(/"/g, "'")}".
Resolve relative words (сегодня/today, завтра/tomorrow, послезавтра, в понедельник, etc.) against TODAY.
Return ONLY JSON: {"date":"YYYY-MM-DD or null","start_time":"HH:mm or null","end_time":"HH:mm or null"}`;
    const r = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON. No other text." },
        { role: "user", content: prompt },
      ],
    });
    const out = JSON.parse(r.choices[0].message.content?.trim() ?? "{}");
    // Prefer the deterministic parse where it succeeded.
    return {
      date: local.date || out.date || null,
      start_time: local.start_time || out.start_time || null,
      end_time: out.end_time || null,
    };
  } catch {
    return empty;
  }
}

// Targeted classification when the type was ambiguous, given the user's answer.
async function classifyType(
  transcript: string, answer: string, language: string
): Promise<{ type: AISchema["type"]; target_service: AISchema["target_service"] } | null> {
  if (!ai) return null;
  try {
    const prompt = `Language: ${language}.
Item: "${transcript.replace(/"/g, "'")}".
The user was asked whether this is a задача/task, событие/calendar event, or заметка/note, and answered: "${answer.replace(/"/g, "'")}".
Map the answer:
- task/задача/таск → {"type":"task","target_service":"reminders"}
- calendar/событие/встреча/в календарь → {"type":"calendar_event","target_service":"google_calendar"}
- note/заметка/нотатка/идея → {"type":"notion_note","target_service":"notion"}
Return ONLY that JSON for the chosen category.`;
    const r = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON. No other text." },
        { role: "user", content: prompt },
      ],
    });
    const out = JSON.parse(r.choices[0].message.content?.trim() ?? "{}");
    if (!out.type || !out.target_service) return null;
    return { type: out.type, target_service: out.target_service };
  } catch {
    return null;
  }
}

// Decide whether an item must be clarified before saving.
// Rule (updated 2026-06-18):
//  - calendar_event needs date + time (a meeting without a time is meaningless).
//  - reminder needs only date — time is optional (user said "remind me tomorrow", that's enough).
//  - genuinely unclear type → ask "task / event / note?".
//  - tasks and notes never block.
function clarificationNeeded(parsed: AISchema, lang: "en" | "uk" = "uk"): Clarification | null {
  const isCalendar = parsed.target_service === "google_calendar";
  const isUnclear = parsed.target_service === "unclear" || parsed.type === "unclear";
  const isReminder = parsed.type === "reminder";

  if (isCalendar) {
    const missingDate = !parsed.date;
    const missingTime = !isReminder && !parsed.start_time;
    if (missingDate || missingTime) {
      const question = lang === "en"
        ? isReminder
          ? `🗓️ "${parsed.title}" → calendar. What date? (e.g. "tomorrow", "June 25")`
          : `🗓️ "${parsed.title}" → calendar. What ${missingDate && missingTime ? "date and time" : missingDate ? "date" : "time"}? (e.g. "tomorrow at 3pm")`
        : isReminder
          ? `🗓️ «${parsed.title}» → календар. Уточни дату (наприклад: «завтра», «25 червня»).`
          : `🗓️ «${parsed.title}» → календар. Уточни ${missingDate && missingTime ? "дату і час" : missingDate ? "дату" : "час"} (наприклад: «завтра о 15:00»).`;
      return { reason: "missing_datetime", question, attempts: 1 };
    }
  } else if (isUnclear) {
    const question = lang === "en"
      ? `🤔 "${parsed.title}" — is this a task, a calendar event, or a note? Reply with one word.`
      : `🤔 «${parsed.title}» — це задача, подія (в календар) або нотатка? Відповідь одним словом.`;
    return { reason: "ambiguous_type", question, attempts: 1 };
  }
  return null;
}

function buildItem(parsed: AISchema, transcript: string): Item {
  return {
    id: `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    original_transcript: transcript,
    ai_parsed_result: parsed,
    item_type: parsed.type,
    target_service: parsed.target_service,
    external_service_id: null,
    status: "needs_review",
    confidence: parsed.confidence,
    error_message: null,
    clarification: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Decide saved-vs-needs_review, then sync.
// By the time we reach here, clarificationNeeded() has already returned null —
// i.e. the item is actionable (a task, a note, or a calendar item with date+time).
// So we save it regardless of confidence (low confidence must NOT block a note/
// task — user rule 2026-06-18). needs_review is reserved for "service not
// connected" and the residual unclear case.
async function finalizeItem(item: Item, db: Database): Promise<void> {
  const parsed = item.ai_parsed_result;
  const service = parsed.target_service;
  const isConnected =
    (service === "google_calendar" && db.settings.google_calendar_connected) ||
    (service === "notion"          && db.settings.notion_connected) ||
    (service === "reminders"       && db.settings.google_tasks_connected);

  if (service === "unclear") {
    item.status = "needs_review";
  } else if (isConnected) {
    item.status = "saved";
    await syncToRealServices(item, db);
  } else {
    item.status = "needs_review";
    item.error_message = `Сервис не подключён (${service}).`;
  }
  item.updated_at = new Date().toISOString();
}

// Compact human label for a finalized item (used in Telegram confirmations).
// Detect response language from transcript: English if >60% of word-chars are ASCII letters.
function detectLang(text: string): "en" | "uk" {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐёЁ]/g, "");
  if (!letters) return "uk";
  const ascii = letters.replace(/[^a-zA-Z]/g, "").length;
  return ascii / letters.length > 0.6 ? "en" : "uk";
}

function finalizeLabel(item: Item, lang: "en" | "uk" = "uk"): string {
  const SVC: Record<string, string> = {
    google_calendar: "📅 Calendar",
    notion: "📝 Notion",
    reminders: "✅ Tasks",
  };
  const svc = SVC[item.target_service] || item.target_service;
  if (item.status === "saved")
    return lang === "en"
      ? `✅ Saved: "${item.ai_parsed_result.title}" → ${svc}`
      : `✅ Збережено: «${item.ai_parsed_result.title}» → ${svc}`;
  if (item.status === "needs_review")
    return lang === "en"
      ? `📥 "${item.ai_parsed_result.title}" → needs review${item.error_message ? ` (${item.error_message})` : ""}`
      : `📥 «${item.ai_parsed_result.title}» → потребує уточнення${item.error_message ? ` (${item.error_message})` : ""}`;
  return `«${item.ai_parsed_result.title}» → ${item.status}`;
}

// ─── Routes ───────────────────────────────────────────────

// 1. Items list
app.get("/api/items", (_req, res) => {
  res.json(getDb().items);
});

// 2. Reset DB (protected)
app.post("/api/items/reset", requireApiSecret, (_req, res) => {
  saveDb(DEFAULT_DB);
  res.json({ success: true });
});

// 3. Analyze transcript (AI core)
// ── /api/analyze — parse only, do NOT save ────────────────────
app.post("/api/analyze", aiLimiter, async (req, res) => {
  const { transcript, language } = req.body;
  if (!transcript || typeof transcript !== "string") {
    return res.status(400).json({ error: "Transcript is required" });
  }
  if (transcript.length > 2000) {
    return res.status(400).json({ error: "Transcript too long (max 2000 chars)" });
  }

  const lang = language ?? "uk";
  let parsedItems: AISchema[];

  if (ai) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const prompt = `You are an AI command router. The user spoke ONE message that may contain MULTIPLE separate intents (e.g. "tomorrow meeting with Andrii, buy coffee, and save idea about voice reminders").

Split the transcript into individual items — one per intent. Return ALL of them.

TRANSCRIPT: "${transcript.replace(/"/g, "'")}"
TODAY: ${today}. Detect the language from the transcript and generate titles/descriptions in THAT language.

CLASSIFICATION RULES:
1. calendar_event → meeting/call/event with date+time → target_service: google_calendar
2. reminder → "нагадай", "remind me", "нагадати" → target_service: google_calendar. If no time given, set start_time "09:00".
3. notion_note → idea, thought, note, concept → target_service: notion
4. task → todo, buy, do, make, pay (without specific time) → target_service: reminders
5. unclear → truly ambiguous → target_service: unclear

Return ONLY valid JSON — no extra text:
{"items": [
  {
    "type": "calendar_event|reminder|notion_note|task|unclear",
    "title": "short readable title in transcript language",
    "description": "one-sentence description",
    "date": "YYYY-MM-DD or null",
    "start_time": "HH:mm or null",
    "end_time": "HH:mm or null",
    "duration_minutes": number or null,
    "priority": "low|medium|high",
    "target_service": "google_calendar|notion|reminders|unclear",
    "tags": ["tag1"],
    "confidence": 0.0
  }
]}`;

      const response = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Return only valid JSON with an "items" array. No other text.' },
          { role: "user", content: prompt },
        ],
      });

      const json = JSON.parse(response.choices[0].message.content?.trim() ?? "{}");
      if (Array.isArray(json.items) && json.items.length > 0) {
        parsedItems = json.items;
      } else if (json.type) {
        // Old single-item format fallback
        parsedItems = [json as AISchema];
      } else {
        parsedItems = [fallbackParseTranscript(transcript, lang)];
      }
    } catch (err) {
      console.error("OpenAI failed, using fallback:", err);
      parsedItems = [fallbackParseTranscript(transcript, lang)];
    }
  } else {
    parsedItems = [fallbackParseTranscript(transcript, lang)];
  }

  // Normalise — ensure required fields exist
  parsedItems = parsedItems.map(p => ({
    ...p,
    auto_save: true,
    needs_review: false,
    confidence: p.confidence ?? 0.85,
  }));

  return res.json({ items: parsedItems, transcript });
});

// ── /api/items/batch — save a list of pre-parsed items ────────
app.post("/api/items/batch", aiLimiter, async (req, res) => {
  const { transcript, items: parsedItems } = req.body as {
    transcript?: string;
    items: AISchema[];
  };

  if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }

  const db = getDb();
  const threshold = db.settings.auto_save_threshold || 0.85;
  const savedItems: Item[] = [];

  for (let i = 0; i < parsedItems.length; i++) {
    const parsed = parsedItems[i];
    const conf = parsed.confidence ?? 0.85;

    const newItem: Item = {
      id: `item_${Date.now()}_${i}`,
      original_transcript: transcript || "",
      ai_parsed_result: { ...parsed, auto_save: true, needs_review: conf < threshold },
      item_type: parsed.type,
      target_service: parsed.target_service,
      external_service_id: null,
      status: "needs_review",
      confidence: conf,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const svc = parsed.target_service;
    const isConnected =
      (svc === "google_calendar" && db.settings.google_calendar_connected) ||
      (svc === "notion"          && db.settings.notion_connected)           ||
      (svc === "reminders"       && db.settings.google_tasks_connected);

    if (conf >= threshold && isConnected) {
      newItem.status = "saved";
      await syncToRealServices(newItem, db);
    } else if (!isConnected && svc !== "unclear") {
      newItem.status = "needs_review";
      newItem.error_message = `Сервіс не підключено (${svc}). Підключи у налаштуваннях.`;
    } else {
      newItem.status = "needs_review";
      newItem.error_message = "Низька впевненість AI або неповні дані.";
    }

    db.items.unshift(newItem);
    savedItems.push(newItem);
  }

  saveDb(db);
  return res.json({ items: savedItems });
});

// 4. Update item
app.put("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const idx = db.items.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const allowed = ["original_transcript", "ai_parsed_result", "item_type",
    "target_service", "status", "error_message"] as const;
  const update: any = {};
  for (const key of allowed) {
    if (key in req.body) update[key] = req.body[key];
  }

  db.items[idx] = { ...db.items[idx], ...update, updated_at: new Date().toISOString() };
  saveDb(db);

  // Best-effort: push changes to external service (non-blocking)
  updateInExternalService(db.items[idx], db).catch(e =>
    console.error("[put] updateInExternalService error:", e.message)
  );

  res.json(db.items[idx]);
});

// 5. Delete item
app.delete("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const idx = db.items.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const item = db.items[idx];
  const extId = item.external_service_id;
  const service = item.target_service;

  db.items.splice(idx, 1);
  if (extId) {
    db.simulated_calendar = db.simulated_calendar.filter(e => e.id !== extId);
    db.simulated_notion   = db.simulated_notion.filter(e => e.id !== extId);
    db.simulated_tasks    = db.simulated_tasks.filter(e => e.id !== extId);
  }
  saveDb(db);

  // Also delete from real external services
  if (extId && !db.settings.mock_mode) {
    try {
      if ((service === "google_calendar" || service === "reminders") && db.google_tokens) {
        const auth = await getAuthedClient(db.google_tokens, db);
        if (service === "google_calendar") {
          const cal = google.calendar({ version: "v3", auth });
          await cal.events.delete({ calendarId: "primary", eventId: extId });
          console.log("[delete] Google Calendar event deleted:", extId);
        } else {
          const tasks = google.tasks({ version: "v1", auth });
          const lists = await tasks.tasklists.list({ maxResults: 1 });
          const listId = lists.data.items?.[0]?.id ?? "@default";
          await tasks.tasks.delete({ tasklist: listId, task: extId });
          console.log("[delete] Google Task deleted:", extId);
        }
      } else if (service === "notion" && db.settings.notion_connected) {
        const token = db.settings.notion_token || process.env.NOTION_TOKEN;
        if (token) {
          const notion = getNotionClient(token);
          await notion.pages.update({ page_id: extId, archived: true } as any);
          console.log("[delete] Notion page archived:", extId);
        }
      }
    } catch (err: any) {
      console.error("[delete] External delete failed:", err.message);
    }
  }

  res.json({ success: true });
});

// 6. Force sync item
app.post("/api/items/:id/sync", async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const item = db.items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: "Not found" });

  const service = item.ai_parsed_result.target_service;
  if (service === "unclear") {
    return res.status(400).json({ error: "Cannot sync: target service is unclear" });
  }

  // Remove from simulated stores before re-sync
  if (item.external_service_id) {
    db.simulated_calendar = db.simulated_calendar.filter(e => e.id !== item.external_service_id);
    db.simulated_notion   = db.simulated_notion.filter(e => e.id !== item.external_service_id);
    db.simulated_tasks    = db.simulated_tasks.filter(e => e.id !== item.external_service_id);
    item.external_service_id = null;
  }

  item.status = "saved";
  item.error_message = null;
  await syncToRealServices(item, db);

  saveDb(db);
  res.json({ success: item.status === "saved", item });
});

// 7. Settings
app.get("/api/settings", (_req, res) => {
  const db = getDb();
  res.json(db.settings);
});

app.post("/api/settings", (req, res) => {
  const db = getDb();
  const allowed = ["notion_token", "notion_database_id", "auto_save_threshold",
    "default_language", "mock_mode"] as const;
  for (const key of allowed) {
    if (key in req.body) (db.settings as any)[key] = req.body[key];
  }
  // Extract pure Notion database ID from URL or "PageName-{id}" format
  if (db.settings.notion_database_id) {
    const raw = db.settings.notion_database_id;
    const match = raw.match(/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i)
      ?? raw.match(/([a-f0-9]{32})/i);
    if (match) db.settings.notion_database_id = match[1];
  }
  // notion_connected depends on token presence
  if (db.settings.notion_token && db.settings.notion_database_id) {
    db.settings.notion_connected = true;
  }
  saveDb(db);
  res.json(db.settings);
});

// 8. Transcribe audio via Whisper
app.post("/api/transcribe", aiLimiter, async (req, res) => {
  const { audio, language } = req.body;
  if (!audio || typeof audio !== "string") {
    return res.status(400).json({ error: "No audio data" });
  }
  if (audio.length > 8 * 1024 * 1024) {
    return res.status(400).json({ error: "Audio too large" });
  }
  if (!ai) return res.status(503).json({ error: "OpenAI not configured" });

  try {
    const buffer = Buffer.from(audio, "base64");
    const file = new File([buffer], "recording.webm", { type: "audio/webm" });
    const transcription = await ai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: (["ru", "en", "uk"] as const).includes(language) ? language : "en",
    });
    res.json({ transcript: transcription.text });
  } catch (err) {
    console.error("Whisper error:", err);
    res.status(500).json({ error: "Transcription failed" });
  }
});

// 9. Apple Shortcuts endpoint — transcribe + analyze in one call
// Auth: Bearer token matching SHORTCUT_TOKEN env var (or API_SECRET as fallback)
app.post("/api/shortcut", aiLimiter, async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.body.token;
  const validToken = process.env.SHORTCUT_TOKEN || process.env.API_SECRET;

  if (!validToken || token !== validToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { audio, language, text } = req.body;
  // null means "auto-detect"; undefined/missing falls back to "uk"
  const effectiveLang: "ru" | "en" | "uk" | null =
    language === null ? null :
    (["ru", "en", "uk"] as const).includes(language) ? language : "uk";

  let transcript: string | null = null;

  // Accept either pre-typed text or base64 audio
  if (text && typeof text === "string") {
    transcript = text.trim();
  } else if (audio && typeof audio === "string") {
    if (audio.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "Audio too large" });
    }
    if (!ai) return res.status(503).json({ error: "OpenAI not configured" });
    try {
      const buffer = Buffer.from(audio, "base64");
      // iPhone Shortcuts records as m4a
      const file = new File([buffer], "recording.m4a", { type: "audio/mp4" });
      const result = await ai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        // effectiveLang === null → no hint, Whisper auto-detects language
        ...(effectiveLang ? { language: effectiveLang } : {}),
      });
      transcript = result.text?.trim() ?? null;
    } catch (err) {
      console.error("Shortcut Whisper error:", err);
      return res.status(500).json({ error: "Transcription failed" });
    }
  }

  if (!transcript) {
    return res.status(400).json({ error: "No audio or text provided" });
  }

  // Parse, then decide: clarify (calendar w/o date+time, or ambiguous) vs save now.
  const db = getDb();
  const responseLang = detectLang(transcript);
  const parsed = await aiParse(transcript, effectiveLang ?? responseLang, db);
  const newItem = buildItem(parsed, transcript);

  const clar = clarificationNeeded(parsed, responseLang);
  if (clar) {
    newItem.status = "awaiting_clarification";
    newItem.clarification = clar;
    db.items.unshift(newItem);
    saveDb(db);

    const tgId = await sendTelegram(clar.question);
    if (tgId) {
      newItem.clarification.tg_message_id = tgId;
      saveDb(db);
    }

    return res.json({
      ok: true,
      item_id: newItem.id,
      title: parsed.title,
      service: parsed.target_service,
      status: "awaiting_clarification",
      clarification: { reason: clar.reason, question: clar.question },
      transcript,
      response_lang: responseLang,
    });
  }

  await finalizeItem(newItem, db);
  db.items.unshift(newItem);
  saveDb(db);

  return res.json({
    ok: true,
    item_id: newItem.id,
    title: parsed.title,
    service: parsed.target_service,
    status: newItem.status,
    error_message: newItem.error_message,
    transcript,
    response_lang: responseLang,
    label: finalizeLabel(newItem, responseLang),
  });
});

// 9b. Clarify an awaiting item (answer to a clarification question).
// Body: { item_id?, tg_message_id?, answer?, audio?, language? }
// Resolves by re-parsing original_transcript + answer, then either finalizes
// or (bounded) re-asks. Auth: same shortcut token as /api/shortcut.
app.post("/api/clarify", aiLimiter, async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.body.token;
  const validToken = process.env.SHORTCUT_TOKEN || process.env.API_SECRET;
  if (!validToken || token !== validToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { item_id, tg_message_id, language = "uk" } = req.body;
  let answer: string | null = typeof req.body.answer === "string" ? req.body.answer.trim()
    : typeof req.body.text === "string" ? req.body.text.trim() : null;

  // Allow a voice answer too.
  if (!answer && req.body.audio && typeof req.body.audio === "string") {
    if (!ai) return res.status(503).json({ error: "OpenAI not configured" });
    try {
      const buffer = Buffer.from(req.body.audio, "base64");
      const file = new File([buffer], "recording.m4a", { type: "audio/mp4" });
      const result = await ai.audio.transcriptions.create({
        file, model: "whisper-1",
        language: (["ru", "en", "uk"] as const).includes(language as any) ? language as "ru" | "en" | "uk" : "uk",
      });
      answer = result.text?.trim() ?? null;
    } catch (err) {
      console.error("Clarify Whisper error:", err);
      return res.status(500).json({ error: "Transcription failed" });
    }
  }

  if (!answer) return res.status(400).json({ error: "No answer provided" });

  const db = getDb();
  const item = db.items.find((it) =>
    (item_id && it.id === item_id) ||
    (tg_message_id != null && it.clarification?.tg_message_id === Number(tg_message_id))
  );

  if (!item) {
    // No matching open question — let the caller treat this as a fresh capture.
    return res.json({ ok: false, not_found: true });
  }
  if (item.status !== "awaiting_clarification" || !item.clarification) {
    return res.json({ ok: false, already_resolved: true, status: item.status });
  }

  // Resolve the specific gap (targeted), not a full re-parse — keeps title/type.
  const parsed = item.ai_parsed_result;
  const prevReason = item.clarification.reason;

  if (prevReason === "ambiguous_type") {
    const c = await classifyType(item.original_transcript, answer, language ?? "uk");
    if (c) {
      parsed.type = c.type;
      parsed.target_service = c.target_service;
    }
  } else if (prevReason === "missing_datetime") {
    const context = `${item.original_transcript} (${parsed.title})`;
    const dt = await extractDateTime(context, answer, language ?? "uk");
    // The answer's explicit date/time wins (user is stating it now); if the
    // answer has no date (e.g. just "о 14:30"), the original date is kept.
    if (dt.date) parsed.date = dt.date;
    if (dt.start_time) parsed.start_time = dt.start_time;
    if (dt.end_time) parsed.end_time = dt.end_time;
  }
  item.item_type = parsed.type;
  item.target_service = parsed.target_service;

  const responseLang = detectLang(item.original_transcript);
  const stillNeeds = clarificationNeeded(parsed, responseLang);
  const reasonChanged = stillNeeds && stillNeeds.reason !== prevReason;
  const attemptsSoFar = reasonChanged ? 0 : (item.clarification.attempts ?? 1);

  if (stillNeeds && attemptsSoFar < 2) {
    item.clarification = { ...stillNeeds, attempts: attemptsSoFar + 1 };
    item.updated_at = new Date().toISOString();
    saveDb(db);
    const tgId = await sendTelegram(stillNeeds.question);
    if (tgId) { item.clarification.tg_message_id = tgId; saveDb(db); }
    return res.json({
      ok: true, item_id: item.id, status: "awaiting_clarification",
      clarification: { reason: stillNeeds.reason, question: stillNeeds.question },
    });
  }

  if (stillNeeds) {
    item.status = "needs_review";
    item.clarification = { ...item.clarification, resolved: true };
    item.error_message = responseLang === "en" ? "Couldn't clarify — moved to review queue." : "Не вдалося уточнити — відклала в чергу.";
    item.updated_at = new Date().toISOString();
    saveDb(db);
    return res.json({ ok: true, item_id: item.id, status: "needs_review", label: finalizeLabel(item, responseLang) });
  }

  // Resolved → finalize + sync.
  item.clarification = { ...item.clarification, resolved: true };
  await finalizeItem(item, db);
  saveDb(db);
  return res.json({
    ok: true, item_id: item.id, status: item.status,
    title: parsed.title, service: parsed.target_service,
    error_message: item.error_message, label: finalizeLabel(item, responseLang),
  });
});

// 9c. List items currently awaiting clarification (for the bot's plain-text fallback).
app.get("/api/pending-clarifications", (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.query.token as string);
  const validToken = process.env.SHORTCUT_TOKEN || process.env.API_SECRET;
  if (!validToken || token !== validToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const db = getDb();
  const pending = db.items
    .filter((it) => it.status === "awaiting_clarification" && it.clarification)
    .map((it) => ({
      item_id: it.id,
      tg_message_id: it.clarification?.tg_message_id ?? null,
      reason: it.clarification?.reason,
      question: it.clarification?.question,
      title: it.ai_parsed_result.title,
    }));
  res.json({ ok: true, count: pending.length, pending });
});

// 9d. Morning digest — manual trigger / settings.
// GET  /api/morning-digest  → current settings
// POST /api/morning-digest  → { enabled?, hour? } to configure, or { send: true } to fire now
app.all("/api/morning-digest", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.body?.token as string);
  const validToken = process.env.SHORTCUT_TOKEN || process.env.API_SECRET;
  if (!validToken || token !== validToken) return res.status(401).json({ error: "Unauthorized" });

  const db = getDb();
  if (req.method === "GET") {
    return res.json({
      ok: true,
      enabled: db.settings.morning_digest_enabled ?? false,
      hour: db.settings.morning_digest_hour ?? 8,
    });
  }
  // POST
  const body = req.body ?? {};
  if (typeof body.enabled === "boolean") db.settings.morning_digest_enabled = body.enabled;
  if (typeof body.hour === "number" && body.hour >= 0 && body.hour <= 23) db.settings.morning_digest_hour = body.hour;
  saveDb(db);

  if (body.send === true) {
    try {
      const msg = await buildAndSendMorningDigest();
      return res.json({ ok: true, sent: true, message: msg });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  return res.json({ ok: true, enabled: db.settings.morning_digest_enabled, hour: db.settings.morning_digest_hour });
});

// 10. Sandbox datastores (for visual panel)
app.get("/api/sandbox/datastores", (_req, res) => {
  const db = getDb();
  res.json({
    calendar: db.simulated_calendar,
    notion:   db.simulated_notion,
    tasks:    db.simulated_tasks,
  });
});

// ─── Dashboard login / logout ─────────────────────────────

const COOKIE_OPTS = "Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000"; // 30 days
const SECURE_FLAG = process.env.NODE_ENV === "production" ? "; Secure" : "";

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { password } = req.body as { password?: string };
  if (!DASHBOARD_PASSWORD) return res.json({ ok: true });
  if (!password || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "Неверный пароль" });
  }
  res.setHeader("Set-Cookie", `vm_auth=${SESSION_TOKEN}; ${COOKIE_OPTS}${SECURE_FLAG}`);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `vm_auth=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/auth/check", (_req, res) => {
  res.json({ ok: true });
});

// ─── Google OAuth routes ───────────────────────────────────

// GET /api/auth/google/connect → redirect to Google consent
app.get("/api/auth/google/connect", authLimiter, (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google OAuth not configured in .env" });
  }
  const client = createOAuthClient();
  const state = generateOAuthState();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
  res.redirect(url);
});

// GET /api/auth/google/callback → exchange code for tokens
app.get("/api/auth/google/callback", authLimiter, async (req, res) => {
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };

  if (error) {
    return res.redirect(`/?page=settings&googleAuth=error:${encodeURIComponent(String(error))}`);
  }

  // CSRF: validate state parameter
  if (!state || !validateOAuthState(state)) {
    console.warn("[Auth] OAuth callback rejected: invalid or expired CSRF state");
    return res.redirect("/?page=settings&googleAuth=error:csrf_invalid");
  }

  if (!code) {
    return res.redirect("/?page=settings&googleAuth=error:missing_code");
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code as string);

    const db = getDb();
    db.google_tokens = tokens as GoogleTokens;
    db.settings.google_calendar_connected = true;
    db.settings.google_tasks_connected = true;
    saveDb(db);
    console.log("[Audit] Google OAuth connected at", new Date().toISOString());

    res.redirect("/?page=settings&googleAuth=connected");
  } catch (err: any) {
    console.error("Google OAuth callback error:", err.message);
    res.redirect(`/?page=settings&googleAuth=error:${encodeURIComponent(err.message)}`);
  }
});

// POST /api/auth/google/disconnect
app.post("/api/auth/google/disconnect", authLimiter, (_req, res) => {
  const db = getDb();
  delete db.google_tokens;
  db.settings.google_calendar_connected = false;
  db.settings.google_tasks_connected = false;
  saveDb(db);
  console.log("[Audit] Google OAuth disconnected at", new Date().toISOString());
  res.json({ success: true });
});

// GET /api/auth/google/status
app.get("/api/auth/google/status", (_req, res) => {
  const db = getDb();
  res.json({
    connected: !!(db.google_tokens?.refresh_token),
    calendar: db.settings.google_calendar_connected,
    tasks: db.settings.google_tasks_connected,
  });
});

// ─── Static serving ────────────────────────────────────────

async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev middleware active.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Serve .shortcut files with correct MIME type so iOS Safari imports them
    app.get("/VoiceMind.shortcut", (_req, res) => {
      res.setHeader("Content-Type", "application/vnd.apple-shortcut");
      res.sendFile(path.join(distPath, "VoiceMind.shortcut"));
    });
    // Hashed assets (js/css with content hash in filename) — cache 1 year
    app.use("/assets", express.static(path.join(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    }));
    // Everything else (index.html, manifest, icons) — no cache so updates propagate
    app.use(express.static(distPath, { maxAge: 0 }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving production build from dist/.");
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`VoiceMind server on port ${PORT}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Morning digest — fetches today's Google Calendar events + Google Tasks,
// formats a short Ukrainian message and sends it to Telegram.
// ─────────────────────────────────────────────────────────────────────────────

async function buildAndSendMorningDigest(): Promise<string> {
  const db = getDb();
  if (!db.settings.google_calendar_connected || !db.google_tokens) {
    return "Google Calendar не підключений — дайджест недоступний.";
  }

  const auth = await getAuthedClient(db.google_tokens, db);
  const todayKyiv = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const yyyy = todayKyiv.getFullYear();
  const mm   = String(todayKyiv.getMonth() + 1).padStart(2, "0");
  const dd   = String(todayKyiv.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const startOfDay = `${todayStr}T00:00:00+03:00`;
  const endOfDay   = `${todayStr}T23:59:59+03:00`;

  // Fetch today's Calendar events
  let eventLines: string[] = [];
  try {
    const cal = google.calendar({ version: "v3", auth });
    const evResp = await cal.events.list({
      calendarId: "primary",
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 10,
    });
    const events = evResp.data.items ?? [];
    eventLines = events.map((ev) => {
      const start = ev.start?.dateTime ?? ev.start?.date ?? "";
      const timeStr = start.includes("T")
        ? start.split("T")[1].slice(0, 5)   // "HH:MM"
        : "";
      return timeStr ? `  • ${timeStr} — ${ev.summary}` : `  • ${ev.summary}`;
    });
  } catch (err: any) {
    console.error("[digest] Calendar fetch failed:", err.message);
  }

  // Fetch incomplete tasks (due today or no due date — Google Tasks doesn't filter by due on API,
  // so we fetch needsAction tasks and filter client-side)
  let taskLines: string[] = [];
  if (db.settings.google_tasks_connected) {
    try {
      const tasks = google.tasks({ version: "v1", auth });
      const lists = await tasks.tasklists.list({ maxResults: 1 });
      const listId = lists.data.items?.[0]?.id ?? "@default";
      const tResp = await tasks.tasks.list({
        tasklist: listId,
        showCompleted: false,
        maxResults: 20,
      });
      const allTasks = tResp.data.items ?? [];
      // Keep tasks due today or with no due date
      const todayTasks = allTasks.filter((t) => {
        if (!t.due) return true;
        return t.due.startsWith(todayStr);
      });
      taskLines = todayTasks.slice(0, 10).map((t) => `  • ${t.title}`);
    } catch (err: any) {
      console.error("[digest] Tasks fetch failed:", err.message);
    }
  }

  // Build the message
  const weekdays = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];
  const dayName = weekdays[todayKyiv.getDay()];
  const months  = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const dateLabel = `${dd} ${months[todayKyiv.getMonth()]}, ${dayName}`;

  let msg = `☀️ Доброго ранку! Сьогодні ${dateLabel}.\n`;

  if (eventLines.length > 0) {
    msg += `\n📅 Календар:\n${eventLines.join("\n")}`;
  } else {
    msg += `\n📅 Зустрічей сьогодні немає.`;
  }

  if (taskLines.length > 0) {
    msg += `\n\n✅ Задачі:\n${taskLines.join("\n")}`;
  } else {
    msg += `\n\n✅ Задач на сьогодні немає.`;
  }

  await sendTelegram(msg);
  console.log("[digest] Morning digest sent.");
  return msg;
}

// Cron-style scheduler — fires at the configured hour in Kyiv timezone.
// Runs every 60 seconds; sends at most once per calendar day.
let lastDigestDate = "";
function startMorningDigestCron() {
  setInterval(async () => {
    try {
      const db = getDb();
      if (!db.settings.morning_digest_enabled) return;

      const nowKyiv = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
      const hour    = nowKyiv.getHours();
      const minute  = nowKyiv.getMinutes();
      const todayKey = nowKyiv.toISOString().slice(0, 10);

      const targetHour = db.settings.morning_digest_hour ?? 8;
      if (hour === targetHour && minute === 0 && todayKey !== lastDigestDate) {
        lastDigestDate = todayKey;
        await buildAndSendMorningDigest();
      }
    } catch (err: any) {
      console.error("[digest-cron] error:", err.message);
    }
  }, 60_000);
}

initServer().catch(err => {
  console.error("Server startup failed:", err);
  process.exit(1);
});

startMorningDigestCron();
