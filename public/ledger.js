// The shop's books. Every number the agent says comes from here, never from
// the language model. The model only picks names and quantities; this file
// does the maths and writes the exact sentence the agent must read back.
//
// Same rules as PriceKeeper: each customer has a list of entries, each entry
// is a debt (they took goods) or a payment (they paid). Balance = debts minus
// payments. Above zero they owe the shop. Below zero the shop is holding
// their money as a deposit.

export const SEED = {
  shop: { name: "Mama Bisi Provisions", city: "Lagos" },
  products: [
    { name: "Rice (50kg bag)", say: "rice", price: 3000, cost: 2500, unit: "bag", stock: 40 },
    { name: "Beans (half bag)", say: "beans", price: 22000, cost: 19000, unit: "half bag", stock: 12 },
    { name: "Indomie (carton)", say: "Indomie", price: 8500, cost: 7600, unit: "carton", stock: 25 },
    { name: "Groundnut oil (bottle)", say: "groundnut oil", price: 2200, cost: 1850, unit: "bottle", stock: 30 },
    { name: "Peak milk (pack)", say: "Peak milk", price: 1800, cost: 1550, unit: "pack", stock: 50 },
    { name: "Tomato paste (tin)", say: "tomato paste", price: 700, cost: 560, unit: "tin", stock: 80 },
    { name: "Golden Penny spaghetti (carton)", say: "Golden Penny spaghetti", price: 9500, cost: 8400, unit: "carton", stock: 15 },
    { name: "Garri (paint bucket)", say: "garri", price: 2500, cost: 2000, unit: "bucket", stock: 5 },
    { name: "Sugar (pack)", say: "sugar", price: 1500, cost: 1250, unit: "pack", stock: 40 },
    { name: "Semovita (10kg)", say: "Semovita", price: 11000, cost: 9800, unit: "bag", stock: 4 },
  ],
  customers: [
    { name: "Musa", entries: [{ type: "debt", amount: 4000, note: "2 packs of sugar and garri", ts: "2026-09-20T10:12:00Z" }] },
    { name: "Chinedu", entries: [{ type: "debt", amount: 13000, note: "Semovita and sugar", ts: "2026-09-18T15:40:00Z" }] },
    { name: "Aisha", entries: [] },
    { name: "Tunde", entries: [
      { type: "debt", amount: 8500, note: "Indomie carton", ts: "2026-09-15T09:05:00Z" },
      { type: "payment", amount: 10000, note: "Paid cash", ts: "2026-09-22T17:30:00Z" } ] },
    { name: "Blessing", entries: [] },
    { name: "Mama Ngozi", entries: [{ type: "debt", amount: 5400, note: "3 packs of Peak milk", ts: "2026-09-23T08:20:00Z" }] },
    { name: "Emeka", entries: [{ type: "debt", amount: 45000, note: "Rice and beans", ts: "2026-09-10T12:00:00Z" }] },
    { name: "Fatima", entries: [] },
    { name: "Oluwaseun", entries: [] },
    { name: "Ibrahim", entries: [{ type: "payment", amount: 3000, note: "Deposit", ts: "2026-09-24T11:00:00Z" }] },
  ],
  receipts: [],
  expenses: [],
  seq: 0,
};

export function freshState() {
  return JSON.parse(JSON.stringify(SEED));
}

// ---------- money ----------

export function round2(n) { return Math.round(n * 100) / 100; }

export function naira(n) {
  return "₦" + Math.round(n).toLocaleString("en-US");
}

// Spoken form, in words. Given digits the voice sometimes read "45000" as
// "four five zero zero zero", so amounts are handed over already in words.
export function spoken(n) {
  return inWords(Math.round(n)) + " naira";
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function inWords(n) {
  if (n < 0) return "minus " + inWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + inWords(n % 100) : "");
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= size) {
      const rest = n % size;
      return inWords(Math.floor(n / size)) + " " + name + (rest ? (rest < 100 ? " and " : " ") + inWords(rest) : "");
    }
  }
}

export function balanceOf(customer) {
  let debt = 0, paid = 0;
  for (const e of customer.entries) {
    if (e.type === "debt") debt += e.amount; else paid += e.amount;
  }
  const balance = round2(debt - paid);
  return { balance, owing: Math.max(0, balance), deposit: Math.max(0, -balance) };
}

export function standingText(name, balance) {
  if (balance > 0) return `${name} owes ${spoken(balance)}`;
  if (balance < 0) return `you are holding ${spoken(-balance)} for ${name}`;
  return `${name} owes nothing`;
}

function futureStandingText(name, balance) {
  if (balance > 0) return `${name} will owe ${spoken(balance)}`;
  if (balance < 0) return `you will be holding ${spoken(-balance)} for ${name}`;
  return `${name}'s account will be settled`;
}

// ---------- matching what was heard to what the shop has ----------

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const UNIT_WORDS = new Set(["tin", "tins", "bag", "bags", "pack", "packs", "carton", "cartons", "bottle", "bottles",
  "bucket", "buckets", "half", "kg", "10kg", "50kg", "paint", "sachet", "sachets", "crate", "crates"]);

