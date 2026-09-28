import test from "node:test";
import assert from "node:assert/strict";
import { freshState, draftSale, draftPayment, commit, balanceOf, bestMatch, shopKeyterms, inWords, undo, todaySummary, reminder, draftRestock, draftNewProduct, draftPriceChange, draftExpense, stockReport, summary, periodStart, debtors, seedHistory, demoState } from "../public/ledger.js";

const bal = (s, name) => balanceOf(s.customers.find(c => c.name === name)).balance;

test("the Musa sale: 2 rice at 3,000 on his account", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 2, unit_price: 3000 }] });
  assert.ok(r.ok);
  assert.equal(r.draft.total, 6000);
  assert.equal(r.draft.before, 4000);
  assert.equal(r.draft.after, 10000);
  assert.equal(r.draft.say, "2 bags of rice at three thousand. Total six thousand naira. Musa will owe ten thousand naira. Say yes.");
  assert.equal(bal(s, "Musa"), 4000, "a draft must not touch the books");
  const c = commit(s, r.draft, new Date("2026-09-26T09:00:00Z"));
  assert.equal(bal(s, "Musa"), 10000);
  assert.equal(c.receipt.ref, "GB-0926-001");
  assert.equal(s.products.find(p => p.say === "rice").stock, 38);
});

test("price comes from the stock list when not said", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Aisha", items: [{ product: "Indomie", quantity: 1 }] });
  assert.equal(r.draft.total, 8500);
});

test("13,000 is never read as 3,000: amounts pass through untouched", () => {
  const s = freshState();
  const r = draftPayment(s, { customer: "Chinedu", amount: 13000 });
  assert.equal(r.draft.after, 0);
  assert.match(r.draft.say, /Chinedu's account will be settled/);
});

test("overpayment becomes a deposit", () => {
  const s = freshState();
  const r = draftPayment(s, { customer: "Musa", amount: 7000 });
  assert.equal(r.draft.after, -3000);
  assert.match(r.draft.say, /more than they owed/);
  assert.match(r.draft.say, /holding three thousand naira for Musa/);
});

test("a deposit is used up by the next sale", () => {
  const s = freshState();
  assert.equal(bal(s, "Ibrahim"), -3000);
  const r = draftSale(s, { customer: "Ibrahim", items: [{ product: "sugar", quantity: 1 }] });
  assert.equal(r.draft.after, -1500);
  assert.match(r.draft.say, /Uses their deposit/);
});

test("part payment at the sale", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Blessing", items: [{ product: "groundnut oil", quantity: 3, unit_price: 2200 }], amount_paid: 5000 });
  assert.equal(r.draft.total, 6600);
  assert.equal(r.draft.after, 1600);
  commit(s, r.draft);
  const e = s.customers.find(c => c.name === "Blessing").entries;
  assert.deepEqual(e.map(x => [x.type, x.amount]), [["debt", 6600], ["payment", 5000]]);
});

test("names: close mishearing still finds the customer", () => {
  const s = freshState();
  assert.equal(bestMatch(s.customers, "Ngozi", ["name"]).match.name, "Mama Ngozi");
  assert.equal(bestMatch(s.customers, "Oluwaseyun", ["name"]).match.name, "Oluwaseun");
  assert.equal(bestMatch(s.customers, "Emeka.", ["name"]).match.name, "Emeka");
});

test("unknown customer is not invented without permission", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Bola", items: [{ product: "rice", quantity: 1 }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /new customer/);
  const r2 = draftSale(s, { customer: "Bola", items: [{ product: "rice", quantity: 1 }], add_new_customer: true });
  assert.ok(r2.ok);
  commit(s, r2.draft);
  assert.equal(bal(s, "Bola"), 3000);
});

test("walk-in sale must be paid in full and touches no account", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "", items: [{ product: "tomato paste", quantity: 6, unit_price: 700 }] });
  assert.ok(r.ok);
  assert.equal(r.draft.paid, 4200);
  assert.match(r.draft.say, /Paid in cash/);
  const r2 = draftSale(s, { customer: "walk-in", items: [{ product: "rice", quantity: 1 }], amount_paid: 1000 });
  assert.equal(r2.ok, false);
});

