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
    { name: "Rice (50kg bag)", say: "rice", price: 3000, unit: "bag", stock: 40 },
    { name: "Beans (half bag)", say: "beans", price: 22000, unit: "half bag", stock: 12 },
    { name: "Indomie (carton)", say: "Indomie", price: 8500, unit: "carton", stock: 25 },
    { name: "Groundnut oil (bottle)", say: "groundnut oil", price: 2200, unit: "bottle", stock: 30 },
    { name: "Peak milk (pack)", say: "Peak milk", price: 1800, unit: "pack", stock: 50 },
    { name: "Tomato paste (tin)", say: "tomato paste", price: 700, unit: "tin", stock: 80 },
    { name: "Golden Penny spaghetti (carton)", say: "Golden Penny spaghetti", price: 9500, unit: "carton", stock: 15 },
    { name: "Garri (paint bucket)", say: "garri", price: 2500, unit: "bucket", stock: 20 },
    { name: "Sugar (pack)", say: "sugar", price: 1500, unit: "pack", stock: 40 },
    { name: "Semovita (10kg)", say: "Semovita", price: 11000, unit: "bag", stock: 10 },
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

// Spoken form. Digits with commas are read correctly by the voice.
export function spoken(n) {
  return Math.round(n).toLocaleString("en-US") + " naira";
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
  if (top.s >= 0.8 && (!next || top.s - next.s >= 0.1)) return { match: top.item };
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
    lines.push({
      product: product ? product.name : titleCase(it.product),
      say: product ? countOf(qty, product.unit, product.say) : `${qty} ${it.product}`,
      inStock: !!product,
      quantity: qty,
      unit_price: unit,
      line_total: round2(qty * unit),
    });
  }
  if (errs.length) return fail(`Could not prepare the sale: ${errs.join("; ")}. ${lines.length ? `Understood so far: ${lines.map(l => l.say).join(", ")}.` : ""} Ask only for what is missing.`);

  const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const paid = args.amount_paid != null && args.amount_paid !== "" ? Number(args.amount_paid) : (customer ? 0 : total);
  if (!(paid >= 0)) return fail("amount_paid is not a number. Ask how much was paid.");
  if (!customer && paid < total) return fail(`A sale with no customer name must be paid in full (${spoken(total)}). Ask who the customer is, so the rest can go on their account.`);

  const before = customer ? balanceOf(customer).balance : 0;
  const after = round2(before + total - paid);
  const list = lines.map(l => `${l.say} at ${spoken(l.unit_price)}`).join(", ");
  let say = `${list}. Total ${spoken(total)}.`;
  if (customer) {
    if (paid > 0) say += ` Paid ${spoken(paid)}.`;
    if (before < 0 && total > paid) say += ` Uses their deposit.`;
    say += ` ${cap(futureStandingText(customer.name, after))}.`;
    if (isNew) say += ` ${customer.name} is a new customer.`;
  } else say += " Paid in cash.";
  say += " Say yes to save.";

  const warn = lines.filter(l => l.inStock).map(l => {
    const p = state.products.find(x => x.name === l.product);
    return p.stock < l.quantity ? `Only ${p.stock} ${p.say} left in stock.` : null;
  }).filter(Boolean);
  if (warn.length) say = warn.join(" ") + " " + say;

  return { ok: true, draft: { kind: "sale", customer: customer ? customer.name : null, isNew, lines, total, paid, before, after, say } };
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
  if (before > 0) say += `They owed ${spoken(before)}. `;
  if (after < 0 && before > 0) say += `That is ${spoken(-after)} more than they owed. `;
  say += `${cap(futureStandingText(customer.name, after))}. Say yes to save.`;
  return { ok: true, draft: { kind: "payment", customer: customer.name, isNew, amount, before, after, say } };
}

// Writes a confirmed draft into the books. Returns the receipt.
export function commit(state, draft, now = new Date()) {
  let customer = draft.customer ? state.customers.find(c => c.name === draft.customer) : null;
  if (draft.customer && !customer) {
    customer = { name: draft.customer, entries: [] };
    state.customers.push(customer);
  }
  state.seq += 1;
  const ref = `PKV-${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(state.seq).padStart(3, "0")}`;
  const ts = now.toISOString();
  if (draft.kind === "sale") {
    for (const l of draft.lines) {
      const p = state.products.find(x => x.name === l.product);
      if (p) p.stock = Math.max(0, p.stock - l.quantity);
    }
    if (customer) {
      const note = draft.lines.map(l => `${l.quantity} ${l.say}`).join(", ");
      customer.entries.push({ type: "debt", amount: draft.total, note, ts, ref });
      if (draft.paid > 0) customer.entries.push({ type: "payment", amount: draft.paid, note: "Paid at sale", ts, ref });
    }
  } else {
    customer.entries.push({ type: "payment", amount: draft.amount, note: "Payment", ts, ref });
  }
  const after = customer ? balanceOf(customer).balance : 0;
  const receipt = { ref, ts, kind: draft.kind, customer: draft.customer, lines: draft.lines || null,
    total: draft.total ?? null, paid: draft.kind === "sale" ? draft.paid : draft.amount, before: draft.before, after };
  state.receipts.unshift(receipt);
  const say = `Saved. Receipt ${ref.split("-").pop()}. ${customer ? cap(standingText(customer.name, after)) + "." : ""}`;
  return { receipt, say };
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
