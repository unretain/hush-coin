/* ===========================================================
   $HUSH Meme Generator
   Pick a cat base, drag on hats/glasses/stickers, add meme text,
   then download the PNG. Pure canvas — no libraries.
   =========================================================== */
(() => {
  const canvas = document.getElementById("memeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const CATS = ["assets/cat-square.png", "assets/cat-boop.png"];
  const STICKERS = ["🎩","👑","🧢","🎓","🪖","🕶️","🥽","👓","🥸","🚬","🌹","💎","💰","🔥","🤫","😎","🎀","⭐","💵","🍌","👔","🦴","❤️","💀","🧢"];

  let baseImg = new Image();
  let baseLoaded = false;
  const items = [];        // {emoji, x, y, size, rot}
  let selected = null;
  let drag = null;         // {dx,dy} | {mode:'rotate'} | {mode:'scale'}

  const W = 700, H = 700;
  canvas.width = W; canvas.height = H;

  // ---- load base ----
  function setBase(src) {
    baseLoaded = false;
    baseImg = new Image();
    baseImg.onload = () => { baseLoaded = true; draw(); };
    baseImg.src = src;
  }

  // draw base cover-fit
  function drawBase() {
    ctx.fillStyle = "#fff6e6";
    ctx.fillRect(0, 0, W, H);
    if (!baseLoaded) return;
    const ir = baseImg.width / baseImg.height;
    const cr = W / H;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    ctx.drawImage(baseImg, dx, dy, dw, dh);
  }

  // ---- top/bottom meme text ----
  function drawText() {
    const top = document.getElementById("topText").value.toUpperCase();
    const bottom = document.getElementById("bottomText").value.toUpperCase();
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    const fz = Math.round(W * 0.085);
    ctx.font = `800 ${fz}px Impact, "Arial Black", sans-serif`;
    ctx.lineWidth = fz * 0.13;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";
    if (top) { ctx.strokeText(top, W / 2, fz + 10); ctx.fillText(top, W / 2, fz + 10); }
    if (bottom) { ctx.strokeText(bottom, W / 2, H - 24); ctx.fillText(bottom, W / 2, H - 24); }
  }

  // ---- stickers ----
  function drawItem(it, isSel) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    ctx.font = `${it.size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(it.emoji, 0, 0);
    if (isSel) {
      const r = it.size * 0.62;
      ctx.strokeStyle = "#3f6cff";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 3;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.setLineDash([]);
      // scale handle (bottom-right) + rotate handle (top)
      ctx.fillStyle = "#7fe0c0";
      ctx.strokeStyle = "#2b2440";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r, r, 9, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff8fb1";
      ctx.beginPath(); ctx.arc(0, -r - 22, 9, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r - 13); ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    drawBase();
    for (const it of items) drawItem(it, it === selected);
    drawText();
  }

  // ---- hit testing in item-local space ----
  function localPoint(it, px, py) {
    const dx = px - it.x, dy = py - it.y;
    const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function hitItem(px, py) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const p = localPoint(it, px, py);
      const r = it.size * 0.62;
      if (Math.abs(p.x) <= r && Math.abs(p.y) <= r) return it;
    }
    return null;
  }
  function hitHandle(it, px, py) {
    if (!it) return null;
    const p = localPoint(it, px, py);
    const r = it.size * 0.62;
    if (Math.hypot(p.x - r, p.y - r) <= 12) return "scale";
    if (Math.hypot(p.x - 0, p.y - (-r - 22)) <= 12) return "rotate";
    return null;
  }

  // ---- pointer events ----
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - rect.left) * (W / rect.width),
      y: (t.clientY - rect.top) * (H / rect.height),
    };
  }

  function onDown(e) {
    e.preventDefault();
    const { x, y } = canvasPos(e);
    const handle = hitHandle(selected, x, y);
    if (handle) { drag = { mode: handle }; return; }
    const it = hitItem(x, y);
    selected = it;
    if (it) drag = { mode: "move", dx: x - it.x, dy: y - it.y };
    draw();
  }
  function onMove(e) {
    if (!drag || !selected) return;
    e.preventDefault();
    const { x, y } = canvasPos(e);
    if (drag.mode === "move") { selected.x = x - drag.dx; selected.y = y - drag.dy; }
    else if (drag.mode === "scale") {
      const p = localPoint(selected, x, y);
      selected.size = Math.max(24, Math.min(420, Math.max(Math.abs(p.x), Math.abs(p.y)) * 1.6));
    } else if (drag.mode === "rotate") {
      selected.rot = Math.atan2(y - selected.y, x - selected.x) + Math.PI / 2;
    }
    draw();
  }
  function onUp() { drag = null; }

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", onDown, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onUp);

  // ---- build sticker palette ----
  const tray = document.getElementById("stickerTray");
  STICKERS.forEach((emoji) => {
    const b = document.createElement("button");
    b.className = "sticker-btn";
    b.textContent = emoji;
    b.title = "Add " + emoji;
    b.addEventListener("click", () => {
      const it = { emoji, x: W / 2, y: H / 2, size: 120, rot: 0 };
      items.push(it);
      selected = it;
      draw();
    });
    tray.appendChild(b);
  });

  // ---- base picker ----
  const basesEl = document.getElementById("memeBases");
  CATS.forEach((src, i) => {
    const t = document.createElement("img");
    t.src = src; t.className = "base-thumb" + (i === 0 ? " active" : "");
    t.addEventListener("click", () => {
      basesEl.querySelectorAll(".base-thumb").forEach((n) => n.classList.remove("active"));
      t.classList.add("active");
      setBase(src);
    });
    basesEl.appendChild(t);
  });

  // ---- controls ----
  document.getElementById("topText").addEventListener("input", draw);
  document.getElementById("bottomText").addEventListener("input", draw);
  document.getElementById("deleteSticker").addEventListener("click", () => {
    if (!selected) return;
    items.splice(items.indexOf(selected), 1);
    selected = null; draw();
  });
  document.getElementById("clearMeme").addEventListener("click", () => {
    items.length = 0; selected = null;
    document.getElementById("topText").value = "";
    document.getElementById("bottomText").value = "";
    draw();
  });
  document.getElementById("downloadMeme").addEventListener("click", () => {
    const wasSel = selected; selected = null; draw();
    const a = document.createElement("a");
    a.download = "hush-meme.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
    selected = wasSel; draw();
  });

  // deselect when clicking empty canvas handled in onDown; also Esc
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { selected = null; draw(); }
    if ((e.key === "Delete" || e.key === "Backspace") && selected &&
        document.activeElement.tagName !== "INPUT") {
      items.splice(items.indexOf(selected), 1); selected = null; draw();
    }
  });

  setBase(CATS[0]);
})();
