// ===========================================================
//  $HUSH — server: serves the website + real airdrop API
// ===========================================================
import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  status,
  vaultBalanceSol,
  balanceOf,
  holderSnapshot,
  buildPlan,
  distributePlan,
  payOne,
  feeWallet,
  ARMED,
  LAMPORTS,
} from "./solana.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, "..", "site");
const CLAIMS_FILE = path.join(__dirname, "claims.json");
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json());

// ---- simple claims ledger (prevents double-claim per round) ----
function loadClaims() {
  try { return JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf8")); }
  catch { return { round: 1, claimed: {} }; }
}
function saveClaims(c) { fs.writeFileSync(CLAIMS_FILE, JSON.stringify(c, null, 2)); }

// ---------- API ----------

// network + arming status
app.get("/api/config", (req, res) => res.json(status()));

// vault = real SOL balance of the creator-fee wallet
app.get("/api/vault", async (req, res) => {
  try {
    const sol = await vaultBalanceSol();
    const claims = loadClaims();
    res.json({ vaultSol: sol, feeWallet: feeWallet()?.toBase58() || null, round: claims.round });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// real holder snapshot (cached ~60s)
app.get("/api/holders", async (req, res) => {
  try {
    const snap = await holderSnapshot();
    res.json({
      holderCount: snap.holderCount,
      totalHeld: snap.totalHeld,
      decimals: snap.decimals,
      source: snap.source,
      partial: snap.partial,
      note: snap.note,
      takenAt: snap.takenAt,
      top: snap.holders.slice(0, 25),
    });
  } catch (e) {
    res.status(502).json({ error: "snapshot failed: " + e.message + " (try a provider RPC_URL)" });
  }
});

// a wallet's real $HUSH balance + estimated pro-rata share
app.get("/api/balance/:owner", async (req, res) => {
  try {
    const bal = await balanceOf(req.params.owner);
    const [snap, vaultSol] = await Promise.all([holderSnapshot(), vaultBalanceSol()]);
    const share = snap.totalHeld ? (bal / snap.totalHeld) * vaultSol : 0;
    const claims = loadClaims();
    res.json({
      owner: req.params.owner,
      balance: bal,
      estimatedShareSol: share,
      claimed: !!claims.claimed[req.params.owner],
      round: claims.round,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// holder claim: pays the connected wallet its pro-rata share (real when ARMED)
app.post("/api/claim", async (req, res) => {
  try {
    const { owner } = req.body || {};
    if (!owner) return res.status(400).json({ error: "owner required" });

    const claims = loadClaims();
    if (claims.claimed[owner]) return res.status(409).json({ error: "already claimed this round" });

    const bal = await balanceOf(owner);
    if (bal <= 0) return res.status(403).json({ error: "wallet holds no $HUSH" });

    const [snap, vaultSol] = await Promise.all([holderSnapshot(), vaultBalanceSol()]);
    const shareSol = snap.totalHeld ? (bal / snap.totalHeld) * vaultSol : 0;
    const lamports = Math.floor(shareSol * LAMPORTS);
    if (lamports < 5000) return res.status(400).json({ error: "share too small to pay out" });

    const result = await payOne(owner, lamports);

    if (!result.dryRun) {
      claims.claimed[owner] = { lamports, signature: result.signature, at: Date.now() };
      saveClaims(claims);
    }
    res.json({
      owner,
      paidSol: lamports / LAMPORTS,
      signature: result.signature,
      dryRun: result.dryRun,
      message: result.dryRun
        ? "DRY-RUN: configure PAYER_SECRET_KEY and ARMED=true to send real SOL."
        : "Airdrop sent on-chain.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// creator: distribute a SOL budget pro-rata to all holders (real when ARMED)
app.post("/api/distribute", async (req, res) => {
  try {
    const budgetSol = Number(req.body?.budgetSol);
    if (!budgetSol || budgetSol <= 0) return res.status(400).json({ error: "budgetSol required" });

    const snap = await holderSnapshot();
    const plan = buildPlan(snap, budgetSol);
    if (!plan.length) return res.status(400).json({ error: "no eligible holders in snapshot" });

    const results = await distributePlan(plan);
    const dryRun = results.every((r) => r.dryRun);
    const totalLamports = results.reduce((s, r) => s + r.lamports, 0);

    // advance round so claims reset
    const claims = loadClaims();
    claims.round += 1;
    claims.claimed = {};
    saveClaims(claims);

    res.json({
      recipients: results.length,
      totalSol: totalLamports / LAMPORTS,
      dryRun,
      newRound: claims.round,
      sample: results.slice(0, 10),
      message: dryRun
        ? "DRY-RUN plan computed from live holders. Set PAYER_SECRET_KEY + ARMED=true to broadcast."
        : "Distributed on-chain to holders.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- static site ----------
app.use(express.static(SITE_DIR));
app.get("*", (req, res) => {
  // only fall back to index.html for page routes, not missing assets/api
  if (path.extname(req.path) || req.path.startsWith("/api/")) return res.status(404).json({ error: "not found" });
  res.sendFile(path.join(SITE_DIR, "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  const s = status();
  console.log(`\n🤫  $HUSH server running:  http://127.0.0.1:${PORT}`);
  console.log(`    RPC:     ${s.rpc}`);
  console.log(`    Mint:    ${s.mint}`);
  console.log(`    Mode:    ${s.canDistribute ? "✅ ARMED (real transfers)" : "🧪 DRY-RUN (reads real data, no transfers)"}`);
  if (!s.payerConfigured) console.log(`    Tip:     add PAYER_SECRET_KEY + ARMED=true in server/.env to send real airdrops.\n`);
});