test("missing price for an unknown product asks for it", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Musa", items: [{ product: "detergent", quantity: 2 }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /ask its price/);
});

test("keyterms are this shop's names and products, within API limits", () => {
  const k = shopKeyterms(freshState());
  assert.ok(k.includes("Musa") && k.includes("Indomie") && k.includes("Mama Ngozi"));
  assert.ok(k.length <= 100 && k.every(t => t.length <= 50));
});

test("amounts are spoken in words, so the voice cannot read digits one by one", () => {
  assert.equal(inWords(3000), "three thousand");
  assert.equal(inWords(13000), "thirteen thousand");
  assert.equal(inWords(8500), "eight thousand five hundred");
  assert.equal(inWords(2200), "two thousand two hundred");
  assert.equal(inWords(45000), "forty-five thousand");
  assert.equal(inWords(1050), "one thousand and fifty");
  assert.equal(inWords(250000), "two hundred and fifty thousand");
  assert.equal(inWords(1500000), "one million five hundred thousand");
});

test("a price nothing like the usual one is questioned, not saved", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Emeka", items: [{ product: "rice", quantity: 1, unit_price: 17 }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /looks wrong \(usual price three thousand naira\)/);
  const r2 = draftSale(s, { customer: "Emeka", items: [{ product: "rice", quantity: 1, unit_price: 17 }], price_confirmed: true });
  assert.ok(r2.ok, "owner repeated it, so it is allowed");
  const r3 = draftSale(s, { customer: "Aisha", items: [{ product: "matches", quantity: 1, unit_price: 72 }] });
  assert.ok(r3.ok, "72 naira is a normal price for a small item not in the stock list");
  const r4 = draftSale(s, { customer: "Aisha", items: [{ product: "rice", quantity: 1, unit_price: 2800 }] });
  assert.ok(r4.ok, "a small discount is fine");
});

test("undo takes the last save back out, stock included", () => {
  const s = freshState();
  commit(s, draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 2 }] }).draft);
  commit(s, draftPayment(s, { customer: "Emeka", amount: 25000 }).draft);
  assert.equal(bal(s, "Emeka"), 20000);
  let r = undo(s);
  assert.match(r.say, /Undone. The twenty-five thousand naira payment for Emeka is removed. Emeka owes forty-five thousand naira./);
  assert.equal(bal(s, "Emeka"), 45000);
  r = undo(s);
  assert.equal(bal(s, "Musa"), 4000);
  assert.equal(s.products.find(p => p.say === "rice").stock, 40);
  assert.equal(undo(s).ok, false);
});

test("today's summary counts only today's receipts", () => {
  const s = freshState();
  assert.equal(todaySummary(s, new Date("2026-09-26T12:00:00Z")).say, "Nothing recorded today yet.");
  commit(s, draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 2 }] }).draft, new Date("2026-09-26T09:00:00Z"));
  commit(s, draftSale(s, { customer: "", items: [{ product: "sugar", quantity: 2 }] }).draft, new Date("2026-09-26T10:00:00Z"));
  commit(s, draftPayment(s, { customer: "Emeka", amount: 20000 }).draft, new Date("2026-09-26T11:00:00Z"));
  commit(s, draftSale(s, { customer: "Aisha", items: [{ product: "rice", quantity: 1 }] }).draft, new Date("2026-09-25T11:00:00Z"));
  const t = todaySummary(s, new Date("2026-09-26T18:00:00Z"));
  assert.deepEqual([t.sales, t.sold, t.cash, t.credit], [2, 9000, 23000, 6000]);
  assert.equal(t.say, "Today: 2 sales, nine thousand naira. Money in, twenty-three thousand naira. On credit, six thousand naira. Profit, one thousand five hundred naira.");
});

