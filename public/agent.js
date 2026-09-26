// The conversation with AssemblyAI's Voice Agent API. AssemblyAI listens,
// understands and speaks. This file hands it the shop's own words to listen
// for, and the tools it must use to touch the books. The books never trust
// the model with a number: tools compute everything and return the sentence
// to read back.
import { draftSale, draftPayment, commit, undo, todaySummary, reminder, balanceOf, bestMatch, standingText, shopKeyterms } from "./ledger.js";

const WS_URL = "wss://agents.assemblyai.com/v1/ws";
const YES = /\b(gbam|yes|yeah|yep|yup|correct|confirm(ed)?|save( it)?|ok(ay)?|go ahead|do am|sure|that'?s right|na so|e correct|oya|save am)\b/i;
const NO = /\b(no|not|don'?t|wrong|cancel|wait|stop|change|no be so)\b/i;

function systemPrompt(shop) {
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
10. "Remind X", "send X reminder", "tell X to pay": call remind_customer.
11. If a price sounds odd, the tool will say so. Ask the owner to say the price again; only if they repeat the same price, draft again with price_confirmed true.
12. Money is naira. "3k" or "3 thousand" means 3000. "Two-five" after a thousand amount usually means 2,500; if unsure, ask.
13. "Gbam" means yes, exactly.
14. One short sentence per reply. You are talking to a busy person at a counter.`;
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
      amount_paid: { type: "number", description: "Naira the customer paid now, only if said. Leave out if nothing was said about payment." },
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
  { type: "function", name: "undo_last",
    description: "Take the most recently saved sale or payment back out of the books, when the owner says undo or that it was wrong. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "today_summary",
    description: "Today's totals: number of sales, money sold, cash that came in, and how much went out on credit. Returns the sentence to say.",
    parameters: { type: "object", properties: {} } },
  { type: "function", name: "remind_customer",
    description: "Prepare a polite WhatsApp reminder to a customer about what they owe. It is shown on screen for the owner to send; nothing is sent automatically. Returns the sentence to say.",
    parameters: { type: "object", properties: { customer: { type: "string", description: "Customer's name as said, e.g. 'Emeka'." } }, required: ["customer"] } },
  { type: "function", name: "check_account",
    description: "Look up what a customer owes, or how much deposit the shop is holding for them. Returns the sentence to say.",
    parameters: { type: "object", properties: {
      customer: { type: "string", description: "Customer's name as said." } }, required: ["customer"] } },
];

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
      system_prompt: systemPrompt(st.shop),
      greeting: "I'm listening. Tell me a sale or a payment.",
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
  // 20 quiet seconds, or 60 while a draft waits for a yes.
  bumpIdle() {
    clearTimeout(this.idleTimer);
    if (!this.ready) return;
    this.idleTimer = setTimeout(() => {
      this.endReason = "Hung up after a quiet spell, to save cost. Tap to talk again.";
      this.stop();
    }, this.draft ? 60000 : 20000);
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
    if (name === "draft_sale" || name === "draft_payment") {
      const r = name === "draft_sale" ? draftSale(st, args) : draftPayment(st, args);
      if (!r.ok) return { ok: false, error: r.error };
      this.draft = r.draft;
      this.on.draft(this.draft);
      return { ok: true, say: r.draft.say };
    }
    if (name === "confirm_draft") {
      if (!this.draft) return { ok: false, error: "There is nothing waiting to be saved. Ask what they want to record." };
      // The owner's own words decide, not the model's reading of them.
      if (!YES.test(this.lastUser) || NO.test(this.lastUser))
        return { ok: false, error: `Not saved: the owner's last words were "${this.lastUser}", which is not a clear yes. Ask them to say yes to save, or tell you what to change.` };
      return { ok: true, say: this.save() };
    }
    if (name === "cancel_draft") {
      this.draft = null; this.on.draft(null);
      return { ok: true, say: "Cancelled, nothing saved." };
    }
    if (name === "undo_last") return this.undo();
    if (name === "today_summary") return { ok: true, say: todaySummary(st).say };
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
    const hadNew = this.draft.isNew;
    const { receipt, say } = commit(this.store.state, this.draft);
    this.store.save();
    this.draft = null;
    this.on.draft(null);
    this.on.saved(receipt);
    // A new customer's name joins the words AssemblyAI listens for, at once.
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