function score(heard, target) {
  const h = norm(heard), t = norm(target);
  if (!h || !t) return 0;
  if (h === t) return 1;
  const tw = t.split(" "), hw = h.split(" ");
  if (hw.every(w => tw.includes(w))) return 0.95;          // "ngozi" -> "mama ngozi"
  if (tw.every(w => hw.includes(w))) return 0.9;           // "rice bag" -> "rice"
  if (t.startsWith(h) && h.length >= 3) return 0.88;
  let best = 0;                                            // a word or two misheard
  for (const a of hw) for (const b of tw) {
    if (UNIT_WORDS.has(a) || UNIT_WORDS.has(b)) continue;  // "tin" alone says nothing
    const m = Math.max(a.length, b.length);
    if (m >= 3) best = Math.max(best, 1 - lev(a, b) / m);
  }
  return best * 0.9;
}

// Returns { match } when one entry is clearly meant, or { candidates } when
// it is close between several, or { none: true }.
export function bestMatch(list, heard, fields) {
  const scored = list
    .map(item => ({ item, s: Math.max(...fields.map(f => score(heard, item[f] || ""))) }))
    .filter(x => x.s >= 0.6)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { none: true };
  const [top, next] = scored;
  if (top.s === 1 && (!next || next.s < 1)) return { match: top.item };
  if (top.s >= 0.8 && (!next || top.s - next.s >= 0.0999)) return { match: top.item };
  return { candidates: scored.slice(0, 3).map(x => x.item) };
}

const WALK_IN = /^(walk ?in|cash|no name|nobody|customer|none|)$/;

// ---------- drafts: prepared, read back, then saved only on yes ----------

export function draftSale(state, args) {
  const errs = [];
  const heardName = String(args.customer || "").trim();
  let customer = null, isNew = false;
  if (!WALK_IN.test(norm(heardName))) {
    const m = bestMatch(state.customers, heardName, ["name"]);
    if (m.match) customer = m.match;
    else if (args.add_new_customer) { isNew = true; customer = { name: titleCase(heardName), entries: [] }; }
    else if (m.candidates) return fail(`Customer '${heardName}' is unclear. Close names: ${m.candidates.map(c => c.name).join(", ")}. Ask which one they mean.`);
    else return fail(`No customer called '${heardName}'. Ask the owner if '${titleCase(heardName)}' is a new customer; if yes, call draft_sale again with add_new_customer true.`);
  }

  const items = Array.isArray(args.items) ? args.items : [];
  if (!items.length) return fail("No products given. Ask what was sold.");
  const lines = [];
  for (const it of items) {
    const qty = Number(it.quantity);
    if (!(qty > 0)) { errs.push(`quantity for '${it.product}' is missing`); continue; }
    const pm = bestMatch(state.products, it.product, ["name", "say"]);
    let product = pm.match || null;
    let unit = it.unit_price != null && it.unit_price !== "" ? Number(it.unit_price) : null;
    if (!product && pm.candidates && unit == null) { errs.push(`product '${it.product}' is unclear, close ones: ${pm.candidates.map(p => p.say).join(", ")}`); continue; }
    if (unit == null) {
      if (!product) { errs.push(`'${it.product}' is not in the stock list, ask its price`); continue; }
      unit = product.price;
    }
    if (!(unit > 0)) { errs.push(`price for '${it.product}' is missing`); continue; }
    // A price nothing like the shop's usual one is far more likely a
    // mishearing ("seventeen" for "seventeen thousand") than a real sale.
    if (!args.price_confirmed && it.unit_price != null) {
      const odd = product ? (unit < product.price / 4 || unit > product.price * 4) : unit < 50;
      if (odd) { errs.push(`the price ${spoken(unit)} for '${it.product}' looks wrong${product ? ` (usual price ${spoken(product.price)})` : ""}; ask the owner to say the price again, then call again with price_confirmed true if they repeat it`); continue; }
    }
    lines.push({
      product: product ? product.name : titleCase(it.product),
      say: product ? countOf(qty, product.unit, product.say) : `${qty} ${it.product}`,
      inStock: !!product,
      cost: product && product.cost != null ? product.cost : null,
      quantity: qty,
      unit_price: unit,
      line_total: round2(qty * unit),
    });
  }
  if (errs.length) return fail(`Could not prepare the sale: ${errs.join("; ")}. ${lines.length ? `Understood so far: ${lines.map(l => l.say).join(", ")}.` : ""} Ask only for what is missing.`);

  const gross = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const discount = Number(args.discount) > 0 ? round2(Number(args.discount)) : 0;
  if (discount >= gross) return fail(`A discount of ${spoken(discount)} is more than the sale itself (${spoken(gross)}). Ask the owner for the discount again.`);
  const total = round2(gross - discount);
  const paid = args.amount_paid != null && args.amount_paid !== "" ? Number(args.amount_paid) : (customer ? 0 : total);
  const method = paymentMethod(args.payment_method);
  if (!(paid >= 0)) return fail("amount_paid is not a number. Ask how much was paid.");
  if (!customer && paid < total) return fail(`A sale with no customer name must be paid in full (${spoken(total)}). Ask who the customer is, so the rest can go on their account.`);

  const before = customer ? balanceOf(customer).balance : 0;
  const after = round2(before + total - paid);
  const list = lines.map(l => `${l.say} at ${inWords(l.unit_price)}`).join(", ");
  let say = discount ? `${list}. Less ${inWords(discount)} discount, total ${spoken(total)}.` : `${list}. Total ${spoken(total)}.`;
  if (customer) {
    if (paid > 0) say += ` Paid ${spoken(paid)}${method !== "cash" ? " by " + METHOD_WORDS[method] : ""}.`;
    if (before < 0 && total > paid) say += ` Uses their deposit.`;
    say += ` ${cap(futureStandingText(customer.name, after))}.`;
    if (isNew) say += ` ${customer.name} is a new customer.`;
  } else say += method === "cash" ? " Paid in cash." : ` Paid by ${METHOD_WORDS[method]}.`;
  say += " Say yes.";

  const warn = lines.filter(l => l.inStock).map(l => {
    const p = state.products.find(x => x.name === l.product);
    return p.stock < l.quantity ? `Only ${p.stock} ${p.say} left in stock.` : null;
  }).filter(Boolean);
  if (warn.length) say = warn.join(" ") + " " + say;

  return { ok: true, draft: { kind: "sale", customer: customer ? customer.name : null, isNew, lines, gross, discount, total, paid, method, before, after, say } };
}

