// Vercel version of the token route in server.js: mints a single-use
// AssemblyAI Voice Agent token so the API key never reaches the browser.
// Set ASSEMBLYAI_API_KEY in the Vercel project's environment variables.
const MAX_SESSION_SECONDS = Number(process.env.MAX_SESSION_SECONDS) || 600;
const hits = new Map();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return res.status(503).json({ error: "Server has no AssemblyAI key" });
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (list.length > 6) return res.status(429).json({ error: "Too many sessions, wait a minute" });
  const r = await fetch(`https://agents.assemblyai.com/v1/token?expires_in_seconds=120&max_session_duration_seconds=${MAX_SESSION_SECONDS}`,
    { headers: { Authorization: `Bearer ${key}` } });
  res.status(r.status).setHeader("Content-Type", "application/json").send(await r.text());
}