test("reminder is written for what the customer really owes", () => {
  const s = freshState();
  const r = reminder(s, "emeka");
  assert.equal(r.text, "Hello Emeka, this is Mama Bisi Provisions. Your balance with us is ₦45,000. Thank you for your custom.");
  assert.equal(reminder(s, "Aisha").text, null);
  assert.equal(reminder(s, "Bola").ok, false);
});

test("restock adds stock and averages the buying price", () => {
  const s = freshState();
  const r = draftRestock(s, { product: "rice", quantity: 20, unit_cost: 2800, supplier: "alhaji sule" });
  assert.ok(r.ok);
  assert.equal(r.draft.say, "Add 20 bags of rice at two thousand eight hundred each, fifty-six thousand naira in all, from Alhaji Sule. Stock goes from 40 to 60. Say yes.");
  commit(s, r.draft);
  const rice = s.products.find(p => p.say === "rice");
  assert.equal(rice.stock, 60);
  assert.equal(rice.cost, 2600); // (40 x 2500 + 20 x 2800) / 60
  undo(s);
  assert.equal(rice.stock, 40);
  assert.equal(rice.cost, 2500);
  assert.equal(draftRestock(s, { product: "rice", quantity: 5, unit_cost: 25 }).ok, false, "25 naira buying price is questioned");
});

test("new product joins the stock list and the words AssemblyAI listens for", () => {
  const s = freshState();
  const r = draftNewProduct(s, { name: "milo tin", sell_price: 2000, unit_cost: 1700, quantity: 12, unit: "tin" });
  assert.equal(r.draft.say, "New product Milo Tin, selling at two thousand naira a tin, bought at one thousand seven hundred, 12 in stock. Say yes.");
  commit(s, r.draft);
  assert.ok(shopKeyterms(s).includes("Milo"));
  assert.equal(draftSale(s, { customer: "Aisha", items: [{ product: "milo", quantity: 2 }] }).draft.total, 4000);
  assert.equal(draftNewProduct(s, { name: "rice", sell_price: 3000 }).ok, false, "rice already exists");
});

test("price change is read back and can be undone", () => {
  const s = freshState();
  const r = draftPriceChange(s, { product: "rice", sell_price: 3200 });
  assert.equal(r.draft.say, "Rice goes from three thousand to three thousand two hundred naira. Say yes.");
  commit(s, r.draft);
  assert.equal(draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 1 }] }).draft.total, 3200);
  undo(s);
  assert.equal(s.products.find(p => p.say === "rice").price, 3000);
  assert.equal(draftPriceChange(s, { product: "rice", sell_price: 30 }).ok, false);
});

test("stock check for one product, and what is running low", () => {
  const s = freshState();
  assert.equal(stockReport(s, "indomie").say, "25 cartons of Indomie left, selling at eight thousand five hundred naira.");
  // The sample shop starts with two items low, so the dashboard has something to show.
  assert.equal(stockReport(s, "").say, "Running low: Semovita, 4 left; garri, 5 left.");
  for (const p of s.products) if (p.stock <= 5) p.stock = 20;
  assert.equal(stockReport(s, "").say, "Nothing is running low. Everything has more than five left.");
});

test("discount, transfer, and expenses feed today's summary", () => {
  const s = freshState();
  const now = new Date("2026-09-26T09:00:00Z");
  const r = draftSale(s, { customer: "", items: [{ product: "rice", quantity: 2 }], discount: 500, payment_method: "bank transfer" });
  assert.equal(r.draft.say, "2 bags of rice at three thousand. Less five hundred discount, total five thousand five hundred naira. Paid by transfer. Say yes.");
  assert.equal(commit(s, r.draft, now).receipt.profit, 500);
  commit(s, draftExpense(s, { amount: 2000, what: "transport" }).draft, now);
  assert.equal(todaySummary(s, now).say, "Today: 1 sale, five thousand five hundred naira. Money in, five thousand five hundred naira. Profit, five hundred naira. Spent, two thousand naira.");
  assert.equal(draftSale(s, { customer: "", items: [{ product: "sugar", quantity: 1 }], discount: 2000 }).ok, false, "discount bigger than the sale");
});