export function draftPayment(state, args) {
  const heardName = String(args.customer || "").trim();
  const amount = Number(args.amount);
  if (!(amount > 0)) return fail("Payment amount is missing. Ask how much was paid.");
  const m = bestMatch(state.customers, heardName, ["name"]);
  let customer = m.match, isNew = false;
  if (!customer) {
    if (args.add_new_customer && heardName) { isNew = true; customer = { name: titleCase(heardName), entries: [] }; }
    else if (m.candidates) return fail(`Customer '${heardName}' is unclear. Close names: ${m.candidates.map(c => c.name).join(", ")}. Ask which one.`);
    else return fail(`No customer called '${heardName}'. Ask if they are new; if yes call draft_payment again with add_new_customer true.`);
  }
  const before = balanceOf(customer).balance;
  const after = round2(before - amount);
  let say = `${customer.name} pays ${spoken(amount)}. `;
  if (after < 0 && before > 0) say += `That is more than they owed. `;
  say += `${cap(futureStandingText(customer.name, after))}. Say yes.`;
  return { ok: true, draft: { kind: "payment", customer: customer.name, isNew, amount, before, after, say } };
}

// Writes a confirmed draft into the books. Returns the receipt.
export function commit(state, draft, now = new Date()) {
  let customer = draft.customer ? state.customers.find(c => c.name === draft.customer) : null;
  if (draft.customer && !customer) {
    customer = { name: draft.customer, entries: [] };
    state.customers.push(customer);
  }
  // Receipt numbers start again at one each day, in the shop's own clock.
  const dayKey = localDay(now);
  if (state.seqDay !== dayKey) { state.seq = 0; state.seqDay = dayKey; }
  state.seq += 1;
  const ref = `GB-${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(state.seq).padStart(3, "0")}`;
  const ts = now.toISOString();
  if (draft.kind === "sale") {
    for (const l of draft.lines) {
      const p = state.products.find(x => x.name === l.product);
      if (p) p.stock = Math.max(0, p.stock - l.quantity);
    }
    if (customer) {
      const note = draft.lines.map(l => l.say).join(", ");
      customer.entries.push({ type: "debt", amount: draft.total, note, ts, ref });
      if (draft.paid > 0) customer.entries.push({ type: "payment", amount: draft.paid, note: "Paid at sale", ts, ref });
    }
  } else if (draft.kind === "payment") {
    customer.entries.push({ type: "payment", amount: draft.amount, note: "Payment", ts, ref });
  } else {
    return commitStock(state, draft, ref, ts);
  }
  const after = customer ? balanceOf(customer).balance : 0;
  const receipt = { ref, ts, kind: draft.kind, customer: draft.customer, lines: draft.lines || null,
    total: draft.total ?? null, paid: draft.kind === "sale" ? draft.paid : draft.amount, before: draft.before, after,
    discount: draft.discount || 0, method: draft.method || "cash", profit: draft.kind === "sale" ? saleProfit(draft) : null };
  state.receipts.unshift(receipt);
  let say = `Saved, receipt ${inWords(state.seq)}.${customer ? " " + cap(standingText(customer.name, after)) + "." : ""}`;
  if (draft.kind === "sale") say += lowStockNote(state, draft.lines);
  return { receipt, say };
}

