# 🎙️ AI Voice Assistant (iVoice)

> Capture any thought by voice — the AI figures out what it is and files it where it belongs.

A full-stack web app (installable as a PWA) for hands-free capture of tasks, notes, events, and reminders. Speak into the app, a Telegram bot, or an iOS Shortcut — the assistant transcribes your speech, understands the intent, and automatically routes it to **Google Calendar**, **Notion**, or **Google Tasks**. No manual sorting required.

---

## The problem

Ideas and to-dos show up at the worst moments — driving, walking, mid-meeting. By the time you're back at a keyboard, half of them are gone. Manually deciding "is this a calendar event, a note, or a task?" and typing it into the right app is friction that kills the habit.

## The solution

One button, three entry points, zero filing:

1. **Speech → text** — audio is transcribed with OpenAI **Whisper**.
2. **Text → intent** — **GPT-4o-mini** classifies the phrase, extracts dates/times, and returns structured JSON.
3. **Intent → action** — the item lands in the right service automatically:
   - 📅 **Google Calendar** — meetings, calls, any event with a date/time.
   - 📝 **Notion** — free-form ideas, thoughts, useful text.
   - ✅ **Google Tasks** — clear to-dos ("buy…", "remind me to…").

If something is ambiguous — a calendar event without a time, or a phrase that could be a task or a note — the bot asks exactly one clarifying question in Telegram, then files the item once you reply. Everything else is saved immediately.

---

## Features

- 🔘 **One-tap voice capture** — web app, iOS Shortcut, or Telegram bot.
- 🤖 **Telegram input bot** — send a voice note or text; the assistant transcribes and routes it. Supports clarification via native reply.
- 🧠 **AI intent parsing** (GPT-4o-mini) with confidence scoring.
- 🔁 **Auto-routing** to Calendar / Notion / Tasks based on meaning, not keywords.
- ❓ **Smart clarification** — asks only when necessary (missing event time, genuinely ambiguous type). Clarification always happens in Telegram regardless of capture channel.
- ☀️ **Morning digest** — daily Telegram message with today's calendar events and tasks (configurable time, Kyiv timezone).
- 🛟 **Works without an API key** — a regex fallback parses common phrases out of the box.
- 🧪 **Sandbox mode** — simulated Calendar / Notion / Tasks panels for safe testing.
- 📱 **PWA + iOS Shortcut** — install to home screen; trigger via a back-tap or Siri.
- 🔒 **Security built in** — Helmet, CORS, rate limiting, cookie session auth, Google OAuth tokens encrypted at rest.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 · TypeScript · Tailwind CSS · Vite |
| Backend | Node.js · Express · TypeScript (esbuild bundle) |
| Transcription | OpenAI **Whisper** (`whisper-1`) |
| Intent parsing | OpenAI **GPT-4o-mini** (structured JSON output) |
| Integrations | Google Calendar & Tasks · Notion · Telegram Bot API |
| Storage | Local JSON store (encrypted tokens) |
| Packaging | PWA (`vite-plugin-pwa`) |

---

## Architecture

```
┌─────────────────┐   ┌───────────────────┐   ┌──────────────────┐
│  Web app (PWA)  │   │  Telegram bot      │   │  iOS Shortcut    │
│  VoiceRecorder  │   │  telegram-bot.mjs  │   │  POST /shortcut  │
└────────┬────────┘   └────────┬──────────┘   └────────┬─────────┘
         │                     │                         │
         └─────────────────────▼─────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   server.ts (Express)│
                    │  Whisper → GPT →     │
                    │  clarify / finalize  │
                    └──┬──────┬──────┬────┘
                       │      │      │
                  📅 Cal  📝 Notion  ✅ Tasks
```

- `server.ts` — REST API, JSON store, OpenAI (Whisper + GPT), Google/Notion sync, OAuth, clarification logic, morning digest cron.
- `telegram-bot.mjs` — long-polling bot: forwards voice/text to `/api/shortcut`; handles clarification replies.
- `src/` — React SPA dashboard for reviewing captured items, editing, and settings.

---

## Quick start

### 1. Configure environment

```bash
cp .env.example .env       # fill in your keys
cp db.example.json db.json # local data store (git-ignored)
```

All `.env` variables are documented in `.env.example`.

### 2. Run in development

```bash
npm install
npm run dev     # Express + Vite on http://localhost:3000
```

### 3. Build and run in production

```bash
npm run build              # React → dist/, server.ts → dist/server.cjs
node dist/server.cjs       # or: pm2 start dist/server.cjs --name voicemind
```

### 4. Telegram bot (optional)

```bash
# Create a bot via @BotFather, add the token to .env:
# TELEGRAM_IVOICE_BOT_TOKEN=...
# IVOICE_ALLOWED_CHAT_ID=your_telegram_chat_id

node telegram-bot.mjs      # or: pm2 start telegram-bot.mjs --name voicemind-telegram
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Recommended | Whisper transcription + GPT-4o-mini parsing |
| `SHORTCUT_TOKEN` | Yes | Shared secret for `/api/shortcut` and bot auth |
| `API_SECRET` | Yes | Used to encrypt Google OAuth tokens at rest |
| `DASHBOARD_PASSWORD` | Yes | Password for the web dashboard |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth app credentials |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth app credentials |
| `NOTION_TOKEN` | Optional | Notion integration token (can also set via dashboard) |
| `TELEGRAM_IVOICE_BOT_TOKEN` | Optional | Telegram bot token (BotFather) |
| `IVOICE_ALLOWED_CHAT_ID` | Optional | Your Telegram user/chat ID (bot ignores all others) |
| `TZ` | Optional | Timezone for calendar events (default: `Europe/Kyiv`) |

---

## Example phrases

- **"Meeting with the designer tomorrow at 3pm"** → Google Calendar event.
- **"Remind me to pay for hosting on Friday"** → Google Tasks, dated Friday.
- **"Idea: a separate landing page for B2B clients"** → Notion note.
- **"Buy cat food"** → Google Tasks (no date needed).
- Ambiguous phrase → bot asks one question → files on reply.

---

## Morning digest

When enabled, the bot sends a daily Telegram message at the configured time (default 08:00 Kyiv time):

```
☀️ Доброго ранку! Сьогодні 18 червня, четвер.

📅 Календар:
  • 09:00 — Зарядити окуляри
  • 15:00 — Зустріч із дизайнером

✅ Задачі:
  • Перебрати сумку
  • Купити корм для кота
```

Enable via API:
```bash
curl -X POST http://localhost:3002/api/morning-digest \
  -H "Authorization: Bearer $SHORTCUT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "hour": 8}'
```

---

## Security & privacy

- **No secrets in the repo.** `.env` and `db.json` are git-ignored. `db.json` holds your Notion token, encrypted Google OAuth tokens, and personal voice notes — keep it local.
- Google OAuth tokens are **encrypted at rest** using `API_SECRET`.
- Dashboard access is protected by a password-based cookie session with rate limiting.

---

*Built as a practical demonstration of AI workflow automation — turning a single voice input into the right action across multiple tools.*
