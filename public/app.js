import { freshState, demoState, balanceOf, naira, shopKeyterms, reminder, summary, periodStart, debtors } from "./ledger.js";
import { ShopAgent } from "./agent.js";

const KEY = "pkv-shop-v1";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Gbam's memory of the last chat: who was being talked about and the last few
// lines. Kept in this browser only, for 12 hours, and it never holds numbers
// the agent may rely on: those always come from the books.
const MEM_KEY = "pkv-memory-v1", MEM_HOURS = 12, MEM_LINES = 8;
function loadMemory() {
  try {
    const m = JSON.parse(localStorage.getItem(MEM_KEY));
    if (m && Array.isArray(m.lines) && Date.now() - m.ts < MEM_HOURS * 3600e3) return m;
  } catch {}
  return { ts: Date.now(), customer: null, lines: [] };
}
const store = {
  state: load(),
  memory: loadMemory(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch {} },
  saveMemory() { this.memory.ts = Date.now(); try { localStorage.setItem(MEM_KEY, JSON.stringify(this.memory)); } catch {} },
  forget() { this.memory = { ts: Date.now(), customer: null, lines: [] }; try { localStorage.removeItem(MEM_KEY); } catch {} },
};
function remember(cls, who, text) {
  const t = String(text || "").trim();
  if (!t) return;
  store.memory.lines.push({ cls, who, text: t });
  store.memory.lines = store.memory.lines.slice(-MEM_LINES);
  store.saveMemory();
}
function showMemory() {
  const m = store.memory;
  $("#log").querySelectorAll(".msg.old").forEach(e => e.remove());
  $("#memnote").hidden = !m.lines.length;
  if (!m.lines.length) return;
  $("#memtxt").textContent = m.customer ? `Gbam remembers your last chat, about ${m.customer}.` : "Gbam remembers your last chat.";
  const log = $("#log");
  log.querySelector(".empty")?.remove();
  const frag = document.createDocumentFragment();
  for (const l of m.lines) {
    const el = document.createElement("div");
    el.className = `msg ${l.cls} old`;
    el.innerHTML = `<span class="who">${esc(l.who)}</span>${esc(l.text)}`;
    frag.appendChild(el);
  }
  log.prepend(frag);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s?.customers) {
        s.expenses ||= [];
        const seed = freshState().products;
        for (const p of s.products) if (p.cost == null) p.cost = seed.find(x => x.name === p.name)?.cost ?? null;
        if ((!s.receipts || !s.receipts.length) && !s.seeded) return demoState();
        return s;
      }
    }
  } catch {}
  return demoState();
}

const TRIES = [
  "Two bags of rice, three thousand each, to Musa",
  "Chinedu don pay 5k",
  "How much does Emeka owe?",
  "Who owe me?",
  "How was this week?",
  "Remind Emeka",
  "Add 20 bags of rice from Alhaji Sule",
  "Undo that",
];

let partialYou = null, partialAgent = null;

const agent = new ShopAgent({
  store,
  on: {
    status: t => { $("#status").textContent = t; },
    ready: () => { setTyping(true); },
    hearing: on => { $("#micBtn").classList.toggle("hearing", on); $("#fabMic").classList.toggle("hearing", on); },
    user: (text, final) => { partialYou = bubble("you", "You", text, final, partialYou); if (final) remember("you", "You", text); },
    agent: (text, final) => { partialAgent = bubble("agent", "Gbam", text, final, partialAgent); if (final) remember("agent", "Gbam", text); },
    draft: d => { renderDraft(d); if (d) bringTalk(); },
    saved: r => { renderAll(); if (r.customer) flash(r.customer); },
    focus: name => { flash(name); store.memory.customer = name; store.saveMemory(); showMemory(); },
    tool: logTool,
    reminder: (name, text) => { showReminder(name, text); bringTalk(); },
    ended: reason => setLive(false, reason),
  },
});

// ---------- tabs / routing ----------

const TABS = ["talk", "dashboard", "trades", "business"];
let activeTab = "talk";

