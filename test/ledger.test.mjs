import test from "node:test";
import assert from "node:assert/strict";
import { freshState, draftSale, draftPayment, commit, balanceOf, bestMatch, shopKeyterms } from "../public/ledger.js";

const bal = (s, name) => balanceOf(s.customers.find(c => c.name === name)).balance;

test("the Musa sale: 2 rice at 3,000 on his account", () => {
  const s = freshState();
  const r = draftSale(s, { customer: "Musa", items: [{ product: "rice", quantity: 2, unit_price: 3000 }] });
  assert.ok(r.ok);
  assert.equal(r.draft.total, 6000);
  assert.equal(r.draft.before, 4000);
  assert.equal(r.draft.after, 10000);
  assert.equal(r.draft.say, "2 bags of rice at 3,000 naira. Total 6,000 naira. Musa will owe 10,000 naira. Say yes to save.");
  assert.equal(bal(s, "Musa"), 4000, "a draft must not touch the books");
  const c = commit(s, r.draft, new Date("2026-09-26T09:00:00Z"));
  assert.equal(bal(s, "Musa"), 10000);
  assert.equal(c.receipt.ref, "PKV-0926-001");
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
  assert.match(r.draft.say, /3,000 naira more than they owed/);
  assert.match(r.draft.say, /holding 3,000 naira for Musa/);
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
