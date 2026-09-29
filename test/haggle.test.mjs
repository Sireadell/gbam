import test from "node:test";
import assert from "node:assert/strict";
import { freshState, draftSale } from "../public/ledger.js";
import { numbersIn, readDeal } from "../public/haggle-parse.js";

test("numbers: digits, k, words, commas", () => {
  assert.deepEqual(numbersIn("three thousand two hundred").map(x => x.value), [3200]);
  assert.deepEqual(numbersIn("5k for 2,500 and two").map(x => x.value), [5000, 2500, 2]);
  assert.deepEqual(numbersIn("twenty two thousand").map(x => x.value), [22000]);
});

test("haggle: the last price said is the deal", () => {
  const s = freshState();
  const d = readDeal(s, [
    { speaker: "A", text: "How much be this rice?" },
    { speaker: "B", text: "Na three thousand five hundred per bag." },
    { speaker: "A", text: "Too much. Two bags, I go pay two thousand eight hundred." },
    { speaker: "B", text: "Ok, three thousand." },
    { speaker: "A", text: "Deal, three thousand each." },
  ]);
  assert.equal(d.product, "Rice (50kg bag)");
  assert.equal(d.quantity, 2);
  assert.equal(d.unit_price, 3000);
  assert.equal(d.total, 6000);
});

test("haggle: a total price is turned into a per-bag price", () => {
  const s = freshState();
  const d = readDeal(s, [{ speaker: "A", text: "Three bags of rice, ten thousand five hundred for all." }]);
  assert.equal(d.quantity, 3);
  assert.equal(d.unit_price, 3500);
});

test("haggle: nothing to read", () => {
  assert.ok(readDeal(freshState(), [{ speaker: "A", text: "Good morning" }]).none);
});

test("haggle deal feeds the normal sale draft (nothing saved yet)", () => {
  const s = freshState();
  const d = readDeal(s, [{ speaker: "A", text: "Two bags of rice at three thousand each" }]);
  const r = draftSale(s, { customer: "Musa", items: [{ product: d.say, quantity: d.quantity, unit_price: d.unit_price }] });
  assert.ok(r.ok);
  assert.equal(r.draft.total, 6000);
});