test("a unit word like 'tin' does not make two products look alike", () => {
  const s = freshState();
  commit(s, draftNewProduct(s, { name: "Milo tin", sell_price: 2000, unit: "tin", quantity: 10 }).draft);
  const r = draftSale(s, { customer: "Blessing", items: [{ product: "Milo tin", quantity: 2 }], discount: 300, payment_method: "transfer", amount_paid: 3700 });
  assert.ok(r.ok, r.error);
  assert.equal(r.draft.total, 3700);
  assert.equal(bestMatch(s.products, "milo", ["name", "say"]).match.name, "Milo Tin");
  assert.equal(bestMatch(s.products, "tomato tin", ["name", "say"]).match.say, "tomato paste");
});

test("restock without a price uses the saved buying price", () => {
  const s = freshState();
  const r = draftRestock(s, { product: "rice", quantity: 10 });
  assert.ok(r.ok, r.error);
  assert.equal(r.draft.total, 25000);
  assert.match(r.draft.say, /your usual/);
});

test("new product with only a buying price sells at 6 to 7% more", () => {
  const s = freshState();
  const r = draftNewProduct(s, { name: "Milo tin", unit: "tin", unit_cost: 2000 });
  assert.ok(r.ok, r.error);
  const m = r.draft.item.price / 2000 - 1;
  assert.ok(m >= 0.06 && m <= 0.07, `markup ${m}`);
  for (const c of [150, 560, 1250, 2500, 7600, 19000]) {
    const k = draftNewProduct(s, { name: "Test item", unit_cost: c }).draft.item.price / c - 1;
    assert.ok(k >= 0.06 && k <= 0.07, `cost ${c} markup ${k}`);
  }
});

test("todaySummary is unchanged, now built on top of summary()", () => {
  const s = freshState();
  assert.equal(todaySummary(s, new Date("2026-09-26T12:00:00Z")).say, "Nothing recorded today yet.");
  commit(s, draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 2 }] }).draft, new Date("2026-09-26T09:00:00Z"));
  commit(s, draftPayment(s, { customer: "Emeka", amount: 20000 }).draft, new Date("2026-09-26T11:00:00Z"));
  const t = todaySummary(s, new Date("2026-09-26T18:00:00Z"));
  assert.equal(t.say, "Today: 1 sale, six thousand naira. Money in, twenty thousand naira. On credit, six thousand naira. Profit, one thousand naira.");
});

test("periodStart gives today, a 7-day week and a 30-day month", () => {
  const now = new Date("2026-09-27T15:00:00Z");
  // Midnight on the device's own clock (Lagos in real use).
  const mid = (y, m, d) => new Date(y, m - 1, d).getTime();
  assert.equal(periodStart("today", now).getTime(), mid(2026, 9, 27));
  assert.equal(periodStart("week", now).getTime(), mid(2026, 9, 21));
  assert.equal(periodStart("month", now).getTime(), mid(2026, 8, 29));
});

test("receipt numbers start again at one each day", () => {
  const s = freshState();
  const sell = when => commit(s, draftSale(s, { customer: "", items: [{ product: "rice", quantity: 1 }] }).draft, when);
  sell(new Date(2026, 8, 27, 9));
  assert.match(sell(new Date(2026, 8, 27, 10)).say, /receipt two/);
  const next = sell(new Date(2026, 8, 28, 9));
  assert.match(next.say, /receipt one/);
  assert.equal(next.receipt.ref, "GB-0928-001");
});

test("summary over a week totals more than one day", () => {
  const s = freshState();
  const now = new Date("2026-09-27T15:00:00Z");
  commit(s, draftSale(s, { customer: "", items: [{ product: "rice", quantity: 1 }] }).draft, new Date("2026-09-22T09:00:00Z"));
  commit(s, draftSale(s, { customer: "", items: [{ product: "rice", quantity: 1 }] }).draft, new Date("2026-09-26T09:00:00Z"));
  const week = summary(s, periodStart("week", now), now, "This week");
  assert.equal(week.sales, 2);
  assert.ok(week.sold > 0);
  assert.match(week.say, /^This week: 2 sales/);
});

