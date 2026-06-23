// Cleanup: delete Google Tasks that are NOT tracked in the dashboard (db.json)
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

// Collect all external_service_ids from dashboard items (tasks only)
const dashboardIds = new Set(
  db.items
    .filter(i => i.target_service === "reminders" && i.external_service_id)
    .map(i => i.external_service_id)
);

console.log(`Dashboard has ${dashboardIds.size} tracked task(s):`);
db.items
  .filter(i => i.target_service === "reminders" && i.external_service_id)
  .forEach(i => console.log(`  [keep] ${i.external_service_id} — ${i.ai_parsed_result.title}`));

const oauth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
oauth.setCredentials(tokens);

const tasks = google.tasks({ version: "v1", auth: oauth });
const lists = await tasks.tasklists.list({ maxResults: 10 });

let deleted = 0;
for (const list of lists.data.items ?? []) {
  const r = await tasks.tasks.list({
    tasklist: list.id,
    showCompleted: true,
    maxResults: 100,
  });
  const all = r.data.items ?? [];
  console.log(`\nList "${list.title}": ${all.length} task(s)`);

  for (const t of all) {
    if (dashboardIds.has(t.id)) {
      console.log(`  [keep]   ${t.id} — ${t.title}`);
    } else {
      console.log(`  [DELETE] ${t.id} — ${t.title}`);
      await tasks.tasks.delete({ tasklist: list.id, task: t.id });
      deleted++;
    }
  }
}

console.log(`\nDone. Deleted ${deleted} orphaned task(s).`);
