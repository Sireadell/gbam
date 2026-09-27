import { freshState, balanceOf, naira, shopKeyterms, reminder } from "./ledger.js";
import { ShopAgent } from "./agent.js";

const KEY = "pkv-shop-v1";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const store = {
  state: load(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch {} },
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.customers) {
      s.expenses ||= [];
      const seed = freshState().products;
      for (const p of s.products) if (p.cost == null) p.cost = seed.find(x => x.name === p.name)?.cost ?? null;
      return s;
    }
  } catch {}
  return freshState();
}

const TRIES = [
  "Two bags of rice, three thousand each, to Musa",
  "Chinedu paid thirteen thousand",
  "How much does Emeka owe?",
  "Sell one carton of Indomie to Aisha, she paid five thousand",
  "Musa paid seven thousand",
  "How much I make today?",
  "Remind Emeka",
  "Chinedu don pay 5k",
  "Add 20 bags of rice, I buy am 2,800 each from Alhaji Sule",
  "How many Indomie remain?",
  "New product: Milo tin, sell 2,000",
  "Rice now 3,200",
  "I spend 2,000 on transport",
  "Sell 2 sugar to Blessing, she paid by transfer, give am 300 off",
];

let partialYou = null, partialAgent = null;

const agent = new ShopAgent({
  store,
  on: {
    status: t => { $("#status").textContent = t; },
    ready: () => { setTyping(true); },
    hearing: on => $("#micBtn").classList.toggle("hearing", on),
    user: (text, final) => { partialYou = bubble("you", "You", text, final, partialYou); },
    agent: (text, final) => { partialAgent = bubble("agent", "Gbam", text, final, partialAgent); },
    draft: renderDraft,
    saved: r => { renderAll(); if (r.customer) flash(r.customer); },
    focus: name => flash(name),
    tool: logTool,
    reminder: (name, text) => showReminder(name, text),
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
    if (d.discount) rows = rows.replace('<tr class="total">', `<tr><td>Discount</td><td></td><td class="n">−${naira(d.discount)}</td></tr><tr class="total">`);
  } else if (d.kind === "payment") {
    rows = `<tr><td>${esc(d.customer)} pays</td><td class="n">${naira(d.amount)}</td></tr>`;
  } else {
    $("#draftBody").innerHTML = `<div><b>${STOCK_TITLES[d.kind]}</b></div><p>${esc(d.say.replace(/ Say yes\.$/, ""))}</p>`;
    return;
  }
  const how = d.method && d.method !== "cash" ? ` by ${d.method === "pos" ? "POS" : "transfer"}` : "";
  const who = d.customer ? `${esc(d.customer)}${d.isNew ? " (new customer)" : ""}${d.paid > 0 && how ? ", paid" + how : ""}` : `Walk-in, paid${how || " cash"}`;
  $("#draftBody").innerHTML = `<div><b>${who}</b></div><table>${rows}</table>` +
    (d.customer ? `<div class="after">${afterText(d.customer, d.after)}</div>` : "");
}
const STOCK_TITLES = { restock: "Stock coming in", product: "New product", price: "Price change", expense: "Money spent" };

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

  $("#stock").innerHTML = st.products.map(p => `<li class="${p.stock <= 5 ? "low" : ""}"><span>${esc(p.name)}</span><span class="amt">${p.stock} · ${naira(p.price)}</span></li>`).join("");
  $("#receipts").innerHTML = st.receipts.length
    ? st.receipts.slice(0, 12).map(r => `<li data-ref="${r.ref}"><span>${receiptLabel(r)}</span><span class="ref">${r.ref}</span></li>`).join("")
    : `<li class="empty">Nothing saved yet.</li>`;
  $("#receipts").querySelectorAll("li[data-ref]").forEach(li => li.onclick = () => { location.hash = "receipt=" + li.dataset.ref; });

  $("#keyterms").innerHTML = shopKeyterms(st).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  if (!$("#log").children.length) $("#log").innerHTML = `<div class="empty">Tap the microphone and talk the way you would to a shop assistant.<br>Nothing is saved until you say yes.</div>`;
}
function receiptLabel(r) {
  if (r.kind === "sale") return `${esc(r.customer || "Walk-in")} · ${naira(r.total)} sale`;
  if (r.kind === "payment") return `${esc(r.customer)} · ${naira(r.paid)} paid`;
  if (r.kind === "restock") return `Stock in · ${r.quantity} ${esc(r.product)}`;
  if (r.kind === "product") return `New product · ${esc(r.product)}`;
  if (r.kind === "price") return `Price · ${esc(r.product)} ${naira(r.to)}`;
  return `Spent · ${naira(r.total)} ${esc(r.note)}`;
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
  $("#custBody").innerHTML = `<h3>${esc(c.name)}</h3><div>${amt(b)}</div><table>${rows || "<tr><td>No entries yet</td></tr>"}</table><div class="hint">+ took goods on credit, − paid</div>` +
    (b > 0 ? `<p><button type="button" class="ghost small" id="custRemind">Remind ${esc(c.name)} on WhatsApp</button></p>` : "");
  if (b > 0) $("#custRemind").onclick = () => { const r = reminder(store.state, c.name); showReminder(r.customer, r.text); $("#custDlg").close(); };
  $("#custDlg").showModal();
}

