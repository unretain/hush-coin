// ===========================================================
//  $HUSH — real on-chain Solana helpers
//  Reads live holder data and (when ARMED) broadcasts real
//  SOL airdrop transfers from the creator/payer wallet.
// ===========================================================
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const HUSH_MINT = process.env.HUSH_MINT || "CvyAHeWHhuyGHWp8Rvu1j7FPSv5pJNdoLuTudd8Mpump";
export const ARMED = String(process.env.ARMED).toLowerCase() === "true";

export const connection = new Connection(RPC_URL, "confirmed");
export const mint = new PublicKey(HUSH_MINT);

// ---- payer (creator) keypair, optional ----
let payer = null;
if (process.env.PAYER_SECRET_KEY) {
  try {
    payer = Keypair.fromSecretKey(bs58.decode(process.env.PAYER_SECRET_KEY.trim()));
  } catch (e) {
    console.warn("⚠️  PAYER_SECRET_KEY could not be decoded:", e.message);
  }
}
export function getPayer() {
  return payer;
}

// Default vault/deposit wallet (public address — safe to expose). Deposits can
// be received here any time; sending airdrops out requires PAYER_SECRET_KEY for
// this same wallet. Override with FEE_WALLET env if you use a different address.
const DEFAULT_FEE_WALLET = "7YSmPgTLuJgMaUmNkzpkadxXcRKBYmivmZZkty9yE3d7";

// fee/vault wallet = configured FEE_WALLET, else the payer's pubkey, else default
export function feeWallet() {
  if (process.env.FEE_WALLET) return new PublicKey(process.env.FEE_WALLET.trim());
  if (payer) return payer.publicKey;
  return new PublicKey(DEFAULT_FEE_WALLET);
}

export function status() {
  return {
    rpc: RPC_URL,
    mint: HUSH_MINT,
    armed: ARMED,
    payerConfigured: !!payer,
    feeWallet: feeWallet()?.toBase58() || null,
    canDistribute: !!payer && ARMED,
  };
}

// ---- vault balance (real SOL in the creator-fee wallet) ----
export async function vaultBalanceSol() {
  const w = feeWallet();
  if (!w) return 0;
  const lamports = await connection.getBalance(w);
  return lamports / LAMPORTS_PER_SOL;
}

// ---- a single wallet's REAL $HUSH balance ----
export async function balanceOf(owner) {
  const ownerPk = new PublicKey(owner);
  let ui = 0;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await connection.getParsedTokenAccountsByOwner(ownerPk, {
      mint,
      programId,
    });
    for (const { account } of res.value) {
      ui += account.data.parsed.info.tokenAmount.uiAmount || 0;
    }
  }
  return ui;
}

// ---- full holder snapshot from chain ----
// Note: getProgramAccounts on mainnet public RPC is rate-limited; use a
// provider RPC for reliability. Result is cached by the caller.
let _snapCache = { at: 0, data: null };

// detect which token program actually owns this mint (pump.fun => Token-2022)
let _mintProgram = null;
async function mintProgram() {
  if (_mintProgram) return _mintProgram;
  const info = await connection.getParsedAccountInfo(mint);
  _mintProgram = info.value?.owner || TOKEN_PROGRAM_ID;
  return _mintProgram;
}

// FULL holder set via getProgramAccounts (needs a provider RPC for reliability)
async function snapshotViaProgramAccounts(programId) {
  const accounts = await connection.getParsedProgramAccounts(programId, {
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
  });
  const holders = [];
  let decimals = 6;
  for (const { account } of accounts) {
    const info = account.data?.parsed?.info;
    if (!info) continue;
    decimals = info.tokenAmount.decimals ?? decimals;
    const ui = info.tokenAmount.uiAmount || 0;
    if (ui > 0) holders.push({ owner: info.owner, amount: ui });
  }
  return { holders, decimals, source: "getProgramAccounts" };
}

// TOP holders via getTokenLargestAccounts (works on public RPC, top ~20)
async function snapshotViaLargest(programId) {
  const largest = await connection.getTokenLargestAccounts(mint);
  const supply = await connection.getTokenSupply(mint);
  const decimals = supply.value.decimals;
  // resolve token-account -> owner
  const accs = await connection.getMultipleParsedAccounts(
    largest.value.map((a) => a.address),
    { commitment: "confirmed" }
  );
  const holders = [];
  accs.value.forEach((acc, i) => {
    const owner = acc?.data?.parsed?.info?.owner;
    const ui = largest.value[i].uiAmount || 0;
    if (owner && ui > 0) holders.push({ owner, amount: ui });
  });
  return { holders, decimals, source: "getTokenLargestAccounts(top)", partial: true };
}

export async function holderSnapshot({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (_snapCache.data && now - _snapCache.at < maxAgeMs) return _snapCache.data;

  const programId = await mintProgram();
  let res, note = null;
  try {
    res = await snapshotViaProgramAccounts(programId);
    if (!res.holders.length) throw new Error("empty (RPC likely restricts getProgramAccounts)");
  } catch (e) {
    // public RPC fallback: top holders only
    res = await snapshotViaLargest(programId);
    note = "Top-holder snapshot only — set a provider RPC_URL for the full holder set.";
  }

  // merge accounts per owner
  const byOwner = new Map();
  for (const h of res.holders) byOwner.set(h.owner, (byOwner.get(h.owner) || 0) + h.amount);
  const merged = [...byOwner.entries()]
    .map(([owner, amount]) => ({ owner, amount }))
    .sort((a, b) => b.amount - a.amount);

  const data = {
    decimals: res.decimals,
    holderCount: merged.length,
    totalHeld: merged.reduce((s, h) => s + h.amount, 0),
    holders: merged,
    source: res.source,
    partial: !!res.partial,
    note,
    takenAt: now,
  };
  _snapCache = { at: now, data };
  return data;
}

// ---- compute pro-rata airdrop plan ----
// budgetSol distributed across holders proportional to $HUSH held.
export function buildPlan(snapshot, budgetSol, { minLamports = 5000 } = {}) {
  const { holders, totalHeld } = snapshot;
  if (!totalHeld) return [];
  return holders
    .map((h) => {
      const lamports = Math.floor((h.amount / totalHeld) * budgetSol * LAMPORTS_PER_SOL);
      return { owner: h.owner, amount: h.amount, lamports };
    })
    .filter((p) => p.lamports >= minLamports); // skip dust below rent/fee
}

// ---- send one wallet its share (real transfer when ARMED) ----
export async function payOne(ownerStr, lamports) {
  if (!payer) throw new Error("No payer configured");
  if (!ARMED) {
    return { dryRun: true, signature: null, lamports };
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(ownerStr),
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  return { dryRun: false, signature: sig, lamports };
}

// ---- batch distribute a whole plan (real transfers when ARMED) ----
export async function distributePlan(plan, { perTx = 10 } = {}) {
  const results = [];
  if (!payer) {
    return plan.map((p) => ({ ...p, dryRun: true, signature: null }));
  }
  for (let i = 0; i < plan.length; i += perTx) {
    const chunk = plan.slice(i, i + perTx);
    if (!ARMED) {
      for (const p of chunk) results.push({ ...p, dryRun: true, signature: null });
      continue;
    }
    const tx = new Transaction();
    for (const p of chunk) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: new PublicKey(p.owner),
          lamports: p.lamports,
        })
      );
    }
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    for (const p of chunk) results.push({ ...p, dryRun: false, signature: sig });
  }
  return results;
}

export const LAMPORTS = LAMPORTS_PER_SOL;
