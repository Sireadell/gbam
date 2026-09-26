// Vercel route for the proof page: a single-use AssemblyAI streaming
// speech-to-text token, so the API key never reaches the browser.
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
  if (list.length > 12) return res.status(429).json({ error: "Too many tries, wait a minute" });
  const r = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=120",
    { headers: { Authorization: key } });
  res.status(r.status).setHeader("Content-Type", "application/json").send(await r.text());
}
