// Reads a haggle (two people talking) and pulls out the deal that was agreed:
// what was sold, how many, and the last price said. Plain rules, no AI, so the
// owner sees exactly what was understood and can fix it before saving.

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { thousand: 1e3, million: 1e6 };

const clean = s => String(s || "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d{3})/g, "$1$2")
  .replace(/₦|naira/g, " ").replace(/(\d(?:\.\d+)?)\s*k\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000)))
  .replace(/[^a-z0-9. ]/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();

// Every number in the text, in order: { value, at } where `at` is the word position.
export function numbersIn(text) {
  const w = clean(text).split(" ").filter(Boolean);
  const out = [];
  for (let i = 0; i < w.length; i++) {
    if (/^\d+(\.\d+)?$/.test(w[i])) { out.push({ value: parseFloat(w[i]), at: i }); continue; }
    if (!(w[i] in ONES) && !(w[i] in TENS) && w[i] !== "hundred") continue;
    let total = 0, chunk = 0, j = i, used = false;
    for (; j < w.length; j++) {
      const x = w[j];
      if (x in ONES) { chunk += ONES[x]; used = true; }
      else if (x in TENS) { chunk += TENS[x]; used = true; }
      else if (x === "hundred" && used) chunk = (chunk || 1) * 100;
      else if (x in SCALE && used) { total += (chunk || 1) * SCALE[x]; chunk = 0; }
      else if (x === "and" && used && (w[j + 1] in ONES || w[j + 1] in TENS)) continue;
      else break;
    }
    out.push({ value: total + chunk, at: i });
    i = j - 1;
  }
  return out;
}

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// lines: [{ speaker: "A", text }]. Returns the deal, or { none: true, why }.
export function readDeal(state, lines) {
  const text = lines.map(l => l.text).join(" . ");
  const n = " " + norm(text) + " ";
  // The product named last wins: the haggle ends on what was agreed.
  let product = null, pAt = -1;
  for (const p of state.products) {
    for (const term of [p.say, p.name.replace(/\(.*\)/, "")]) {
      const t = norm(term);
      const at = t ? n.lastIndexOf(" " + t + " ") : -1;
      if (at > pAt) { pAt = at; product = p; }
    }
  }
  if (!product) return { none: true, why: "I could not hear which product it was." };

  const nums = lines.flatMap((l, li) => numbersIn(l.text).map(x => ({ ...x, li })));
  if (!nums.length) return { none: true, why: "I could not hear a price." };

  const usual = product.price;
  const moneyish = nums.filter(x => x.value >= 50);
  if (!moneyish.length) return { none: true, why: "I could not hear a price." };
  const last = moneyish[moneyish.length - 1];

  // Quantity: the small number said right before the product or its unit.
  const unitWord = norm(product.unit).split(" ").pop();
  let qty = 1;
  for (const l of lines) {
    const words = clean(l.text).split(" ");
    const ns = numbersIn(l.text).filter(x => x.value > 0 && x.value < 50);
    for (const x of ns) {
      const after = words.slice(x.at + 1, x.at + 4).join(" ");
      if (after.includes(unitWord) || after.includes(norm(product.say)) || /\b(bag|bags|carton|cartons|pack|packs|tin|tins|bottle|bottles|bucket|buckets)\b/.test(after)) qty = x.value;
    }
  }

  // "3,000 each" or "9,000 for the three"? A per-unit price near the usual one wins.
  const near = v => v >= usual / 2 && v <= usual * 2;
  let unit = last.value, asTotal = false;
  if (qty > 1 && !near(last.value) && near(last.value / qty)) { unit = Math.round(last.value / qty); asTotal = true; }
  const heardBy = lines[last.li]?.speaker || "";
  return { product: product.name, say: product.say, quantity: qty, unit_price: unit, total: unit * qty, asTotal, saidBy: heardBy };
}