function tabFromHash() {
  const m = location.hash.match(/^#\/(talk|dashboard|trades|business)/);
  return m ? m[1] : null;
}

function showTab(name, opts = {}) {
  if (!TABS.includes(name)) name = "talk";
  activeTab = name;
  for (const t of TABS) $("#tab-" + t).hidden = t !== name;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("on", b.dataset.tab === name);
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $("#fabMic").hidden = name === "talk";
  document.querySelector(".app").classList.toggle("fab-on", name !== "talk");
  if (!opts.skipHash) {
    const base = "#/" + name;
    if (!location.hash.startsWith(base)) history.replaceState(null, "", base);
  }
  if (name === "dashboard") renderDashboard();
  if (name === "trades") renderTrades();
  if (name === "business") renderBusiness();
}

document.querySelectorAll(".tab-btn").forEach(b => b.onclick = () => { location.hash = "#/" + b.dataset.tab; });

// Something the owner must answer (a draft or a reminder) arrived: show Talk,
// and close any open dialog so it cannot sit on top of the Yes button.
function bringTalk() {
  showTab("talk");
  for (const d of ["#receiptDlg", "#custDlg"]) if ($(d).open) $(d).close();
}

function route() {
  const tab = tabFromHash();
  // An old-style "#receipt=REF" link keeps the current tab; any other unknown hash shows Talk.
  if (tab) showTab(tab, { skipHash: true });
  else if (!/receipt=/.test(location.hash)) showTab("talk", { skipHash: !location.hash });
  showReceiptFromHash();
}
window.addEventListener("hashchange", route);

// Opening a receipt adds one history step, so closing it steps back instead
// of leaving a duplicate entry that makes Back look broken.
let receiptPushed = false;
function openReceipt(ref) { receiptPushed = true; location.hash = "#/" + activeTab + "?receipt=" + ref; }

// The floating mic is the same button as #micBtn: it starts (and shows Talk)
// or, while live, stops.
$("#fabMic").onclick = () => {
  if (!live && !$("#micBtn").disabled) showTab("talk");
  $("#micBtn").click();
};

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
  $("#fabMic").classList.toggle("live", on);
  $("#fabMic").setAttribute("aria-label", on ? "Stop talking" : "Talk");
  if (!on) { $("#micBtn").classList.remove("hearing"); $("#fabMic").classList.remove("hearing"); }
  $("#micLabel").textContent = on ? "Listening. Tap to stop" : "Tap to start talking";
  if (!on) { $("#status").textContent = reason || "Stopped. Tap to start again."; setTyping(false); }
}
function setTyping(on) {
  $("#typeInput").disabled = !on; $("#typeBtn").disabled = !on;
  $("#typeInput").placeholder = on ? "Or type it, e.g. Chinedu paid 5k" : "Tap the mic first, then you can type too";
}

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
  $("#customers").innerHTML = rows.length ? rows.map(({ c, b }) => `<li data-name="${esc(c.name)}"><span>${esc(c.name)}</span>${amt(b)}</li>`).join("")
    : `<li class="empty">No customers yet.</li>`;
  $("#customers").querySelectorAll("li[data-name]").forEach(li => li.onclick = () => showCustomer(li.dataset.name));

  $("#stock").innerHTML = st.products.map(p => `<li class="${p.stock <= 5 ? "low" : ""}"><span>${esc(p.name)}</span><span class="amt">${p.stock} left · ${naira(p.price)}</span></li>`).join("");
  $("#keyterms").innerHTML = shopKeyterms(st).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  if (!$("#log").children.length) $("#log").innerHTML = `<div class="empty">Tap the microphone and talk the way you would to a shop assistant.<br>Nothing is saved until you say yes.</div>`;

  if (activeTab === "dashboard") renderDashboard();
  if (activeTab === "trades") renderTrades();
  if (activeTab === "business") renderBusiness();
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
  $("#custBody").innerHTML = `<h3>${esc(c.name)}</h3><div>${amt(b)}</div><table>${rows || "<tr><td>No entries yet</td></tr>"}</table><div class="hint">+ bought on credit, − paid</div>` +
    (b > 0 ? `<p><button type="button" class="ghost small" id="custRemind">Remind ${esc(c.name)} on WhatsApp</button></p>` : "");
  if (b > 0) $("#custRemind").onclick = () => { const r = reminder(store.state, c.name); $("#custDlg").close(); showReminder(r.customer, r.text); bringTalk(); $("#remindSend").focus(); };
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
  const r = m && store.state.receipts.find(x => x.ref === m[1]);
  // Back out of a receipt link (or a link to one since undone): no dialog.
  if (!r) { if ($("#receiptDlg").open) $("#receiptDlg").close(); return; }
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
$("#receiptDlg").addEventListener("close", () => {
  const pushed = receiptPushed;
  receiptPushed = false;
  if (!location.hash.includes("receipt=")) return;
  if (pushed) history.back(); else history.replaceState(null, "", "#/" + activeTab);
});

