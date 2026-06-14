/* ===========================================================
   $HUSH — front-end logic (talks to the real backend /api)
   - Copy CA
   - Live vault (creator-fee wallet SOL) + holder snapshot from chain
   - Phantom wallet connect -> real $HUSH balance + pro-rata share
   - Real claim + creator distribute (dry-run unless backend ARMED)
   =========================================================== */

const CA = "CvyAHeWHhuyGHWp8Rvu1j7FPSv5pJNdoLuTudd8Mpump";
const $ = (id) => document.getElementById(id);
const fmt = (n, d = 3) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

let wallet = null;
let cfg = null;

/* ---------- toast ---------- */
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- copy CA ---------- */
$("copyCa").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(CA); }
  catch {
    const r = document.createRange();
    r.selectNode($("ca")); getSelection().removeAllRanges(); getSelection().addRange(r);
    document.execCommand("copy");
  }
  toast("Copied! 🤫");
});

/* ---------- animated number ---------- */
function animateNum(el, to, decimals = 3) {
  const from = parseFloat(el.dataset.val || "0");
  const start = performance.now(), dur = 700;
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el.textContent = fmt(v, decimals);
    if (p < 1) requestAnimationFrame(frame); else el.dataset.val = to;
  }
  el.dataset.val = from;
  requestAnimationFrame(frame);
}

/* ---------- API helper ---------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}

/* ===========================================================
   LOAD network status + live vault/holders
   =========================================================== */
async function loadConfig() {
  const b = $("netBanner");
  try {
    cfg = await api("/api/config");
    if (cfg.canDistribute) {
      b.className = "net-banner live";
      b.textContent = "🟢 LIVE — armed for real airdrops on Solana mainnet";
    } else {
      b.className = "net-banner dry";
      b.textContent = "🧪 DRY-RUN — reading real chain data; transfers off until creator key is set in server/.env";
    }
  } catch {
    b.className = "net-banner err";
    b.textContent = "⚠️ Backend offline — run the Node server (see README)";
  }
}

async function loadVaultAndHolders() {
  try {
    const v = await api("/api/vault");
    animateNum($("vaultSol"), v.vaultSol, 3);
  } catch {
    $("vaultSol").textContent = "—";
  }
  try {
    const h = await api("/api/holders");
    $("holderCount").textContent = Number(h.holderCount).toLocaleString();
  } catch (e) {
    $("holderCount").textContent = "—";
  }
}

/* ===========================================================
   COUNTDOWN to next airdrop (top of the hour)
   =========================================================== */
function tickCountdown() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  let diff = Math.max(0, next - now) / 1000;
  const p = (n) => String(Math.floor(n)).padStart(2, "0");
  $("nextDrop").textContent = `${p(diff / 3600)}:${p((diff % 3600) / 60)}:${p(diff % 60)}`;
}
setInterval(tickCountdown, 1000);
tickCountdown();

/* ===========================================================
   WALLET CONNECT (real Phantom) + real balance/share
   =========================================================== */
$("connectBtn").addEventListener("click", async () => {
  const provider = window.solana;
  if (!provider || !provider.isPhantom) {
    toast("Phantom not found — install it to connect 🦊");
    window.open("https://phantom.app/", "_blank");
    return;
  }
  try {
    const res = await provider.connect();
    wallet = res.publicKey.toString();
  } catch { toast("Connection cancelled"); return; }

  const short = wallet.slice(0, 4) + "…" + wallet.slice(-4);
  $("walletStatus").innerHTML = `Connected: <strong>${short}</strong>`;
  $("connectBtn").textContent = "✅ Connected";
  await refreshShare();
});

async function refreshShare() {
  if (!wallet) return;
  $("shareNote").textContent = "Reading your $HUSH balance on-chain…";
  try {
    const d = await api("/api/balance/" + wallet);
    $("shareAmt").textContent = fmt(d.estimatedShareSol, 3);
    if (d.balance <= 0) {
      $("shareNote").textContent = "This wallet holds no $HUSH yet — buy some to qualify.";
      $("claimBtn").disabled = true;
    } else if (d.claimed) {
      $("shareNote").textContent = "🎉 Already claimed this round.";
      $("claimBtn").disabled = true;
    } else {
      $("shareNote").textContent = `Holding ${Number(d.balance).toLocaleString()} $HUSH`;
      $("claimBtn").disabled = d.estimatedShareSol <= 0;
    }
  } catch (e) {
    $("shareNote").textContent = "Couldn't read balance: " + e.message;
  }
}

/* ---------- claim ---------- */
$("claimBtn").addEventListener("click", async () => {
  if (!wallet) return;
  $("claimStatus").textContent = "Submitting claim…";
  $("claimBtn").disabled = true;
  try {
    const r = await api("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: wallet }),
    });
    if (r.dryRun) {
      $("claimStatus").innerHTML =
        `🧪 Dry-run: you'd receive <strong>${fmt(r.paidSol)} SOL</strong>. (Arm the backend to send for real.)`;
      toast("Dry-run claim: " + fmt(r.paidSol) + " SOL 🤫");
    } else {
      $("claimStatus").innerHTML =
        `🎉 Sent <strong>${fmt(r.paidSol)} SOL</strong>! <a href="https://solscan.io/tx/${r.signature}" target="_blank" rel="noopener">View tx ↗</a>`;
      toast("Airdrop claimed! 🎁");
    }
    loadVaultAndHolders();
  } catch (e) {
    $("claimStatus").textContent = "⚠️ " + e.message;
    $("claimBtn").disabled = false;
  }
});

/* ===========================================================
   CREATOR: distribute budget pro-rata to live holders
   =========================================================== */
$("distributeBtn").addEventListener("click", async () => {
  const budgetSol = parseFloat($("budgetInput").value);
  if (!budgetSol || budgetSol <= 0) { toast("Enter a SOL budget"); return; }
  $("creatorStatus").textContent = "Building plan from live holder snapshot…";
  try {
    const r = await api("/api/distribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetSol }),
    });
    $("creatorStatus").innerHTML = r.dryRun
      ? `🧪 Dry-run plan: <strong>${fmt(r.totalSol)} SOL</strong> across <strong>${r.recipients}</strong> holders. Arm the backend to broadcast.`
      : `✅ Distributed <strong>${fmt(r.totalSol)} SOL</strong> to <strong>${r.recipients}</strong> holders (round ${r.newRound}).`;
    toast(r.dryRun ? "Dry-run distribute ready 🧪" : "Distributed on-chain! 🎁");
    loadVaultAndHolders();
  } catch (e) {
    $("creatorStatus").textContent = "⚠️ " + e.message;
  }
});

/* ---------- init ---------- */
loadConfig();
loadVaultAndHolders();
setInterval(loadVaultAndHolders, 60_000);
