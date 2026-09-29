// The conversation with AssemblyAI's Voice Agent API. AssemblyAI listens,
// understands and speaks. This file hands it the shop's own words to listen
// for, and the tools it must use to touch the books. The books never trust
// the model with a number: tools compute everything and return the sentence
// to read back.
import { dailyClose, draftSale, draftPayment, draftRestock, draftNewProduct, draftPriceChange, draftExpense, stockReport, commit, undo, todaySummary, reminder, balanceOf, bestMatch, standingText, shopKeyterms, summary, periodStart, debtors, spoken, inWords } from "./ledger.js";

const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const YES = /\b(gbam|yes|yeah|yep|yup|ehen|correct|confirm(ed)?|save( it| am)?|ok(ay)?|al{1,2} ?right|fine|proceed|do it|go ahead|do am|sure|true|right|that'?s right|na so|e correct|e good|e dey (ok|okay|fine|correct)|oya)\b/i;
const NO = /\b(no|not|don'?t|wrong|cancel|wait|stop|change|no be so)\b/i;
// "no problem", "no wahala", "not bad", "change nothing" sound negative but agree.
const BENIGN_NO = /\b(no (problem|wahala|worry|worries|doubt|issue|need|change)|not bad|not a problem|change nothing|nothing to change|no be (wahala|problem))\b/gi;

// "paid in full", "paid everything", "she don pay all", "fully paid", "paid cash"
export const PAID_IN_FULL = /\b(pa(id|y)|don pay)\b[^.?!]{0,25}\b(in full|full|all|everything|whole|cash)\b|\bfully paid\b/i;

// Did the owner clearly agree? A word of agreement, and no real objection.
export function isYes(text) {
  const t = String(text || "");
  return YES.test(t) && !NO.test(t.replace(BENIGN_NO, " "));
}

function systemPrompt(shop, memory) {
  return `You are Gbam, the voice record book of ${shop.name}, a provisions shop in ${shop.city}, Nigeria. The owner talks to you in Nigerian English or Nigerian Pidgin while serving customers. Understand Pidgin: "don pay" or "pay me" means paid, "carry" or "collect" or "take" means took goods, "e don finish" means sold out, "wetin X owe" means how much does X owe, "abeg" means please, "oya" means go ahead. Reply in plain simple English. You turn what they say into sale and payment records.

Rules:
1. Never do arithmetic. Never say a price, total or balance from your own head. Every number you speak must come from a tool result.
2. When a tool result has a "say" field, speak it word for word, then stop. Do not add, round or reword numbers.
3. A sale: call draft_sale once you have the products, quantities and the customer's name (or they said it was a cash walk-in). Prices are optional, the shop's stock list has them.
4. Money received from a customer: call draft_payment.
5. Save only with confirm_draft, and only right after the owner clearly agrees. A "yes" said while you are still reading back counts: call confirm_draft, do not read it again. If they correct anything, draft again with the correction. If they say "no" or "wait" without a correction, keep the draft and ask what to change. Use cancel_draft only when they say cancel, forget it, or leave it.
6. If a tool returns an error, ask the owner only for the missing piece, in one short question.
7. "How much does X owe" or similar: call check_account.
8. "Undo", "remove that", "that was wrong" about something already saved: call undo_last.
9. "How much I make today", "today's sales" or similar: call today_summary.
9a. "How was this week", "how was this month", "week's sales", "month's sales" or similar: call period_summary with the period. "Today" still goes to today_summary.
9b. "Who owe me", "who dey owe me", "who owes money", "wetin dem owe": call who_owes.
10. "Remind X", "send X reminder", "tell X to pay": call remind_customer.
11. If a price sounds odd, the tool will say so. Ask the owner to say the price again; only if they repeat the same price, draft again with price_confirmed true.
12. Money is naira. "3k" or "3 thousand" means 3000. "Two-five" after a thousand amount usually means 2,500; if unsure, ask.
13. "Gbam" means yes, exactly.
14. Stock coming IN (bought from a supplier, "add", "I buy", "just arrive"): call draft_restock, never draft_sale.
15. A product not in the stock list: draft_new_product. If only the buying price is said, do not ask for a selling price; the app sets it. For stock coming in, never ask the buying price; the app uses the saved one. A new price for an existing product: draft_price_change.
16. "How many X remain/dey", "wetin dey finish", "what is running low": call check_stock.
17. Money the shop spent that is not stock (transport, rent, NEPA, market levy, food): call draft_expense.
18. A sale paid by transfer or POS: pass payment_method. A discount ("give am 500 off", "remove 500"): pass discount in naira.
19. One short sentence per reply. You are talking to a busy person at a counter.
20. Speech recognition often turns Pidgin "X don pay 40k" into "X don't pay 40k". The owner never needs to record a non-payment, so treat "X don't pay 40,000" like "X don pay 40,000": call draft_payment and read it back. The owner will say no if it was wrong.
21. If the owner says "he", "she" or "him" and you do not know from this conversation which customer they mean, ask "Which customer?" and nothing else. If the earlier chat below names the last customer, use that customer.
22. Every sale or payment the owner states is new, even if it sounds like one already saved ("also", "again", "another one", the same amount). Never say you have already saved it and never refuse. Draft it, read it back, and let the owner say yes or no. That is what protects them from doubles.
23. "Paid in full", "paid everything", "paid all", "paid the whole thing" on a sale: draft_sale with amount_paid "full". Never ask how much, the app knows the total. If a sale draft is already waiting and the owner then says they paid everything, draft it again with amount_paid "full".
24. "Close the day", "close for the day", "end of day", "wrap up", "how did the day go", "I dey close": call close_day.${memoryNote(memory)}`;
}

// What Gbam remembers from the last chat. It is only for knowing who and what
// the owner means. Numbers in it may be out of date, so they are never used.
function memoryNote(memory) {
  if (!memory?.lines?.length) return "";
  const said = memory.lines.map(l => `${l.who}: ${l.text}`).join(" | ");
  return `

Earlier chat with this owner (from a previous session, only so you know who and what they mean, for example who "he" is). Never take a number from it: any amount or balance must come from a tool.${memory.customer ? ` The customer last talked about was ${memory.customer}.` : ""}
${said}`;
}

// A sale or payment was read back but not yet confirmed when the last session
// ended. The new session must know, so a "yes" saves it instead of vanishing.
function pendingNote(draft) {
  if (!draft?.say) return "";
  return `

A draft is waiting for the owner's answer. It was already read back to them: "${draft.say}" If they say yes, call confirm_draft. If they correct it, draft again. If they say cancel, call cancel_draft. Do not start a new draft until this one is answered.`;
}

const TOOLS = [
  { type: "function", name: "draft_sale",
    description: "Prepare a sale so the owner can confirm it. Call once you have heard every product with its quantity, and the customer's name or that it was a cash walk-in. The tool does all the maths and returns the exact sentence to read back. It does not save anything.",
    parameters: { type: "object", properties: {
      customer: { type: "string", description: "Customer's name as said, e.g. 'Musa' or 'Mama Ngozi'. Empty string for a cash walk-in with no name." },
      items: { type: "array", description: "Every product sold.", items: { type: "object", properties: {
        product: { type: "string", description: "Product as said, e.g. 'rice', 'Indomie', 'groundnut oil'." },
        quantity: { type: "number", description: "How many units, e.g. 2." },
        unit_price: { type: "number", description: "Naira per unit ONLY if the owner said a price, e.g. 3000. Leave out otherwise." } },
        required: ["product", "quantity"] } },
      amount_paid: { type: "string", description: "Naira the customer paid now (digits, like 3000), only if said. If they paid everything (\"paid in full\", \"paid all\", \"paid cash\", \"e don pay\") send the word \"full\": the app works out the amount. Leave out if nothing was said about payment." },
      payment_method: { type: "string", enum: ["cash", "transfer", "pos"], description: "How they paid, only if said. 'transfer' for bank transfer, 'pos' for card or POS." },
      discount: { type: "number", description: "Naira taken off the whole sale, only if the owner gave a discount, e.g. 500." },
      add_new_customer: { type: "boolean", description: "True only after the owner confirmed this is a new customer." },
      price_confirmed: { type: "boolean", description: "True only after the tool said a price looked wrong and the owner repeated the same price." } },
      required: ["customer", "items"] } },
  { type: "function", name: "draft_payment",
    description: "Prepare a payment a customer made, so the owner can confirm it. Returns the exact sentence to read back, including what they will still owe or any deposit. Does not save.",
    parameters: { type: "object", properties: {
      customer: { type: "string", description: "Customer's name as said, e.g. 'Chinedu'." },
      amount: { type: "number", description: "Naira paid, e.g. 5000." },
      add_new_customer: { type: "boolean", description: "True only after the owner confirmed this is a new customer." } },
      required: ["customer", "amount"] } },
  { type: "function", name: "confirm_draft",
    description: "Save the sale or payment that was just read back. Call only immediately after the owner clearly said yes to it.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "cancel_draft",
    description: "Throw away the sale or payment that was read back, when the owner says no or cancel.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "draft_restock",
    description: "Prepare adding stock that came IN to the shop (bought from a supplier). Call when the owner says how many of which product arrived; the price paid and supplier are optional. Returns the sentence to read back. Does not save.",
    parameters: { type: "object", properties: {
      product: { type: "string", description: "Product as said, e.g. 'rice'." },
      quantity: { type: "number", description: "How many units came in, e.g. 20." },
      unit_cost: { type: "number", description: "Naira paid for EACH unit, only if said, e.g. 2500." },
      supplier: { type: "string", description: "Who they bought from, only if said, e.g. 'Alhaji Sule'." },
      price_confirmed: { type: "boolean", description: "True only after the tool said the price looked wrong and the owner repeated it." } },
      required: ["product", "quantity"] } },
  { type: "function", name: "draft_new_product",
    description: "Prepare adding a product the shop does not stock yet. Needs its name and either the selling price or the buying price (if only the buying price is said, the selling price is set automatically at the shop's usual markup; never ask for it). Returns the sentence to read back. Does not save.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Product name, e.g. 'Milo tin'." },
      sell_price: { type: "number", description: "Naira it sells for, only if said, e.g. 2000." },
      unit: { type: "string", description: "Unit it is sold in, only if said, e.g. 'tin', 'bag', 'carton'." },
      unit_cost: { type: "number", description: "Naira the shop paid for each, only if said." },
      quantity: { type: "number", description: "How many are in stock now, only if said." } },
      required: ["name"] } },
  { type: "function", name: "draft_price_change",
    description: "Prepare a new selling price for a product already in stock. Returns the sentence to read back. Does not save.",
    parameters: { type: "object", properties: {
      product: { type: "string", description: "Product as said, e.g. 'rice'." },
      sell_price: { type: "number", description: "The new selling price in naira, e.g. 3200." },
      price_confirmed: { type: "boolean", description: "True only after the tool said the price looked wrong and the owner repeated it." } },
      required: ["product", "sell_price"] } },
  { type: "function", name: "draft_expense",
    description: "Prepare recording money the shop spent that is not stock, e.g. transport, rent, market levy. Returns the sentence to read back. Does not save.",
    parameters: { type: "object", properties: {
      amount: { type: "number", description: "Naira spent, e.g. 2000." },
      what: { type: "string", description: "What it was for, e.g. 'transport'." } },
      required: ["amount", "what"] } },
  { type: "function", name: "check_stock",
    description: "How many of a product are left, or with no product, what is running low. Returns the sentence to say.",
    parameters: { type: "object", properties: {
      product: { type: "string", description: "Product as said, or empty for everything running low." } } } },
  { type: "function", name: "undo_last",
    description: "Take the most recently saved sale or payment back out of the books, when the owner says undo or that it was wrong. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "today_summary",
    description: "Today's totals: number of sales, money sold, cash that came in, and how much went out on credit. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "period_summary",
    description: "Totals for a stretch longer than today: this week (last 7 days) or this month (last 30 days). Returns the sentence to say.",
    parameters: { type: "object", properties: {
      period: { type: "string", enum: ["week", "month"], description: "'week' for the last 7 days, 'month' for the last 30 days." } },
      required: ["period"] } },
  { type: "function", name: "who_owes",
    description: "The customers who currently owe money, worst first, with how long they have owed it. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "close_day",
    description: "End-of-day debrief: today's sales and money in, who owes and how much, and what is running low. Also puts a written copy on screen that the owner can send on WhatsApp. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "remind_customer",
    description: "Prepare a polite WhatsApp reminder to a customer about what they owe. It is shown on screen for the owner to send; nothing is sent automatically. Returns the sentence to say.",
    parameters: { type: "object", properties: { customer: { type: "string", description: "Customer's name as said, e.g. 'Emeka'." } }, required: ["customer"] } },
  { type: "function", name: "check_account",
    description: "Look up what a customer owes, or how much deposit the shop is holding for them. Returns the sentence to say.",
    parameters: { type: "object", properties: {
      customer: { type: "string", description: "Customer's name as said." } }, required: ["customer"] } },
];