// ---------- dashboard ----------

// Week, not today: until the owner records something, "Today" is all zeros.
let dashPeriod = "week";
$("#dashPeriod").querySelectorAll("button").forEach(b => b.onclick = () => {
  dashPeriod = b.dataset.period;
  $("#dashPeriod").querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
  renderDashboard();
});

// summary() leaves out receipts at or after "to", so to = now would drop a
// receipt saved in this same millisecond. Count up to midnight instead.
function endOfToday(now) { return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); }

function renderDashboard() {
  const st = store.state;
  const now = new Date();
  const sum = summary(st, periodStart(dashPeriod, now), endOfToday(now));
  $("#dashMoneyIn").textContent = naira(sum.cash);
  $("#dashSales").textContent = naira(sum.sold);
  $("#dashSold").textContent = sum.sales ? `${sum.sales} sale${sum.sales === 1 ? "" : "s"}` : "";
  $("#dashProfit").textContent = naira(sum.profit);
  $("#dashCredit").textContent = naira(sum.credit);
  $("#dashSpent").textContent = naira(sum.spent);

  const owing = debtors(st, now);
  $("#dashDebtors").innerHTML = owing.length ? owing.map(d => `<li>
      <span class="row-main"><span>${esc(d.name)}</span><span class="hint">${d.days === 0 ? "since today" : d.days === 1 ? "1 day" : d.days + " days"}</span></span>
      <span class="row-end"><span class="amt owe">${naira(d.balance)}</span><button type="button" class="ghost small collect" data-name="${esc(d.name)}">Collect</button></span>
    </li>`).join("") : `<li class="empty">No one owes you right now.</li>`;
  $("#dashDebtors").querySelectorAll(".collect").forEach(b => b.onclick = () => {
    const r = reminder(store.state, b.dataset.name);
    if (!r.ok || !r.text) return;
    showReminder(r.customer, r.text);
    bringTalk();
    $("#remindSend").focus();
  });

  const low = st.products.filter(p => p.stock <= 5);
  $("#dashLowStock").innerHTML = low.length ? low.map(p => `<li><span>${esc(p.name)}</span><span class="amt owe">${p.stock} left</span></li>`).join("")
    : `<li class="empty">Nothing running low.</li>`;

  $("#dashRecent").innerHTML = st.receipts.length ? st.receipts.slice(0, 5).map(r => `<li data-ref="${r.ref}"><span>${receiptLabel(r)}</span><span class="ref">${r.ref}</span></li>`).join("")
    : `<li class="empty">Nothing saved yet.</li>`;
  $("#dashRecent").querySelectorAll("li[data-ref]").forEach(li => li.onclick = () => openReceipt(li.dataset.ref));
}

// ---------- trades ----------

let tradeStatus = "all", tradePeriod = "week";
$("#tradeStatus").querySelectorAll("button").forEach(b => b.onclick = () => {
  tradeStatus = b.dataset.status;
  $("#tradeStatus").querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
  renderTrades();
});
$("#tradePeriod").querySelectorAll("button").forEach(b => b.onclick = () => {
  tradePeriod = b.dataset.period;
  $("#tradePeriod").querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
  renderTrades();
});