test("debtors: balances match, days are non-negative and sorted worst first", () => {
  const s = freshState();
  const now = new Date("2026-09-27T00:00:00Z");
  const d = debtors(s, now);
  assert.deepEqual(d.map(x => x.name), ["Emeka", "Chinedu", "Mama Ngozi", "Musa"]);
  for (const x of d) assert.ok(x.days >= 0, `${x.name} days ${x.days}`);
  for (let i = 1; i < d.length; i++) assert.ok(d[i - 1].balance >= d[i].balance);
});

test("debtors pays off the oldest debt first (FIFO)", () => {
  const s = freshState();
  // Tunde: 8500 debt on the 15th, 10000 payment on the 22nd -> fully clear, no debtor entry.
  assert.ok(!debtors(s, new Date("2026-09-27T00:00:00Z")).some(x => x.name === "Tunde"));
});

test("seedHistory: balances and stock land back exactly on freshState()'s, no receipt dated today", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  const fresh = freshState();
  const seeded = seedHistory(freshState(), now);
  assert.equal(seeded.seeded, true);
  for (const c of fresh.customers) assert.equal(balanceOf(seeded.customers.find(x => x.name === c.name)).balance, balanceOf(c).balance, c.name);
  for (const p of fresh.products) assert.equal(seeded.products.find(x => x.name === p.name).stock, p.stock, p.name);
  const today = now.toISOString().slice(0, 10);
  assert.ok(!seeded.receipts.some(r => r.ts.slice(0, 10) === today), "no seeded receipt is dated today");
  assert.ok(seeded.receipts.length >= 18 && seeded.receipts.length <= 40, `receipt count ${seeded.receipts.length}`);
});

test("after seedHistory, a sale saved today is still 'receipt one'", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  const seeded = demoState(now);
  const r = commit(seeded, draftSale(seeded, { customer: "", items: [{ product: "rice", quantity: 1 }] }).draft, now);
  assert.match(r.say, /^Saved, receipt one\./);
  assert.equal(r.receipt.ref, `GB-${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-001`);
});

test("demoState gives a week of sales", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  const seeded = demoState(now);
  const week = summary(seeded, periodStart("week", now), now, "This week");
  assert.ok(week.sales > 0, "week should have sales");
});

test("debtors: a deposit paid before any debt pays the next debts first", () => {
  const s = freshState();
  const ib = s.customers.find(c => c.name === "Ibrahim"); // 3000 deposit on the 24th
  ib.entries.push({ type: "debt", amount: 2000, ts: "2026-09-25T10:00:00Z" }, { type: "debt", amount: 5000, ts: "2026-09-26T10:00:00Z" });
  const d = debtors(s, new Date("2026-09-27T12:00:00Z")).find(x => x.name === "Ibrahim");
  assert.equal(d.balance, 4000);
  assert.equal(d.days, 1, "the 25th debt is covered by the deposit, so the oldest unpaid is the 26th");
});

test("seedHistory: no made-up correction receipts, every price is the shop's usual one", () => {
  const s = demoState(new Date("2026-09-27T08:00:00Z"));
  for (const r of s.receipts.filter(r => r.kind === "sale")) {
    for (const l of r.lines) assert.equal(l.unit_price, s.products.find(p => p.name === l.product).price, `${r.ref} ${l.product}`);
    assert.ok(r.profit >= 0 && r.profit < r.total / 2, `${r.ref} profit ${r.profit}`);
  }
  assert.equal(new Set(s.receipts.map(r => r.ts.slice(0, 10))).size, 13, "one or more receipts on each of the 13 days");
});

test("undo with no ref does not reach into the seeded history", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  const s = demoState(now);
  const n = s.receipts.length;
  assert.equal(undo(s).ok, false);
  assert.equal(s.receipts.length, n);
  commit(s, draftSale(s, { customer: "", items: [{ product: "rice", quantity: 1 }] }).draft, now);
  assert.equal(undo(s).ok, true);
  assert.equal(undo(s).ok, false);
});
