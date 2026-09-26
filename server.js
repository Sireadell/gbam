// Serves the app and mints single-use AssemblyAI tokens, so the API key
// stays on the server and never reaches a browser. No dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 5178;

function loadKey() {
  if (process.env.ASSEMBLYAI_API_KEY) return process.env.ASSEMBLYAI_API_KEY;
  try {
    const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^ASSEMBLYAI_API_KEY=(\S+)/m);
    if (m) return m[1];
  } catch {}
  return null;
}
const KEY = loadKey();
if (!KEY) console.warn("ASSEMBLYAI_API_KEY is not set. The page will load but voice will not start.");

// Demo protection: each session is capped, and one visitor can only open a
// few per minute, so a public link cannot burn through the credits.
const MAX_SESSION_SECONDS = Number(process.env.MAX_SESSION_SECONDS) || 600;
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length <= 6;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json", ".webmanifest": "application/manifest+json" };

async function token(kind) {
  const url = kind === "agent"
    ? `https://agents.assemblyai.com/v1/token?expires_in_seconds=120&max_session_duration_seconds=${MAX_SESSION_SECONDS}`
    : "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60";
  const r = await fetch(url, { headers: { Authorization: kind === "agent" ? `Bearer ${KEY}` : KEY } });
  return { status: r.status, body: await r.text() };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/voice-token" || url.pathname === "/api/stt-token") {
      if (!KEY) return send(res, 503, "application/json", JSON.stringify({ error: "Server has no AssemblyAI key" }));
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
      if (!allowed(ip)) return send(res, 429, "application/json", JSON.stringify({ error: "Too many sessions, wait a minute" }));
      const t = await token(url.pathname === "/api/voice-token" ? "agent" : "stt");
      return send(res, t.status, "application/json", t.body);
    }
    if (url.pathname === "/healthz") return send(res, 200, "text/plain", "ok");
    // Session log, only from this same computer (see trace() in agent.js).
    if (url.pathname === "/api/log" && req.method === "POST") {
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) && !req.headers["x-forwarded-for"];
      if (!local) return send(res, 403, "text/plain", "no");
      let body = "";
      for await (const c of req) { body += c; if (body.length > 2e6) break; }
      fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const lines = JSON.parse(body).map(e => JSON.stringify(e)).join("\n") + "\n";
      fs.appendFileSync(path.join(ROOT, "logs", `${day}.jsonl`), lines);
      return send(res, 204, "text/plain", "");
    }

    let file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "text/plain", "no");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
    send(res, 200, TYPES[path.extname(file)] || "application/octet-stream", fs.readFileSync(file));
  } catch (e) {
    send(res, 500, "text/plain", "Server error");
    console.error(e);
  }
}).listen(PORT, () => console.log(`PriceKeeper Voice on http://localhost:${PORT}`));

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