function isCredit(r) { return r.kind === "sale" && r.customer && r.paid < r.total; }

function renderTrades() {
  const st = store.state;
  const now = new Date();
  const from = periodStart(tradePeriod, now);
  const sum = summary(st, from, endOfToday(now));
  $("#tradeSales").textContent = naira(sum.sold);
  $("#tradeCash").textContent = naira(sum.cash);
  $("#tradeCredit").textContent = naira(sum.credit);
  $("#tradeProfit").textContent = naira(sum.profit);

  let rows = st.receipts.filter(r => (r.kind === "sale" || r.kind === "payment") && new Date(r.ts) >= from);
  if (tradeStatus === "paid") rows = rows.filter(r => !isCredit(r));
  if (tradeStatus === "credit") rows = rows.filter(isCredit);

  $("#tradeList").innerHTML = rows.length ? rows.map(r => {
    const when = new Date(r.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const items = r.kind === "sale" ? r.lines.map(l => `${l.quantity}× ${esc(l.product)}`).join(", ") : "Payment";
    const total = naira(r.kind === "sale" ? r.total : r.paid);
    const badge = r.kind === "payment" ? `<span class="badge paid">paid</span>` : isCredit(r) ? `<span class="badge credit">credit</span>` : `<span class="badge paid">paid</span>`;
    return `<li data-ref="${r.ref}">
        <div class="row-main"><b>${esc(r.customer || "Walk-in")}</b><span class="hint">${when} · ${items}</span></div>
        <div class="row-end"><span class="amt">${total}</span>${badge}<span class="ref">${r.ref}</span></div>
      </li>`;
  }).join("") : `<li class="empty">Nothing here for this filter.</li>`;
  $("#tradeList").querySelectorAll("li[data-ref]").forEach(li => li.onclick = () => openReceipt(li.dataset.ref));
}

// ---------- business ----------

let bizSub = "customers";
$("#bizSubnav").querySelectorAll("button").forEach(b => b.onclick = () => {
  bizSub = b.dataset.sub;
  $("#bizSubnav").querySelectorAll("button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
  ["customers", "stock", "expenses"].forEach(s => $("#biz-" + s).hidden = s !== bizSub);
});

function renderBusiness() {
  const st = store.state;
  const value = st.products.reduce((s, p) => s + p.stock * (p.cost || 0), 0);
  $("#stockValue").textContent = naira(value);

  const expenses = st.receipts.filter(r => r.kind === "expense");
  const total = expenses.reduce((s, r) => s + (r.total || 0), 0);
  $("#expensesTotal").textContent = naira(total);
  $("#expensesList").innerHTML = expenses.length ? expenses.map(r => `<li data-ref="${r.ref}"><span>${esc(r.note || "Expense")}</span><span class="amt">${naira(r.total)}</span></li>`).join("")
    : `<li class="empty">Nothing spent yet.</li>`;
  $("#expensesList").querySelectorAll("li[data-ref]").forEach(li => li.onclick = () => openReceipt(li.dataset.ref));
}

// For support: everything the session did except audio, to paste back to us.
$("#copyLog").onclick = async () => {
  const lines = (agent.debugLog || []).map(e => {
    const m = { ...e.m };
    if (m.token) m.token = "(hidden)";
    return `${new Date(e.t).toISOString().slice(11, 23)} ${e.dir} ${JSON.stringify(m)}`;
  }).join("\n") || "No session yet.";
  try { await navigator.clipboard.writeText(lines); $("#copyLogMsg").textContent = "Copied."; }
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
  store.state = demoState(); store.save(); store.forget(); showMemory();
  agent.draft = null; renderDraft(null); renderAll();
  if (agent.ready) agent.send({ type: "session.update", session: { input: { keyterms: shopKeyterms(store.state) } } });
};

window.addEventListener("pagehide", () => { if (agent.ws?.readyState === 1) agent.ws.send(JSON.stringify({ type: "session.end" })); });

$("#memForget").onclick = () => { store.forget(); showMemory(); renderAll(); };
showTab(tabFromHash() || "talk", { skipHash: true });
renderAll();
showMemory();
route();
