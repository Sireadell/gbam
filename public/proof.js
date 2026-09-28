// The proof page: one microphone, two AssemblyAI streaming sessions at once.
// Only difference between them is Gbam's key terms and shop prompt, so any
// gap in what they hear is what those key terms are worth.
import { freshState, shopKeyterms } from "./ledger.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let state;
try { state = JSON.parse(localStorage.getItem("pkv-shop-v1")); } catch {}
if (!state?.products) state = freshState();
const KEYTERMS = shopKeyterms(state);
const PROMPT = `A Nigerian shop owner speaking Nigerian English or Pidgin records sales and payments: quantities, products such as ${state.products.slice(0, 6).map(p => p.say).join(", ")}, prices in naira, and customer names such as ${state.customers.slice(0, 6).map(c => c.name).join(", ")}.`;
$("#count").textContent = KEYTERMS.length;

const SENTENCES = [
  "Oluwaseun collect two cartons of Golden Penny spaghetti",
  "Mama Ngozi pay twenty two thousand for Semovita",
  "Chinedu carry three tins of tomato paste",
  "Ibrahim buy one carton of Indomie and Peak milk",
  "Emeka don pay forty five thousand",
];
let chosen = SENTENCES[0];
function renderPick() {
  $("#pick").innerHTML = SENTENCES.map((s, i) => `<button type="button" data-i="${i}" class="${s === chosen ? "on" : ""}">${esc(s)}</button>`).join("");
  $("#pick").querySelectorAll("button").forEach(b => b.onclick = () => { chosen = SENTENCES[+b.dataset.i]; renderPick(); });
  $("#say").textContent = `Say: "${chosen}"`;
}
renderPick();

// Which of the shop's words did the speaker mean? The ones in the sentence.
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function expectedTerms() {
  const n = " " + norm(chosen) + " ";
  return KEYTERMS.filter(t => n.includes(" " + norm(t) + " "));
}
function mark(text, terms) {
  let html = esc(text);
  for (const t of terms) html = html.replace(new RegExp(`\\b(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi"), "<mark>$1</mark>");
  return html;
}
function scoreOf(text, terms) {
  const n = " " + norm(text) + " ";
  return terms.filter(t => n.includes(" " + norm(t) + " ")).length;
}

let run = null;
$("#mic").onclick = () => run ? run.stop() : start().catch(e => { $("#status").textContent = e.message; reset(); });

async function token() {
  const r = await fetch("/api/stt-token");
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error(j.error || `Could not reach AssemblyAI (${r.status})`);
  return j.token;
}

function openStream(tok, withTerms, el) {
  const q = new URLSearchParams({ sample_rate: 24000, encoding: "pcm_s16le", speech_model: "universal-3-5-pro", token: tok });
  if (withTerms) { q.set("keyterms_prompt", JSON.stringify(KEYTERMS)); q.set("prompt", PROMPT); }
  const ws = new WebSocket("wss://streaming.assemblyai.com/v3/ws?" + q);
  ws.binaryType = "arraybuffer";
  const turns = {};
  const s = { ws, text: "", done: null };
  s.done = new Promise(res => {
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === "Turn") {
        turns[m.turn_order] = m.transcript || m.utterance || "";
        s.text = Object.keys(turns).sort((a, b) => a - b).map(k => turns[k]).join(" ").trim();
        el.innerHTML = mark(s.text, KEYTERMS) || "<span class='status'>Listening...</span>";
      }
      if (m.type === "Termination") res();
    };
    ws.onclose = () => res();
  });
  return s;
}

async function start() {
  $("#status").textContent = "Connecting to AssemblyAI...";
  $("#plain").innerHTML = $("#with").innerHTML = "";
  $("#plainScore").textContent = $("#withScore").textContent = "";
  const [t1, t2] = await Promise.all([token(), token()]);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture", { processorOptions: { inputSampleRate: ctx.sampleRate } });
  src.connect(node);
  const a = openStream(t1, false, $("#plain")), b = openStream(t2, true, $("#with"));
  // Both sessions get the very same bytes.
  node.port.onmessage = e => { for (const s of [a, b]) if (s.ws.readyState === 1) s.ws.send(e.data.slice(0)); };
  run = {
    async stop() {
      $("#status").textContent = "Finishing...";
      node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close();
      for (const s of [a, b]) if (s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: "Terminate" }));
      await Promise.race([Promise.all([a.done, b.done]), new Promise(r => setTimeout(r, 5000))]);
      finish(a.text, b.text);
      reset();
    },
  };
  $("#mic").classList.add("live");
  $("#label").textContent = "Recording. Tap to stop";
  $("#status").textContent = `Say: "${chosen}"`;
}

function finish(plain, withTerms) {
  const exp = expectedTerms();
  const p = scoreOf(plain, exp), w = scoreOf(withTerms, exp);
  $("#plainScore").textContent = `Heard ${p} of ${exp.length} names and products right`;
  $("#withScore").textContent = `Heard ${w} of ${exp.length} names and products right`;
  $("#verdict").textContent = !plain && !withTerms ? "Nothing was heard. Check the microphone and try again."
    : w > p ? `Key terms helped: ${w} of ${exp.length} right, against ${p} without.`
    : w === p ? `Both got ${w} of ${exp.length} right this time. Try a harder name, like Oluwaseun.`
    : `This time the copy without key terms did better (${p} against ${w}). Results vary, so try again.`;
}

function reset() {
  run = null;
  $("#mic").classList.remove("live");
  $("#label").textContent = "Tap to record";
  if (!/Finishing|Connecting/.test($("#status").textContent)) return;
  $("#status").textContent = "Done. Pick another sentence or try again.";
}
