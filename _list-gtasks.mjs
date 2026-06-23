// Read-only: list current Google Tasks to diagnose the morning-digest phantom tasks.
import crypto from "node:crypto";
import fs from "node:fs";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const ENC_KEY = crypto.createHash("sha256")
  .update(process.env.API_SECRET ?? "").digest();

function decryptToken(ciphertext) {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  d.setAuthTag(tag);
  return d.update(enc).toString("utf8") + d.final("utf8");
}

const db = JSON.parse(fs.readFileSync("db.json", "utf8"));
const tokens = JSON.parse(decryptToken(db._google_tokens_enc));

const oauth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
oauth.setCredentials(tokens);

const tasks = google.tasks({ version: "v1", auth: oauth });
const lists = await tasks.tasklists.list({ maxResults: 10 });
for (const l of lists.data.items ?? []) {
  const r = await tasks.tasks.list({ tasklist: l.id, showCompleted: false, maxResults: 100 });
  const items = r.data.items ?? [];
  console.log(`\n=== LIST "${l.title}" (${l.id}) — ${items.length} needsAction ===`);
  for (const t of items) {
    console.log(`  id=${t.id} | due=${t.due ?? "-"} | ${t.title}`);
  }
}