// "Who owe me": the top 3 debtors, worst first, said in one sentence.
function whoOwesSay(state) {
  const all = debtors(state);
  if (!all.length) return "Nobody owes you anything right now.";
  const top = all.slice(0, 3);
  const n = inWords(all.length);
  const who = all.length === 1 ? "One person owes you" : `${n.charAt(0).toUpperCase() + n.slice(1)} people owe you`;
  const lead = all.length > top.length ? `. The biggest ${inWords(top.length)}: ` : ". ";
  const since = d => d.days === 0 ? "since today" : d.days === 1 ? "for one day" : `for ${inWords(d.days)} days`;
  const lines = top.map(d => `${d.name}, ${spoken(d.balance)}, ${since(d)}`);
  return `${who}${lead}${lines.join("; ")}.`;
}

export class ShopAgent {
  constructor({ store, on }) {
    this.store = store;      // { state, save() }
    this.on = on;            // UI callbacks
    this.ws = null;
    this.draft = null;
    this.lastUser = "";
    this.lastEvent = null;
    this.pending = [];
    this.playing = [];
  }

  sessionConfig() {
    const st = this.store.state;
    return {
      system_prompt: systemPrompt(st.shop, this.store.memory) + pendingNote(this.draft),
      greeting: this.draft?.say ? `I still have this waiting. ${this.draft.say}` : this.store.memory?.customer ? `Welcome back. We were on ${this.store.memory.customer}. Tell me a sale or a payment.` : "I'm listening. Tell me a sale or a payment.",
      tools: TOOLS,
      input: {
        keyterms: shopKeyterms(st),
        transcription_prompt: `A Nigerian shop owner speaking Nigerian English or Pidgin (for example "don pay", "abeg", "5k", "na so", "gbam") records sales and payments: quantities, products such as ${st.products.slice(0, 6).map(p => p.say).join(", ")}, prices in naira, and customer names such as ${st.customers.slice(0, 6).map(c => c.name).join(", ")}.`,
        language_codes: ["en"],
      },
      output: { voice: "jean" },
    };
  }

