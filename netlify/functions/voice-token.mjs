// Netlify version of the token route in server.js: mints a single-use
// AssemblyAI Voice Agent token so the API key never reaches the browser.
// Set ASSEMBLYAI_API_KEY in the Netlify site's environment variables.
const MAX_SESSION_SECONDS = Number(process.env.MAX_SESSION_SECONDS) || 600;
const hits = new Map();

export default async (req, context) => {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return Response.json({ error: "Server has no AssemblyAI key" }, { status: 503 });
  const ip = context.ip || "unknown";
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (list.length > 6) return Response.json({ error: "Too many sessions, wait a minute" }, { status: 429 });
  const r = await fetch(`https://agents.assemblyai.com/v1/token?expires_in_seconds=120&max_session_duration_seconds=${MAX_SESSION_SECONDS}`,
    { headers: { Authorization: `Bearer ${key}` } });
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};

export const config = { path: "/api/voice-token" };