// After a sale: warn if something just sold is nearly gone.
export const LOW_STOCK = 5;
export function lowStockNote(state, lines) {
  const seen = new Set(), out = [];
  for (const l of lines) {
    const p = state.products.find(x => x.name === l.product);
    if (!p || seen.has(p.name) || p.stock > LOW_STOCK) continue;
    seen.add(p.name);
    out.push(p.stock === 0 ? `${cap(p.say)} is finished` : `Only ${inWords(p.stock)} ${p.stock === 1 ? p.unit : p.unit + "s"} of ${p.say} left`);
  }
  return out.length ? " " + out.join(". ") + "." : "";
}

// The end-of-day debrief: today's totals, who owes, and what is running low.
// `say` is what the voice reads out; `text` is the same day written down, to
// keep or send on WhatsApp. Every figure comes from the books.
export function dailyClose(state, now = new Date()) {
  const from = periodStart("today", now);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  const day = summary(state, from, to);
  const owing = debtors(state, now);
  const owed = round2(owing.reduce((s, d) => s + d.balance, 0));
  const low = state.products.filter(p => p.stock <= LOW_STOCK).sort((a, b) => a.stock - b.stock);

  let say = day.say;
  say += owing.length
    ? ` ${cap(inWords(owing.length))} ${owing.length === 1 ? "person owes" : "people owe"} you ${spoken(owed)} in all. The biggest: ${owing.slice(0, 3).map(d => `${d.name}, ${spoken(d.balance)}`).join("; ")}.`
    : " Nobody owes you anything.";
  say += low.length ? ` Running low: ${low.map(p => `${p.say}, ${p.stock} left`).join("; ")}.` : " Nothing is running low.";

  const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const out = [`*${state.shop.name}*`, `Day closed, ${date}`, ""];
  if (day.sales || day.spent) {
    out.push(`Sales: ${day.sales}, ${naira(day.sold)}`, `Money in: ${naira(day.cash)}`);
    if (day.credit > 0) out.push(`On credit: ${naira(day.credit)}`);
    if (day.spent) out.push(`Spent: ${naira(day.spent)}`);
    if (day.sales) out.push(`Profit: ${naira(day.profit)}`);
  } else out.push("Nothing recorded today.");
  out.push("");
  out.push(owing.length ? `Owed to me: ${naira(owed)} (${owing.length} ${owing.length === 1 ? "person" : "people"})` : "Nobody owes me.");
  for (const d of owing.slice(0, 5)) out.push(`- ${d.name}: ${naira(d.balance)}`);
  if (low.length) out.push("", "Running low:", ...low.map(p => `- ${p.say}: ${p.stock} left`));
  return { say, text: out.join("\n") };
}

