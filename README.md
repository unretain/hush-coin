# 🤫 $HUSH — Meme Coin Site + Real Airdrop + Meme Maker

A cartoon-themed memecoin site for **$HUSH** (the cat that got booped on the nose and said *hush*).
Includes a **real on-chain Solana creator-fee airdrop** backend and a **canvas meme generator**.

- **Token / CA:** `CvyAHeWHhuyGHWp8Rvu1j7FPSv5pJNdoLuTudd8Mpump`
- **Mint type:** Token-2022 (pump.fun), 1,000,000,000 supply, 6 decimals

## Run it locally

```bash
cd server
npm install        # already done
npm start          # serves the site + API on http://127.0.0.1:8080
```

Open **http://127.0.0.1:8080**.

## What's real vs. demo

| Feature | Status |
|---|---|
| Live $HUSH balance of a connected wallet | ✅ Real (reads Solana mainnet) |
| Reward-vault balance (creator-fee wallet SOL) | ✅ Real (`getBalance`) |
| Holder snapshot / count | ✅ Real (`getProgramAccounts`, falls back to top holders on public RPC) |
| Pro-rata share calculation | ✅ Real |
| Sending SOL on claim / distribute | ✅ Real **when ARMED** — otherwise a safe dry-run |
| Meme generator | ✅ Fully client-side |

The site reads real chain data out of the box. To actually **move SOL**, arm the backend.

## Arming real airdrops

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:

- `RPC_URL` — use a provider RPC (Helius / QuickNode / Triton). The **public**
  `api.mainnet-beta.solana.com` rate-limits and restricts `getProgramAccounts`,
  so the full holder set needs a provider key. (Reads still work; snapshots fall
  back to top-holders.)
- `FEE_WALLET` — the wallet that receives pump.fun creator fees (= the "vault").
- `PAYER_SECRET_KEY` — base58 secret key of the creator wallet that funds payouts.
  **Never commit this.**
- `ARMED=true` — flip on to broadcast real transactions.

Restart `npm start`. The console prints `✅ ARMED` when live.

## How the airdrop works

1. **Snapshot** — backend reads every $HUSH holder + balance from chain.
2. **Vault** — collected creator fees sit in `FEE_WALLET`; its SOL balance is shown live.
3. **Claim** (holder) — `POST /api/claim` computes your pro-rata share
   (`yourHush / totalHush × vaultSol`) and sends it to your wallet. A local
   `claims.json` ledger prevents double-claims per round.
4. **Distribute** (creator) — `POST /api/distribute {budgetSol}` builds a pro-rata
   plan across all holders and sends batched transfers, then advances the round.

### API

| Endpoint | Description |
|---|---|
| `GET /api/config` | network + armed status |
| `GET /api/vault` | live SOL in the fee wallet |
| `GET /api/holders` | live holder snapshot (cached 60s) |
| `GET /api/balance/:owner` | a wallet's $HUSH balance + estimated share |
| `POST /api/claim` | pay a wallet its share (real when armed) |
| `POST /api/distribute` | pro-rata distribute a SOL budget to all holders |

## Meme maker

Pick a cat photo, click stickers (🎩 👑 🕶️ 💎 🤫 …) to add them, then:
- **drag** to move, **green dot** to resize, **pink dot** to rotate
- add top/bottom meme text, **Download PNG**

## Files

```
site/        index.html, styles.css, app.js, meme.js, assets/ (cat photos)
server/      server.js, solana.js, package.json, .env.example
```

## Disclaimer
$HUSH is a meme coin with no intrinsic value. Cartoon cat for entertainment.
Arming the backend moves real funds — test on a throwaway wallet / devnet first.
