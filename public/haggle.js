// Haggle mode: one microphone, one AssemblyAI streaming session with speaker
// labels on. The two voices are shown apart, then the last price agreed is
// turned into a normal sale draft. Nothing is saved until the owner taps Save.
import { freshState, shopKeyterms, draftSale, commit, naira } from "./ledger.js";
import { readDeal } from "./haggle-parse.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KEY = "pkv-shop-v1";

let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch {}
if (!state?.products) state = freshState();
const KEYTERMS = shopKeyterms(state);
const PROMPT = `Two people haggling over the price of goods in a Nigerian shop, in Nigerian English or Pidgin: quantities, products such as ${state.products.slice(0, 6).map(p => p.say).join(", ")}, and prices in naira.`;

let run = null, lines = [];

$("#mic").onclick = () => run ? run.stop() : start().catch(e => { $("#status").textContent = e.message; reset(); });

async function token() {
  const r = await fetch("/api/stt-token");
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error(j.error || `Could not reach AssemblyAI (${r.status})`);
  return j.token;
}

function draw() {
  const order = [];
  $("#lines").innerHTML = lines.length ? lines.map(l => {
    if (!order.includes(l.speaker)) order.push(l.speaker);
    return `<div class="line ${order.indexOf(l.speaker) % 2 ? "b" : "a"}"><div class="who">Voice ${esc(l.speaker || "?")}</div><div class="say">${esc(l.text)}</div></div>`;
  }).join("") : "<span class='status'>Listening...</span>";
}

async function start() {
  $("#status").textContent = "Connecting to AssemblyAI...";
  $("#deal").hidden = true; lines = []; draw();
  const tok = await token();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture", { processorOptions: { inputSampleRate: ctx.sampleRate } });
  src.connect(node);
  const q = new URLSearchParams({ sample_rate: 24000, encoding: "pcm_s16le", speech_model: "universal-3-5-pro",
    speaker_labels: "true", max_speakers: "2", token: tok, keyterms_prompt: JSON.stringify(KEYTERMS), prompt: PROMPT });
  const ws = new WebSocket("wss://streaming.assemblyai.com/v3/ws?" + q);
  ws.binaryType = "arraybuffer";
  const turns = {};
  const done = new Promise(res => {
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === "Turn") {
        turns[m.turn_order] = { speaker: m.speaker_label || "", text: m.transcript || m.utterance || "" };
        lines = Object.keys(turns).sort((a, b) => a - b).map(k => turns[k]).filter(t => t.text);
        draw();
      }
      if (m.type === "Termination") res();
    };
    ws.onclose = () => res();
  });
  node.port.onmessage = e => { if (ws.readyState === 1) ws.send(e.data.slice(0)); };
  run = {
    async stop() {
      $("#status").textContent = "Finishing...";
      node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close();
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "Terminate" }));
      await Promise.race([done, new Promise(r => setTimeout(r, 5000))]);
      finish();
      reset();
    },
  };
  $("#mic").classList.add("live");
  $("#label").textContent = "Listening. Tap to stop";
  $("#status").textContent = "Haggle as normal. Gbam is listening.";
}

function reset() {
  run = null;
  $("#mic").classList.remove("live");
  $("#label").textContent = "Tap to listen";
}

function finish() {
  const deal = readDeal(state, lines);
  if (deal.none) {
    $("#status").textContent = lines.length ? `${deal.why} Try again and say the product and the price clearly.` : "Nothing was heard. Check the microphone and try again.";
    return;
  }
  $("#status").textContent = "Done. Check the deal below.";
  $("#deal").hidden = false; $("#msg").textContent = ""; $("#save").disabled = false;
  $("#fProduct").innerHTML = state.products.map(p => `<option value="${esc(p.name)}"${p.name === deal.product ? " selected" : ""}>${esc(p.say)}</option>`).join("");
  $("#fCustomer").innerHTML = `<option value="">Walk-in, paid in cash</option>` + state.customers.map(c => `<option>${esc(c.name)}</option>`).join("");
  $("#fQty").value = deal.quantity;
  $("#fPrice").value = deal.unit_price;
  $("#dealNote").textContent = `Gbam took the last price said: ${naira(deal.unit_price)}${deal.asTotal ? " each (worked out from the total)" : ""}. Change anything that is wrong.`;
  total();
}

function total() { $("#total").textContent = "Total " + naira((+$("#fQty").value || 0) * (+$("#fPrice").value || 0)); }
["#fQty", "#fPrice"].forEach(s => { $(s).oninput = total; });
$("#discard").onclick = () => { $("#deal").hidden = true; };

$("#save").onclick = () => {
  // Re-read the shop first, so a sale saved in another tab is not overwritten.
  try { const fresh = JSON.parse(localStorage.getItem(KEY)); if (fresh?.products) state = fresh; } catch {}
  const p = state.products.find(x => x.name === $("#fProduct").value);
  const r = draftSale(state, { customer: $("#fCustomer").value, price_confirmed: true,
    items: [{ product: p.say, quantity: +$("#fQty").value, unit_price: +$("#fPrice").value }] });
  if (!r.ok) { $("#msg").textContent = r.error; return; }
  const out = commit(state, r.draft);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  $("#msg").textContent = `Saved, receipt ${out.receipt.ref}. It is now in Trades.`;
  $("#save").disabled = true;
};
