import { freshState, balanceOf, naira, shopKeyterms } from "./ledger.js";
import { ShopAgent } from "./agent.js";

const KEY = "pkv-shop-v1";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const store = {
  state: load(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch {} },
};
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.customers) return s; } catch {}
  return freshState();
}

const TRIES = [
  "Two bags of rice, three thousand each, to Musa",
  "Chinedu paid thirteen thousand",
  "How much does Emeka owe?",
  "Sell one carton of Indomie to Aisha, she paid five thousand",
  "Musa paid seven thousand",
];

let partialYou = null, partialAgent = null;

const agent = new ShopAgent({
  store,
  on: {
    status: t => { $("#status").textContent = t; },
    ready: () => { setTyping(true); },
    hearing: on => $("#micBtn").classList.toggle("hearing", on),
    user: (text, final) => { partialYou = bubble("you", "You", text, final, partialYou); },
    agent: (text, final) => { partialAgent = bubble("agent", "PriceKeeper", text, final, partialAgent); },
    draft: renderDraft,
    saved: r => { renderAll(); if (r.customer) flash(r.customer); },
    focus: name => flash(name),
    tool: logTool,
    ended: reason => setLive(false, reason),
  },
});

// ---------- talk ----------

let live = false;
$("#micBtn").onclick = async () => {
  if (live) { agent.stop(); setLive(false); return; }
  $("#micBtn").disabled = true;
  $("#status").textContent = "Connecting to AssemblyAI...";
  try {
    await agent.start();
    setLive(true);
  } catch (e) {
    $("#status").textContent = e.message;
  } finally { $("#micBtn").disabled = false; }
};

function setLive(on, reason) {
  live = on;
  $("#micBtn").classList.toggle("live", on);
  $("#micBtn").setAttribute("aria-label", on ? "Stop talking" : "Start talking");
  $("#micLabel").textContent = on ? "Listening. Tap to stop" : "Tap to start talking";
  if (!on) { $("#status").textContent = reason || "Stopped. Tap to start again."; setTyping(false); }
}
function setTyping(on) { $("#typeInput").disabled = !on; $("#typeBtn").disabled = !on; }

$("#typeForm").onsubmit = e => {
  e.preventDefault();
  const t = $("#typeInput").value.trim();
  if (!t) return;
  agent.typed(t);
  $("#typeInput").value = "";
};

$("#tries").innerHTML = TRIES.map(t => `<button type="button">"${esc(t)}"</button>`).join("");
$("#tries").querySelectorAll("button").forEach((b, i) => b.onclick = () => {
  if (live && agent.ready) agent.typed(TRIES[i]);
  else $("#status").textContent = `Tap the microphone, then say: "${TRIES[i]}"`;
});

function bubble(cls, who, text, final, el) {
  const log = $("#log");
  log.querySelector(".empty")?.remove();
  if (!el) { el = document.createElement("div"); el.className = `msg ${cls}`; log.appendChild(el); }
  el.classList.toggle("partial", !final);
  el.innerHTML = `<span class="who">${who}</span>${esc(text)}`;
  log.scrollTop = log.scrollHeight;
  return final ? null : el;
}

// ---------- draft ----------

function renderDraft(d) {
  $("#draft").hidden = !d;
  if (!d) return;
  let rows = "";
  if (d.kind === "sale") {
    rows = d.lines.map(l => `<tr><td>${l.quantity} × ${esc(l.product)}${l.inStock ? "" : " <small>(not in stock list)</small>"}</td><td class="n">${naira(l.unit_price)}</td><td class="n">${naira(l.line_total)}</td></tr>`).join("");
    rows += `<tr class="total"><td>Total</td><td></td><td class="n">${naira(d.total)}</td></tr>`;
    if (d.customer && d.paid > 0) rows += `<tr><td>Paid now</td><td></td><td class="n">${naira(d.paid)}</td></tr>`;
  } else {
    rows = `<tr><td>${esc(d.customer)} pays</td><td class="n">${naira(d.amount)}</td></tr>`;
  }
  const who = d.customer ? `${esc(d.customer)}${d.isNew ? " (new customer)" : ""}` : "Walk-in, paid cash";
  $("#draftBody").innerHTML = `<div><b>${who}</b></div><table>${rows}</table>` +
    (d.customer ? `<div class="after">${afterText(d.customer, d.after)}</div>` : "");
}
function afterText(name, b) {
  if (b > 0) return `${esc(name)} will owe <span class="amt owe">${naira(b)}</span>`;
  if (b < 0) return `You will be holding <span class="amt hold">${naira(-b)}</span> for ${esc(name)}`;
  return `${esc(name)}'s account will be settled`;
}
$("#confirmBtn").onclick = () => agent.draft && (agent.ready ? agent.confirmFromScreen() : agent.save());
$("#cancelBtn").onclick = () => agent.cancelFromScreen();

// ---------- books ----------

