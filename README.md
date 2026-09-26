# Gbam

Talk to your shop's record book. Say the sale, hear it read back, say yes.

> "Two bags of rice, three thousand each, to Musa."
> **Gbam:** "2 bags of rice at three thousand. Total six thousand naira. Musa will owe ten thousand naira. Say yes."
> "Yes."
> **Gbam:** "Saved. Receipt zero zero one. Musa owes ten thousand naira."

## Why I built this

I run a business in a market, mostly on my own. When it's busy I'm serving one customer, pricing for the next, and trying to remember who took goods on credit and who has paid. Stopping to type every sale into a phone slows the queue down, and hiring someone just to keep the books costs money a small trader doesn't have.

So I wanted to keep my hands free and just say it. I say the sale out loud, it reads it back, I say yes, and it's in the book. I don't pay for an extra person, and my customers don't stand around waiting while I write.

This is the voice layer for [PriceKeeper](#about-pricekeeper), the record book I already use for my own business.

## Why AssemblyAI is the core, not an add-on

Take AssemblyAI out and there is no product left. The owner never types. AssemblyAI's **Voice Agent API** does all three jobs in the conversation: it hears the owner, decides what to do, and speaks back.

What makes it work for one particular shop:

| What we use | What it does here |
|---|---|
| `input.keyterms` | The shop's own customer names and stock ("Musa", "Mama Ngozi", "Indomie", "Golden Penny spaghetti") are sent as key terms, so the recogniser listens for *this* shop's words. A new customer is added to the list the moment they are saved, mid-conversation. |
| `input.transcription_prompt` | Tells the recogniser it is hearing a Nigerian shop owner saying quantities, products, naira prices and names. |
| Client-side tools | The agent never touches the books directly. It calls `draft_sale`, `draft_payment`, `check_account`, `confirm_draft`, `cancel_draft`, which run in the browser against the ledger. |
| Adaptive turn detection | The owner can pause mid-sentence while serving someone ("two bags of rice ... three thousand each ... to Musa") and the agent waits for the whole sale. |
| Barge-in | "No, wait" stops the read-back straight away. |

The loop: **the ledger teaches the recogniser** (names and products become key terms), and **the recogniser writes the ledger** (through the tools).

## The safety rule: the AI never does the maths

A wrong number in a customer's credit account is worse than no app at all. So:

1. The language model only extracts *who*, *what* and *how many*. Every price, total and balance is computed by [`public/ledger.js`](public/ledger.js).
2. Each tool returns a `say` sentence built by the code, and the agent is instructed to read it word for word.
3. Nothing is written until the owner says yes. `confirm_draft` checks **the owner's own last words** (from AssemblyAI's transcript), not the model's opinion of them. "No, wait" or silence cannot save anything.
4. Names are matched against the shop's customer list. A close mishearing ("Oluwaseyun") finds "Oluwaseun"; a name that is not there is never invented without the owner saying it is a new customer.

We found why this matters while building. In an early test the tool returned "total 6,000, new balance 10,000" and the agent said "Musa owes six thousand". In another, a misheard price put a 17 naira sale of rice on an account. Now the code writes every sentence with a number in it, a price nothing like the usual one is questioned before it can be saved, and "undo that" takes the last save back out.

## Try it

Needs Node 20+ and an AssemblyAI API key. No other dependencies.

```bash
cp .env.example .env        # put your key in it
npm start                   # http://localhost:5178
npm test                    # ledger maths tests
```

Tap the microphone and talk. No microphone? Tap start anyway and type, or tap one of the sample sentences: the agent still answers out loud.

Deep links: `/#receipt=GB-0926-001` opens a saved receipt, so it can be sent to a customer.

## What is real and what is sample

| Real | Sample |
|---|---|
| Live AssemblyAI Voice Agent API: recognition, reasoning and speech | The shop "Mama Bisi Provisions", its 10 customers and 10 products |
| The ledger rules (debts, payments, deposits held for customers) are PriceKeeper's own | Data lives in your browser only (`localStorage`). "Reset sample shop" puts it back |
| Tool calls, read-backs and receipts shown on screen as they happen | |

## Files

| File | What it is |
|---|---|
| `server.js` | Serves the page and mints single-use AssemblyAI tokens. The API key never reaches the browser. Sessions are capped (10 minutes) and rate limited per visitor. |
| `public/agent.js` | The Voice Agent session: config, key terms, tools, audio in and out |
| `public/ledger.js` | The books: matching, maths, drafts, saving, the read-back sentences |
| `public/app.js` | The screen |
| `public/pcm-worklet.js` | Microphone to 24 kHz PCM, works on Chrome, Firefox and Safari |
| `test/ledger.test.mjs` | Tests for the maths, deposits, name matching and the "13,000 is not 3,000" case |

## About PriceKeeper

PriceKeeper is a separate, private shop ledger (stock, prices, customer credit accounts) that runs a real shop today. This repository is new work written for the AssemblyAI Voice Agent Hackathon: only the voice layer, pointed at sample data, so no real customer's information is involved.

## Licence

MIT, see [LICENSE](LICENSE).