// Plain text of a receipt, ready to send to the customer on WhatsApp.
export function receiptText(state, r) {
  const day = new Date(r.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const out = [`*${state.shop.name}*`, `Receipt ${r.ref}, ${day}`, ""];
  if (r.kind === "sale") {
    for (const l of r.lines) out.push(`${l.quantity} x ${l.product}: ${naira(l.line_total)}`);
    if (r.discount) out.push(`Discount: ${naira(r.discount)}`);
    out.push(`*Total: ${naira(r.total)}*`);
    if (r.customer && r.paid > 0) out.push(`Paid: ${naira(r.paid)}`);
  } else if (r.kind === "payment") {
    out.push(`Payment received: ${naira(r.paid)}`);
  } else return "";
  if (r.customer) {
    out.push(r.after > 0 ? `Balance you owe: ${naira(r.after)}` : r.after < 0 ? `Credit with us: ${naira(-r.after)}` : "Your account is settled.");
  }
  out.push("", "Thank you!");
  return out.join("\n");
}

// Takes a saved receipt back out of the books: its account entries go and
// sold stock returns to the shelf.
export function undo(state, ref) {
  const i = ref ? state.receipts.findIndex(r => r.ref === ref) : 0;
  const r = state.receipts[i];
  if (!r || (!ref && r.seeded)) return { ok: false, error: "There is nothing saved to undo." };
  if (r.kind === "sale") for (const l of r.lines) {
    const p = state.products.find(x => x.name === l.product);
    if (p) p.stock += l.quantity;
  }
  if (["restock", "product", "price", "expense"].includes(r.kind)) {
    undoStock(state, r);
    state.receipts.splice(i, 1);
    return { ok: true, receipt: r, say: `Undone. ${cap(stockWhat(r))} is removed.` };
  }
  const c = r.customer ? state.customers.find(x => x.name === r.customer) : null;
  if (c) c.entries = c.entries.filter(e => e.ref !== r.ref);
  state.receipts.splice(i, 1);
  const what = r.kind === "sale" ? `the ${spoken(r.total)} sale` : `the ${spoken(r.paid)} payment`;
  return { ok: true, receipt: r, say: `Undone. ${cap(what)}${r.customer ? ` for ${r.customer}` : ""} is removed.${c ? " " + cap(standingText(c.name, balanceOf(c).balance)) + "." : ""}` };
}

// Sales, the cash that actually came in, and what went out on credit, over
// any stretch of receipts (from inclusive, to exclusive). label sets the
// word the say text opens and closes with, e.g. "Today" or "This week".
export function summary(state, from, to = new Date(), label = "Today") {
  const fromIso = from.toISOString(), toIso = to.toISOString();
  const receipts = state.receipts.filter(r => r.ts >= fromIso && r.ts < toIso);
  const sales = receipts.filter(r => r.kind === "sale");
  const sold = round2(sales.reduce((s, r) => s + r.total, 0));
  const cash = round2(receipts.filter(r => r.kind === "sale" || r.kind === "payment").reduce((s, r) => s + (r.paid || 0), 0));
  const spent = round2(receipts.filter(r => r.kind === "expense").reduce((s, r) => s + r.total, 0));
  const known = sales.filter(r => r.profit != null);
  const profit = round2(known.reduce((s, r) => s + r.profit, 0));
  const credit = round2(sales.filter(r => r.customer).reduce((s, r) => s + Math.max(0, r.total - r.paid), 0));
  const when = label === "Today" ? "today" : label.toLowerCase();
  if (!sales.length && !spent && !receipts.some(r => r.kind === "payment")) return { sales: 0, sold: 0, cash: 0, credit: 0, profit: 0, spent, say: spent ? `No sales yet ${when}. Spent ${spoken(spent)}.` : `Nothing recorded ${when} yet.` };
  let say = `${label}: ${sales.length} ${sales.length === 1 ? "sale" : "sales"}, ${spoken(sold)}. Money in, ${spoken(cash)}.`;
  if (credit > 0) say += ` On credit, ${spoken(credit)}.`;
  if (known.length) say += ` Profit${known.length < sales.length ? " on what I know the cost of" : ""}, ${spoken(profit)}.`;
  if (spent) say += ` Spent, ${spoken(spent)}.`;
  return { sales: sales.length, sold, cash, credit, profit, spent, say };
}

// "How much I make today?" Sales, the cash that actually came in, and what
// went out on credit, from today's receipts only.
export function todaySummary(state, now = new Date()) {
  const from = periodStart("today", now);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return summary(state, from, to);
}

// Start of "today", "week" (the last 7 days including today) or "month"
// (the last 30 days including today), at midnight on the device's own clock,
// so a Lagos shop's "today" starts at midnight Lagos time, not 01:00.
export function periodStart(period, now = new Date()) {
  const back = period === "week" ? 6 : period === "month" ? 29 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
}

export function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Everyone who currently owes money, worst first, with how many whole days
// their oldest still-unpaid debt has been sitting. Payments pay off the
// oldest debt first (FIFO), same order the money actually came in.
export function debtors(state, now = new Date()) {
  const nowMs = now.getTime();
  const list = [];
  for (const c of state.customers) {
    const { balance } = balanceOf(c);
    if (balance <= 0) continue;
    const entries = [...c.entries].sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const debts = [];
    let credit = 0; // money paid ahead (a deposit), used on the next debts
    for (const e of entries) {
      if (e.type === "debt") {
        const take = Math.min(credit, e.amount);
        credit -= take;
        debts.push({ remaining: e.amount - take, ts: e.ts });
        continue;
      }
      let pay = e.amount;
      for (const d of debts) {
        if (pay <= 0) break;
        const take = Math.min(d.remaining, pay);
        d.remaining -= take;
        pay -= take;
      }
      credit += pay;
    }
    const oldest = debts.find(d => d.remaining > 0.01);
    const days = oldest ? Math.max(0, Math.floor((nowMs - new Date(oldest.ts).getTime()) / 86400000)) : 0;
    list.push({ name: c.name, balance, days });
  }
  return list.sort((a, b) => b.balance - a.balance);
}

// Realistic trading history for the 14 days before "now" (never today), so
// a demo starts with a shop that already has a past. Ends with every
// customer balance and product stock exactly back at freshState()'s values,
// so the sample data the demo script relies on still holds.
export function seedHistory(state, now = new Date()) {
  const initialBalances = new Map(state.customers.map(c => [c.name, balanceOf(c).balance]));
  const initialStock = new Map(state.products.map(p => [p.name, p.stock]));

  const at = (daysAgo, hour, min = 0) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, hour, min, 0));
  const draft = (fn, args) => { const r = fn(state, args); if (!r.ok) throw new Error("seedHistory: " + r.error); return r.draft; };
  const sale = (daysAgo, hour, args) => commit(state, draft(draftSale, args), at(daysAgo, hour));
  const payment = (daysAgo, hour, args) => commit(state, draft(draftPayment, args), at(daysAgo, hour));
  const restock = (daysAgo, hour, args) => commit(state, draft(draftRestock, args), at(daysAgo, hour));
  const expense = (daysAgo, hour, args) => commit(state, draft(draftExpense, args), at(daysAgo, hour));

  // Every customer's credit in this story is paid back inside it, and every
  // product sold is restocked by the same count, so balances and stock end
  // exactly where freshState() had them without any made-up "correction"
  // receipts. Hours are UTC; the shop is in Lagos (UTC+1).
  sale(13, 8, { customer: "", items: [{ product: "rice", quantity: 2 }] });
  sale(13, 11, { customer: "Musa", items: [{ product: "rice", quantity: 1 }] });
  expense(13, 18, { amount: 500, what: "transport" });

  sale(12, 10, { customer: "", items: [{ product: "Indomie", quantity: 1 }], payment_method: "pos" });
  sale(12, 14, { customer: "", items: [{ product: "Peak milk", quantity: 3 }, { product: "tomato paste", quantity: 6 }] });

  sale(11, 12, { customer: "Tunde", items: [{ product: "beans", quantity: 1 }], amount_paid: 22000, payment_method: "transfer" });

  restock(10, 8, { product: "rice", quantity: 7, supplier: "Alhaji Sule" });
  payment(10, 17, { customer: "Musa", amount: 3000 });
  expense(10, 19, { amount: 1000, what: "market levy" });

  sale(9, 10, { customer: "Mama Ngozi", items: [{ product: "Indomie", quantity: 1 }] });
  sale(9, 15, { customer: "", items: [{ product: "groundnut oil", quantity: 2 }] });

  sale(8, 9, { customer: "Emeka", items: [{ product: "rice", quantity: 1 }] });
  sale(8, 16, { customer: "", items: [{ product: "groundnut oil", quantity: 1 }], payment_method: "transfer" });

  sale(7, 11, { customer: "", items: [{ product: "Indomie", quantity: 1 }] });
  expense(7, 18, { amount: 700, what: "nylon bags" });

  restock(6, 8, { product: "Indomie", quantity: 5, supplier: "Chuks Distributors" });
  sale(6, 13, { customer: "Chinedu", items: [{ product: "Peak milk", quantity: 2 }] });

  sale(5, 9, { customer: "Musa", items: [{ product: "rice", quantity: 1 }], amount_paid: 3000 });
  payment(5, 16, { customer: "Mama Ngozi", amount: 8500 });

  sale(4, 10, { customer: "", items: [{ product: "tomato paste", quantity: 6 }, { product: "groundnut oil", quantity: 1 }] });
  payment(4, 17, { customer: "Emeka", amount: 3000 });

  sale(3, 9, { customer: "", items: [{ product: "rice", quantity: 2 }], payment_method: "transfer" });
  expense(3, 19, { amount: 600, what: "transport" });

  restock(2, 8, { product: "Peak milk", quantity: 5 });
  restock(2, 8, { product: "tomato paste", quantity: 12 });
  payment(2, 15, { customer: "Chinedu", amount: 3600 });
  sale(2, 16, { customer: "", items: [{ product: "beans", quantity: 1 }], payment_method: "pos" });

  sale(1, 9, { customer: "", items: [{ product: "Indomie", quantity: 2 }] });
  restock(1, 10, { product: "groundnut oil", quantity: 4 });
  restock(1, 17, { product: "beans", quantity: 2, supplier: "Alhaji Sule" });

  // The demo script depends on freshState()'s balances and stock. If the
  // story above ever stops netting to zero, fail loudly rather than invent
  // odd receipts to paper over it.
  for (const c of state.customers) {
    if (round2(balanceOf(c).balance - (initialBalances.get(c.name) ?? 0)) !== 0) throw new Error("seedHistory: balance drifted for " + c.name);
  }
  for (const p of state.products) {
    if (p.stock !== initialStock.get(p.name)) throw new Error("seedHistory: stock drifted for " + p.name);
  }
  for (const r of state.receipts) r.seeded = true;

  state.seq = 0; state.seqDay = null; // the owner's first save today is "receipt one"
  state.seeded = true;
  return state;
}