function renderAll() {
  const st = store.state;
  $("#shopName").textContent = `${st.shop.name}, ${st.shop.city} · sample shop`;
  const rows = st.customers.map(c => ({ c, b: balanceOf(c).balance }))
    .sort((a, b) => (b.b > 0) - (a.b > 0) || Math.abs(b.b) - Math.abs(a.b) || a.c.name.localeCompare(b.c.name));
  const owed = rows.reduce((s, r) => s + Math.max(0, r.b), 0);
  const held = rows.reduce((s, r) => s + Math.max(0, -r.b), 0);
  $("#stats").innerHTML = `<div class="stat owe"><b>${naira(owed)}</b><span>customers owe you</span></div>
    <div class="stat hold"><b>${naira(held)}</b><span>you are holding</span></div>`;
  $("#customers").innerHTML = rows.map(({ c, b }) => `<li data-name="${esc(c.name)}"><span>${esc(c.name)}</span>${amt(b)}</li>`).join("");
  $("#customers").querySelectorAll("li").forEach(li => li.onclick = () => showCustomer(li.dataset.name));

  $("#receipts").innerHTML = st.receipts.length
    ? st.receipts.slice(0, 12).map(r => `<li data-ref="${r.ref}"><span>${esc(r.customer || "Walk-in")} · ${r.kind === "sale" ? naira(r.total) + " sale" : naira(r.paid) + " paid"}</span><span class="ref">${r.ref}</span></li>`).join("")
    : `<li class="empty">Nothing saved yet.</li>`;
  $("#receipts").querySelectorAll("li[data-ref]").forEach(li => li.onclick = () => { location.hash = "receipt=" + li.dataset.ref; });

  $("#keyterms").innerHTML = shopKeyterms(st).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  if (!$("#log").children.length) $("#log").innerHTML = `<div class="empty">Tap the microphone and talk the way you would to a shop assistant.<br>Nothing is saved until you say yes.</div>`;
}
function amt(b) {
  if (b > 0) return `<span class="amt owe">owes ${naira(b)}</span>`;
  if (b < 0) return `<span class="amt hold">holding ${naira(-b)}</span>`;
  return `<span class="amt zero">settled</span>`;
}
function flash(name) {
  const li = [...$("#customers").children].find(x => x.dataset.name === name);
  if (!li) return;
  li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
  li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function showCustomer(name) {
  const c = store.state.customers.find(x => x.name === name);
  if (!c) return;
  const b = balanceOf(c).balance;
  const rows = c.entries.slice().reverse().map(e => `<tr><td>${new Date(e.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${esc(e.note || "")}${e.ref ? ` <span class="ref">${e.ref}</span>` : ""}</td><td class="n">${e.type === "debt" ? "+" : "−"}${naira(e.amount)}</td></tr>`).join("");
  $("#custBody").innerHTML = `<h3>${esc(c.name)}</h3><div>${amt(b)}</div><table>${rows || "<tr><td>No entries yet</td></tr>"}</table><div class="hint">+ took goods on credit, − paid</div>`;
  $("#custDlg").showModal();
}

// Receipts have their own link, so a customer can be sent one.
function showReceiptFromHash() {
  const m = location.hash.match(/receipt=([\w-]+)/);
  if (!m) return;
  const r = store.state.receipts.find(x => x.ref === m[1]);
  if (!r) return;
  const when = new Date(r.ts).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  let body = `<h3>Receipt <span class="ref">${r.ref}</span></h3><div class="hint">${esc(store.state.shop.name)} · ${when}</div><table>`;
  if (r.kind === "sale") {
    body += r.lines.map(l => `<tr><td>${l.quantity} × ${esc(l.product)}</td><td class="n">${naira(l.line_total)}</td></tr>`).join("");
    body += `<tr><td><b>Total</b></td><td class="n"><b>${naira(r.total)}</b></td></tr>`;
    if (r.customer) body += `<tr><td>Paid now</td><td class="n">${naira(r.paid)}</td></tr>`;
  } else body += `<tr><td>Payment from ${esc(r.customer)}</td><td class="n">${naira(r.paid)}</td></tr>`;
  body += `</table>`;
  if (r.customer) body += `<div>${esc(r.customer)}: ${amt(r.after)} after this.</div>`;
  body += `<p><button type="button" class="ghost small" id="undoBtn">Undo this, it was a mistake</button></p>`;
  $("#receiptBody").innerHTML = body;
  let armedUndo = false;
  $("#undoBtn").onclick = () => {
    if (!armedUndo) { armedUndo = true; $("#undoBtn").textContent = "Tap again to remove it from the books"; return; }
    const res = agent.undo(r.ref);
    if (res.ok && agent.ready) agent.send({ type: "conversation.message", role: "system", content: `The owner undid receipt ${r.ref} on screen. ${res.say}` });
    $("#receiptDlg").close();
  };
  if (!$("#receiptDlg").open) $("#receiptDlg").showModal();
}
window.addEventListener("hashchange", showReceiptFromHash);
$("#receiptDlg").addEventListener("close", () => { if (location.hash) history.replaceState(null, "", location.pathname); });

function logTool(name, args, result) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${esc(name)}</b>(${esc(JSON.stringify(args))})<br><span class="${result.ok ? "ok" : "err"}">→ ${esc(result.say || result.error)}</span>`;
  $("#tools").prepend(li);
}

// ---------- reset ----------

let armed = null;
$("#resetBtn").onclick = () => {
  if (!armed) {
    $("#resetBtn").textContent = "Tap again to reset";
    armed = setTimeout(() => { armed = null; $("#resetBtn").textContent = "Reset sample shop"; }, 3000);
    return;
  }
  clearTimeout(armed); armed = null;
  $("#resetBtn").textContent = "Reset sample shop";
  store.state = freshState(); store.save();
  agent.draft = null; renderDraft(null); renderAll();
  if (agent.ready) agent.send({ type: "session.update", session: { input: { keyterms: shopKeyterms(store.state) } } });
};

window.addEventListener("pagehide", () => { if (agent.ws?.readyState === 1) agent.ws.send(JSON.stringify({ type: "session.end" })); });

renderAll();
showReceiptFromHash();