  async start() {
    const res = await fetch("/api/voice-token");
    const body = await res.json().catch(() => ({}));
    if (!body.token) throw new Error(body.error || `Could not start voice (${res.status})`);

    this.playCtx = new AudioContext();
    this.playAt = 0;
    let mic = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
      this.micCtx = new AudioContext();
      await this.micCtx.audioWorklet.addModule("/pcm-worklet.js");
      const src = this.micCtx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.micCtx, "pcm-capture", { processorOptions: { inputSampleRate: this.micCtx.sampleRate } });
      src.connect(this.worklet);
      this.worklet.port.onmessage = e => {
        if (this.ready && this.ws?.readyState === 1 && !this.muted) this.send({ type: "input.audio", audio: b64(e.data) });
      };
    } catch (e) {
      mic = false;
      this.on.status("No microphone. You can still type below and the agent will answer out loud.");
    }

    this.ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(body.token)}`);
    this.ws.onopen = () => this.send({ type: "session.update", session: this.sessionConfig() });
    this.ws.onmessage = ev => this.handle(JSON.parse(ev.data));
    this.ws.onclose = () => { this.cleanup(); this.on.ended(this.endReason); this.endReason = null; };
    return { mic };
  }

  // "Noisy place" mode: the mic is off until the owner holds the button. When
  // they let go, a short stretch of silence tells the agent the turn is over.
  hold(on) {
    clearInterval(this.tail);
    if (on) { this.muted = false; return; }
    let n = 0;
    this.tail = setInterval(() => {
      if (this.ready && this.ws?.readyState === 1 && n < 16) this.send({ type: "input.audio", audio: b64(new Int16Array(1200).buffer) });
      if (++n >= 16) { clearInterval(this.tail); this.muted = true; }
    }, 50);
  }

  stop() {
    if (this.ws?.readyState === 1) this.send({ type: "session.end" });
    else this.cleanup();
  }

  cleanup() {
    this.ready = false;
    clearTimeout(this.idleTimer);
    this.stream?.getTracks().forEach(t => t.stop());
    this.micCtx?.close().catch(() => {});
    this.playCtx?.close().catch(() => {});
    this.micCtx = this.playCtx = this.stream = null;
    try { this.ws?.close(); } catch {}
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return;
    if (msg.type !== "input.audio") this.trace("out", msg);
    this.ws.send(JSON.stringify(msg));
  }

  // When running on your own computer, every event except raw audio is written
  // to logs/ by the server, so a session that went wrong can be replayed.
  trace(dir, m) {
    // Everywhere: keep the last 400 events in memory for "Copy session log".
    (this.debugLog ||= []).push({ t: Date.now(), dir, m });
    if (this.debugLog.length > 400) this.debugLog.shift();
    if (typeof location === "undefined" || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    (this.traceBuf ||= []).push({ t: Date.now(), dir, m });
    this.traceTimer ||= setTimeout(() => {
      const body = JSON.stringify(this.traceBuf);
      this.traceBuf = []; this.traceTimer = null;
      fetch("/api/log", { method: "POST", body, keepalive: true }).catch(() => {});
    }, 1000);
  }

  // Typed input, for noisy moments or a judge without a microphone.
  typed(text) {
    this.lastUser = text;
    this.bumpIdle();
    this.on.user(text, true);
    // A bare conversation.message is not seen by the next reply (tested: the
    // agent answered as if nothing was said, and once guessed a sale). The
    // words have to ride in the reply instruction itself.
    this.send({ type: "conversation.message", role: "user", content: text });
    this.send({ type: "reply.create", instructions: `The owner typed instead of speaking: "${text.replace(/"/g, "'")}". Treat it exactly as if they had said it, and act on it.` });
  }

  // The Voice Agent API bills for every second a session is open ($4.50 an
  // hour), so a quiet counter must not keep a session running. Hang up after
  // 45 quiet seconds, or 90 while a draft waits for a yes.
  bumpIdle() {
    clearTimeout(this.idleTimer);
    if (!this.ready) return;
    this.idleTimer = setTimeout(() => {
      this.endReason = "Hung up after a quiet spell, to save cost. Tap to talk again.";
      this.stop();
    }, this.draft ? 90000 : 45000);
  }

  handle(m) {
    if (m.type !== "reply.audio" && m.type !== "transcript.agent.delta") this.trace("in", m);
    if (["session.ready", "input.speech.started", "transcript.user", "reply.done", "tool.call"].includes(m.type)) this.bumpIdle();
    switch (m.type) {
      case "session.ready": this.ready = true; this.on.status(this.worklet ? "Listening" : "No microphone here. Type below, the agent still answers out loud."); this.on.ready(); break;
      case "input.speech.started": this.lastEvent = m.type; this.on.hearing(true); break;
      case "input.speech.stopped": this.on.hearing(false); break;
      case "transcript.user.delta": this.on.user(m.text, false); break;
      case "transcript.user": this.lastUser = m.text; this.on.user(m.text, true); break;
      case "reply.started": this.lastEvent = m.type; break;
      case "reply.audio": this.play(m.data); break;
      case "transcript.agent.delta":
        if (m.reply_id !== this.agentReply) { this.agentReply = m.reply_id; this.agentText = ""; }
        this.agentText = (this.agentText + " " + (m.delta || "")).replace(/\s+/g, " ").trim();
        this.on.agent(this.agentText, false); break;
      case "transcript.agent": this.agentReply = null; this.on.agent(m.text, true); break;
      case "reply.done":
        this.lastEvent = m.type;
        // Even after an interruption the agent still waits for its tool
        // result. Dropping it (as the docs sample does) left the owner
        // talking to a silent agent, so the result is always sent.
        if (m.status === "interrupted") this.flushPlayback();
        this.flushTools();
        break;
      case "tool.call": this.onTool(m); break;
      case "session.ended": this.cleanup(); break;
      case "session.error": case "error": this.on.status(`AssemblyAI: ${m.message || m.code}`); break;
    }
  }

  onTool(m) {
    const result = this.runTool(m.name, m.arguments || {});
    this.on.tool(m.name, m.arguments, result);
    this.pending.push({ call_id: m.call_id, result });
    this.flushTools();
    // Market noise can keep "someone is speaking" going, which holds results
    // back. After 4 seconds, send anyway rather than leave the agent silent.
    clearTimeout(this.toolWatchdog);
    this.toolWatchdog = setTimeout(() => {
      if (!this.pending.length) return;
      this.lastEvent = "reply.done";
      this.flushTools();
    }, 4000);
  }

  // Results go back only when reply.done is the latest event, as the API requires.
  flushTools() {
    if (this.lastEvent !== "reply.done" || !this.pending.length) return;
    for (const p of this.pending) this.send({ type: "tool.result", call_id: p.call_id, result: JSON.stringify(p.result), is_error: p.result.ok === false });
    this.pending = [];
  }

  runTool(name, args) {
    const st = this.store.state;
    const drafters = { draft_sale: draftSale, draft_payment: draftPayment, draft_restock: draftRestock,
      draft_new_product: draftNewProduct, draft_price_change: draftPriceChange, draft_expense: draftExpense };
    if (drafters[name]) {
      // The owner said the customer paid everything, but the agent left the amount out
      // (it may not do sums). The app knows the total, so it fills it in.
      if (name === "draft_sale" && (args.amount_paid == null || args.amount_paid === "") && PAID_IN_FULL.test(this.lastUser)) args = { ...args, amount_paid: "full" };
      const r = drafters[name](st, args);
      if (!r.ok) return { ok: false, error: r.error };
      this.draft = r.draft;
      this.on.draft(this.draft);
      return { ok: true, say: r.draft.say };
    }
    if (name === "confirm_draft") {
      if (!this.draft) return { ok: false, error: "There is nothing waiting to be saved. Ask what they want to record." };
      // The owner's own words decide, not the model's reading of them.
      if (!isYes(this.lastUser))
        return { ok: false, error: `Not saved: the owner's last words were "${this.lastUser}", which is not a clear yes. Ask them to say yes to save, or tell you what to change.` };
      return { ok: true, say: this.save() };
    }
    if (name === "cancel_draft") {
      this.draft = null; this.on.draft(null);
      return { ok: true, say: "Cancelled, nothing saved." };
    }
    if (name === "undo_last") return this.undo();
    if (name === "check_stock") {
      const r = stockReport(st, args.product);
      return r.ok ? { ok: true, say: r.say } : { ok: false, error: r.error };
    }
    if (name === "today_summary") return { ok: true, say: todaySummary(st).say };
    if (name === "period_summary") {
      const label = args.period === "month" ? "This month" : "This week";
      return { ok: true, say: summary(st, periodStart(args.period), new Date(), label).say };
    }
    if (name === "who_owes") return { ok: true, say: whoOwesSay(st) };
    if (name === "close_day") {
      const r = dailyClose(st);
      this.on.dayClose?.(r.text);
      return { ok: true, say: r.say };
    }
    if (name === "remind_customer") {
      const r = reminder(st, args.customer);
      if (!r.ok) return { ok: false, error: r.error };
      if (r.text) this.on.reminder(r.customer, r.text);
      return { ok: true, say: r.say };
    }
    if (name === "check_account") {
      const m = bestMatch(st.customers, args.customer, ["name"]);
      if (!m.match) return { ok: false, error: m.candidates ? `Unclear, close names: ${m.candidates.map(c => c.name).join(", ")}. Ask which.` : `No customer called '${args.customer}'.` };
      const b = balanceOf(m.match).balance;
      this.on.focus(m.match.name);
      return { ok: true, say: standingText(m.match.name, b).replace(/^./, c => c.toUpperCase()) + "." };
    }
    return { ok: false, error: `Unknown tool ${name}` };
  }

  save() {
    const hadNew = this.draft.isNew || this.draft.kind === "product";
    const { receipt, say } = commit(this.store.state, this.draft);
    this.store.save();
    this.draft = null;
    this.on.draft(null);
    this.on.saved(receipt);
    // A new customer's or product's name joins the words AssemblyAI listens for, at once.
    if (hadNew) this.send({ type: "session.update", session: { input: { keyterms: shopKeyterms(this.store.state) } } });
    return say;
  }

  undo(ref) {
    const r = undo(this.store.state, ref);
    if (!r.ok) return { ok: false, error: r.error };
    this.store.save();
    this.on.saved(r.receipt);
    return { ok: true, say: r.say };
  }

  // The Confirm button on screen does the same save, then has the agent say it.
  confirmFromScreen() {
    if (!this.draft) return;
    const say = this.save();
    if (this.ready) {
      this.send({ type: "conversation.message", role: "system", content: `The owner confirmed on screen and it was saved.` });
      this.send({ type: "reply.create", instructions: `Say exactly: "${say}"` });
    }
  }

  cancelFromScreen() {
    this.draft = null; this.on.draft(null);
    if (this.ready) this.send({ type: "conversation.message", role: "system", content: "The owner cancelled the draft on screen. Nothing was saved." });
  }

  play(b64data) {
    if (!this.playCtx) return;
    const bin = atob(b64data), n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 0x8000) v -= 0x10000; f[i] = v / 32768; }
    const buf = this.playCtx.createBuffer(1, n, 24000);
    buf.getChannelData(0).set(f);
    const src = this.playCtx.createBufferSource();
    src.buffer = buf; src.connect(this.playCtx.destination);
    this.playAt = Math.max(this.playAt, this.playCtx.currentTime);
    src.start(this.playAt);
    this.playAt += buf.duration;
    this.playing.push(src);
    src.onended = () => { this.playing = this.playing.filter(s => s !== src); };
  }

  flushPlayback() {
    for (const s of this.playing) { try { s.stop(); } catch {} }
    this.playing = [];
    if (this.playCtx) this.playAt = this.playCtx.currentTime;
  }
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