// A sample shop that already has two weeks of trading behind it, for demos.
export function demoState(now = new Date()) {
  return seedHistory(freshState(), now);
}

// "Remind Emeka": a polite message the owner sends from their own WhatsApp.
// Nothing is sent by the app itself.
export function reminder(state, heard) {
  const m = bestMatch(state.customers, heard, ["name"]);
  if (!m.match) return fail(m.candidates ? `Unclear, close names: ${m.candidates.map(c => c.name).join(", ")}. Ask which.` : `No customer called '${heard}'.`);
  const c = m.match, b = balanceOf(c).balance;
  if (b <= 0) return { ok: true, customer: c.name, text: null, say: `${c.name} owes nothing, so there is nothing to remind.` };
  const text = `Hello ${c.name}, this is ${state.shop.name}. Your balance with us is ${naira(b)}. Thank you for your custom.`;
  return { ok: true, customer: c.name, text, say: `The reminder for ${c.name} is ready on your screen. ${c.name} owes ${spoken(b)}. Tap send on WhatsApp.` };
}

// The words AssemblyAI should listen hardest for: this shop's own customers
// and products. Capped at the API's 100 terms of 50 characters each.
export function shopKeyterms(state) {
  const terms = new Set();
  for (const c of state.customers) terms.add(c.name);
  for (const p of state.products) terms.add(p.say);
  return [...terms].filter(t => t && t.length <= 50).slice(0, 100);
}