// The owner sends it from their own WhatsApp; the app never sends anything.
function showReminder(name, text) {
  $("#remindText").textContent = text;
  $("#remindSend").href = "https://wa.me/?text=" + encodeURIComponent(text);
  $("#remind").hidden = false;
}
$("#remindClose").onclick = () => { $("#remind").hidden = true; };

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
    if (r.discount) body += `<tr><td>Discount given</td><td class="n">${naira(r.discount)}</td></tr>`;
    if (r.method && r.method !== "cash") body += `<tr><td>Paid by</td><td class="n">${r.method === "pos" ? "POS" : "Transfer"}</td></tr>`;
  } else if (r.kind === "payment") body += `<tr><td>Payment from ${esc(r.customer)}</td><td class="n">${naira(r.paid)}</td></tr>`;
  else if (r.kind === "restock") body += `<tr><td>${r.quantity} × ${esc(r.product)} in${r.supplier ? " from " + esc(r.supplier) : ""}</td><td class="n">${r.total ? naira(r.total) : ""}</td></tr>`;
  else if (r.kind === "product") body += `<tr><td>New product ${esc(r.product)}</td><td class="n">${naira(r.item.price)}</td></tr>`;
  else if (r.kind === "price") body += `<tr><td>${esc(r.product)}: ${naira(r.from)} to</td><td class="n">${naira(r.to)}</td></tr>`;
  else body += `<tr><td>Spent on ${esc(r.note)}</td><td class="n">${naira(r.total)}</td></tr>`;
  body += `</table>`;
  if (r.customer) body += `<div>${esc(r.customer)}: ${amt(r.after)} after this.</div>`;
  body += `<p><button type="button" class="ghost small" id="undoBtn">Undo this, it was a mistake</button></p>`;
  $("#receiptBody").innerHTML = body;
  let armedUndo = false;
  $("#undoBtn").onclick = () => {
    if (!armedUndo) { armedUndo = true; $("#undoBtn").textContent = "Tap again to remove it from the books"; return; }
    const res = agent.undo(r.ref);
    // A bare conversation.message is not seen by the next reply (see typed() in agent.js), so the note rides in reply.create.
    if (res.ok && agent.ready) agent.send({ type: "reply.create", instructions: `The owner just undid receipt ${r.ref} on screen. Say exactly: "${res.say}"` });
    $("#receiptDlg").close();
  };
  if (!$("#receiptDlg").open) $("#receiptDlg").showModal();
}
window.addEventListener("hashchange", showReceiptFromHash);
$("#receiptDlg").addEventListener("close", () => { if (location.hash) history.replaceState(null, "", location.pathname); });

// For support: everything the session did except audio, to paste back to us.
$("#copyLog").onclick = async () => {
  const lines = (agent.debugLog || []).map(e => {
    const m = { ...e.m };
    if (m.token) m.token = "(hidden)";
    return `${new Date(e.t).toISOString().slice(11, 23)} ${e.dir} ${JSON.stringify(m)}`;
  }).join("\n") || "No session yet.";
  try { await navigator.clipboard.writeText(lines); $("#copyLogMsg").textContent = "Copied. Paste it to us."; }
  catch { $("#logOut").hidden = false; $("#logOut").value = lines; $("#logOut").select(); $("#copyLogMsg").textContent = "Select all and copy."; }
};

function logTool(name, args, result) {
  const li = document.createElement("li");
  li.innerHTML = `<b>${esc(name)}</b>(${esc(JSON.stringify(args))})<br><span class="${result.ok ? "ok" : "err"}">→ ${esc(result.say || result.error)}</span>`;
  $("#tools").prepend(li);
}

// ---------- export ----------

// Kippa went offline in 2024 and its traders lost their books. Here every
// record downloads as a spreadsheet file that opens in Excel or Sheets.
function csv(rows) {
  return rows.map(r => r.map(v => {
    let s = String(v ?? "");
    // A name like "=HYPERLINK(...)" would run as a formula in Excel, so text
    // starting with = + - or @ gets a leading apostrophe. Numbers are left alone.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}
$("#exportBtn").onclick = () => {
  const st = store.state;
  const rows = [["Section", "Date", "Receipt", "Customer or product", "What", "Amount (NGN)", "Balance after (NGN)"]];
  for (const c of st.customers) {
    for (const e of c.entries) rows.push(["Customer entry", e.ts.slice(0, 10), e.ref || "", c.name, `${e.type === "debt" ? "Took goods" : "Paid"}: ${e.note || ""}`, e.type === "debt" ? e.amount : -e.amount, ""]);
    rows.push(["Customer balance", "", "", c.name, "Owes (+) or deposit held (-)", "", balanceOf(c).balance]);
  }
  for (const p of st.products) rows.push(["Stock", "", "", p.name, `${p.stock} in stock, bought at ${p.cost ?? "?"}`, p.price, ""]);
  for (const r of st.receipts.slice().reverse()) rows.push(["Receipt", r.ts.slice(0, 10), r.ref, r.customer || r.product || "", r.kind + (r.note ? ": " + r.note : ""), r.total ?? r.paid ?? "", r.after ?? ""]);
  const blob = new Blob(["﻿" + csv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gbam-records-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

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