// "2 bags of rice", "1 carton of Indomie"
function countOf(qty, unit, name) {
  if (!unit) return `${qty} ${name}`;
  return `${qty} ${qty === 1 ? unit : unit + "s"} of ${name}`;
}

function fail(error) { return { ok: false, error }; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function titleCase(s) { return String(s).trim().replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

// ---------- stock, prices and expenses ----------

const METHOD_WORDS = { cash: "cash", transfer: "transfer", pos: "P O S" };
function paymentMethod(heard) {
  const h = norm(heard);
  if (/transfer|bank|send/.test(h)) return "transfer";
  if (/pos|card|p o s/.test(h)) return "pos";
  return "cash";
}

// Profit on a sale is only known when every line's buying price is known.
function saleProfit(d) {
  if (d.lines.some(l => l.cost == null)) return null;
  return round2(d.lines.reduce((s, l) => s + (l.unit_price - l.cost) * l.quantity, 0) - (d.discount || 0));
}

function findProduct(state, heard) {
  const m = bestMatch(state.products, heard, ["name", "say"]);
  if (m.match) return { product: m.match };
  if (m.candidates) return fail(`Product '${heard}' is unclear. Close ones: ${m.candidates.map(p => p.say).join(", ")}. Ask which.`);
  return fail(`'${heard}' is not in the stock list. Ask if it is a new product; if yes use draft_new_product.`);
}

// "Add 20 bags of rice, I bought at 2,500 each": stock goes up, and the
// buying price becomes the average of old and new stock.
export function draftRestock(state, args) {
  const qty = Number(args.quantity);
  if (!(qty > 0)) return fail("How many were added is missing. Ask the quantity.");
  const f = findProduct(state, args.product);
  if (!f.product) return f;
  const p = f.product;
  // No price said: the owner means the usual buying price already saved.
  const said = args.unit_cost != null && args.unit_cost !== "";
  const unitCost = said ? Number(args.unit_cost) : p.cost ?? null;
  if (unitCost != null && !(unitCost > 0)) return fail("The buying price is not a number. Ask what they paid for each.");
  if (unitCost != null && !args.price_confirmed && p.cost && (unitCost < p.cost / 4 || unitCost > p.cost * 4))
    return fail(`The buying price ${spoken(unitCost)} for ${p.say} looks wrong (last time ${spoken(p.cost)}). Ask the owner to say it again, then call again with price_confirmed true if they repeat it.`);
  const newCost = unitCost == null ? p.cost ?? null
    : p.cost == null || p.stock <= 0 ? unitCost
    : round2((p.stock * p.cost + qty * unitCost) / (p.stock + qty));
  let say = `Add ${countOf(qty, p.unit, p.say)}`;
  if (unitCost != null) say += ` at ${said ? "" : "your usual "}${inWords(unitCost)} each, ${spoken(qty * unitCost)} in all`;
  if (args.supplier) say += `, from ${titleCase(args.supplier)}`;
  say += `. Stock goes from ${p.stock} to ${p.stock + qty}. Say yes.`;
  if (unitCost != null && unitCost >= p.price) say = `Careful, you pay ${inWords(unitCost)} but sell at ${inWords(p.price)}. ` + say;
  return { ok: true, draft: { kind: "restock", product: p.name, quantity: qty, unit_cost: unitCost, total: unitCost == null ? 0 : round2(qty * unitCost),
    supplier: args.supplier ? titleCase(args.supplier) : null, prevCost: p.cost ?? null, newCost, say } };
}

export const MARKUP = 0.065;
// Cost plus 6.5%, rounded to the nearest 10 naira (nearest 1 under 1,000),
// which keeps the margin between 6 and 7% for normal shop prices.
export function autoPrice(cost) {
  const raw = cost * (1 + MARKUP);
  return cost >= 1000 ? Math.round(raw / 10) * 10 : Math.round(raw);
}

export function draftNewProduct(state, args) {
  const name = String(args.name || "").trim();
  if (!name) return fail("The product name is missing. Ask for it.");
  const cost = Number(args.unit_cost) > 0 ? Number(args.unit_cost) : null;
  // Only the buying price said: sell at the shop's usual markup (6 to 7%).
  const auto = !(Number(args.sell_price) > 0) && cost != null;
  const price = auto ? autoPrice(cost) : Number(args.sell_price);
  if (!(price > 0)) return fail("The price is missing. Ask what they bought it for (the selling price is then set automatically), or what it sells for.");
  const m = bestMatch(state.products, name, ["name", "say"]);
  if (m.match && norm(m.match.say) === norm(name)) return fail(`'${m.match.say}' is already in the stock list. To add more of it use draft_restock; to change its price use draft_price_change.`);
  const stock = Number(args.quantity) > 0 ? Number(args.quantity) : 0;
  const unit = args.unit ? String(args.unit).trim().toLowerCase() : "";
  const say = `New product ${titleCase(name)}, selling at ${spoken(price)}${auto ? " (your usual markup)" : ""}${unit ? " a " + unit : ""}${cost ? `, bought at ${inWords(cost)}` : ""}${stock ? `, ${stock} in stock` : ""}. Say yes.`;
  // "Milo tin" sold in tins is spoken "2 tins of Milo", not "2 tins of Milo Tin".
  const words = titleCase(name).split(" ");
  const sayName = words.length > 1 && unit && words[words.length - 1].toLowerCase().replace(/s$/, "") === unit.replace(/s$/, "")
    ? words.slice(0, -1).join(" ") : titleCase(name);
  return { ok: true, draft: { kind: "product", product: titleCase(name), item: { name: titleCase(name), say: sayName, price, cost, unit, stock }, say } };
}

export function draftPriceChange(state, args) {
  const f = findProduct(state, args.product);
  if (!f.product) return f;
  const p = f.product;
  const price = Number(args.sell_price);
  if (!(price > 0)) return fail("The new price is missing. Ask for it.");
  if (!args.price_confirmed && (price < p.price / 4 || price > p.price * 4))
    return fail(`${spoken(price)} for ${p.say} looks wrong (now ${spoken(p.price)}). Ask the owner to say it again, then call again with price_confirmed true if they repeat it.`);
  let say = `${cap(p.say)} goes from ${inWords(p.price)} to ${spoken(price)}. Say yes.`;
  if (p.cost && price <= p.cost) say = `Careful, that is not more than the ${inWords(p.cost)} you paid. ` + say;
  return { ok: true, draft: { kind: "price", product: p.name, from: p.price, to: price, say } };
}

export function draftExpense(state, args) {
  const amount = Number(args.amount);
  if (!(amount > 0)) return fail("The amount spent is missing. Ask how much.");
  const note = String(args.what || "").trim() || "expense";
  return { ok: true, draft: { kind: "expense", note, total: amount, say: `Spent ${spoken(amount)} on ${note}. Say yes.` } };
}

// "How many rice remain?" for one product, or what is running low.
export function stockReport(state, heard) {
  if (heard && String(heard).trim()) {
    const f = findProduct(state, heard);
    if (!f.product) return f;
    const p = f.product;
    return { ok: true, say: `${countOf(p.stock, p.unit, p.say)} left, selling at ${spoken(p.price)}.`.replace(/^./, c => c.toUpperCase()) };
  }
  const low = state.products.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock);
  if (!low.length) return { ok: true, say: "Nothing is running low. Everything has more than five left." };
  return { ok: true, say: "Running low: " + low.map(p => `${p.say}, ${p.stock} left`).join("; ") + "." };
}

function commitStock(state, d, ref, ts) {
  let what;
  if (d.kind === "restock") {
    const p = state.products.find(x => x.name === d.product);
    p.stock += d.quantity;
    if (d.newCost != null) p.cost = d.newCost;
    what = `${p.say} is now ${p.stock}`;
  } else if (d.kind === "product") {
    state.products.push({ ...d.item });
    what = `${d.item.say} is in the stock list`;
  } else if (d.kind === "price") {
    const p = state.products.find(x => x.name === d.product);
    p.price = d.to;
    what = `${p.say} now sells at ${spoken(d.to)}`;
  } else {
    (state.expenses ||= []).push({ amount: d.total, note: d.note, ts, ref });
    what = `spent ${spoken(d.total)} on ${d.note}`;
  }
  const receipt = { ref, ts, kind: d.kind, product: d.product || null, quantity: d.quantity ?? null, unit_cost: d.unit_cost ?? null,
    supplier: d.supplier || null, prevCost: d.prevCost ?? null, item: d.item || null, from: d.from ?? null, to: d.to ?? null,
    note: d.note || null, total: d.total ?? null, customer: null, paid: 0 };
  state.receipts.unshift(receipt);
  return { receipt, say: `Saved. ${cap(what)}.` };
}

function undoStock(state, r) {
  const p = r.product ? state.products.find(x => x.name === r.product) : null;
  if (r.kind === "restock" && p) { p.stock = Math.max(0, p.stock - r.quantity); if (r.prevCost != null) p.cost = r.prevCost; }
  if (r.kind === "product") state.products = state.products.filter(x => x.name !== r.product);
  if (r.kind === "price" && p) p.price = r.from;
  if (r.kind === "expense") state.expenses = (state.expenses || []).filter(e => e.ref !== r.ref);
}

function stockWhat(r) {
  if (r.kind === "restock") return `the restock of ${r.quantity} ${r.product}`;
  if (r.kind === "product") return `the new product ${r.product}`;
  if (r.kind === "price") return `the price change for ${r.product}`;
  return `the ${spoken(r.total)} spent on ${r.note}`;
}
