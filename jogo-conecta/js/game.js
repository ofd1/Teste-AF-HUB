/**
 * Conecta — lógica do tabuleiro em circuito fechado.
 * Sem dependências externas; usa localStorage para salvar o progresso
 * (estrelas, voltas, Bloco personalizado) no navegador da criança.
 */

const STORAGE_KEY = "conecta:v1";
const BOARD_COLS = 8;
const BOARD_ROWS = 6;
const TILE_CYCLE = ["eye", "comm", "eye", "comm", "star"];
const PIP_MAP = { 1: [4], 2: [2, 6], 3: [0, 4, 8] };
const CARD_SOURCES = { eye: EYE_CARDS, comm: COMM_CARDS, star: STAR_MESSAGES };
const TILE_META = {
  eye: { icon: "👀", label: "Contato Visual" },
  comm: { icon: "💬", label: "Comunicação" },
  star: { icon: "⭐", label: "Bônus" },
  start: { icon: "🏠", label: "Início" },
};

let state;
let loopPath = [];
let tileEls = [];
let TOTAL_TILES = 24;
let queues = { eye: [], comm: [], star: [] };
let audioCtx;
let bannerTimeout;

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------- Estado / persistência ---------------- */

function defaultState() {
  return {
    position: 0,
    laps: 0,
    stars: 0,
    avatarColor: AVATAR_COLORS[0].value,
    accessory: "none",
    settings: { sound: false, anim: true, calm: false },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return Object.assign(base, parsed, {
      settings: Object.assign(base.settings, parsed.settings || {}),
    });
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* localStorage indisponível: o progresso simplesmente não é salvo */
  }
}

function applyBodyClasses() {
  document.body.classList.toggle("no-anim", !state.settings.anim);
  document.body.classList.toggle("calm-mode", state.settings.calm);
}

/* ---------------- Tabuleiro (circuito fechado) ---------------- */

function buildLoopPath(cols, rows) {
  const path = [];
  for (let c = 0; c < cols; c++) path.push({ col: c, row: 0 });
  for (let r = 1; r < rows; r++) path.push({ col: cols - 1, row: r });
  for (let c = cols - 2; c >= 0; c--) path.push({ col: c, row: rows - 1 });
  for (let r = rows - 2; r >= 1; r--) path.push({ col: 0, row: r });
  return path;
}

function tileType(i) {
  if (i === 0) return "start";
  return TILE_CYCLE[(i - 1) % TILE_CYCLE.length];
}

function renderBoard() {
  const board = $("#board");
  const boardCenter = $("#boardCenter");
  loopPath = buildLoopPath(BOARD_COLS, BOARD_ROWS);
  const frag = document.createDocumentFragment();
  tileEls = loopPath.map((pos, i) => {
    const type = tileType(i);
    const meta = TILE_META[type];
    const el = document.createElement("div");
    el.className = `tile tile--${type}`;
    el.style.gridColumn = String(pos.col + 1);
    el.style.gridRow = String(pos.row + 1);
    el.title = type === "start" ? "Início" : meta.label;
    el.innerHTML =
      `<span class="tile-idx">${i}</span>` +
      `<span aria-hidden="true">${meta.icon}</span>`;
    frag.appendChild(el);
    return el;
  });
  board.insertBefore(frag, boardCenter);
  TOTAL_TILES = tileEls.length;
}

function positionToken(animated) {
  const token = $("#token");
  const tileEl = tileEls[state.position];
  if (!token || !tileEl) return;
  const x = tileEl.offsetLeft + (tileEl.offsetWidth - token.offsetWidth) / 2;
  const y = tileEl.offsetTop + (tileEl.offsetHeight - token.offsetHeight) / 2;
  if (!animated) {
    token.style.transition = "none";
    token.style.transform = `translate(${x}px, ${y}px)`;
    void token.offsetWidth;
    token.style.transition = "";
  } else {
    token.style.transform = `translate(${x}px, ${y}px)`;
  }
  updateCurrentTileHighlight();
}

function updateCurrentTileHighlight() {
  tileEls.forEach((el, i) => el.classList.toggle("is-current", i === state.position));
}

/* ---------------- Dado e movimento ---------------- */

function setDieFace(value) {
  const active = new Set(PIP_MAP[value] || []);
  $$(".die .dot").forEach((dot, i) => dot.classList.toggle("on", active.has(i)));
}

function setControlsEnabled(enabled) {
  $("#dieBtn").disabled = !enabled;
  $("#advanceBtn").disabled = !enabled;
}

function rollDie() {
  setControlsEnabled(false);
  const die = $("#dieBtn");
  die.classList.add("rolling");
  let ticks = 0;
  const maxTicks = 9;
  const interval = setInterval(() => {
    setDieFace(1 + Math.floor(Math.random() * 3));
    ticks++;
    if (ticks >= maxTicks) {
      clearInterval(interval);
      die.classList.remove("rolling");
      const result = 1 + Math.floor(Math.random() * 3);
      setDieFace(result);
      setTimeout(() => movePlayer(result), 220);
    }
  }, 80);
}

function movePlayer(steps) {
  let remaining = steps;
  let lapped = false;
  function hop() {
    if (remaining <= 0) {
      finishMove(lapped);
      return;
    }
    state.position = (state.position + 1) % TOTAL_TILES;
    if (state.position === 0) lapped = true;
    positionToken(true);
    playChime("tick");
    remaining -= 1;
    setTimeout(hop, 230);
  }
  hop();
}

function finishMove(lapped) {
  saveState();
  if (lapped) {
    state.laps += 1;
    updateStatPills();
    awardStar(2, true);
    showBanner("🏁 " + randomFrom(LAP_MESSAGES));
    setTimeout(handleTileLanding, 700);
  } else {
    handleTileLanding();
  }
}

function handleTileLanding() {
  const type = tileType(state.position);
  updateCurrentTileHighlight();
  if (type === "start") {
    setControlsEnabled(true);
    return;
  }
  if (type === "star") {
    const card = drawCard("star");
    confettiBurst();
    playChime("star");
    awardStar(1, false);
    showCardModal("star", card);
    return;
  }
  const card = drawCard(type);
  showCardModal(type, card);
}

/* ---------------- Cartas ---------------- */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawCard(category) {
  if (queues[category].length === 0) {
    queues[category] = shuffle(CARD_SOURCES[category].slice());
  }
  return queues[category].pop();
}

function showCardModal(category, card) {
  const modal = $("#cardModal");
  modal.className = "modal-card card--" + category;
  const labels = { eye: "👀 Contato Visual", comm: "💬 Comunicação", star: "⭐ Espaço-bônus" };
  $("#cardKicker").textContent = labels[category];
  $("#cardEmoji").textContent = card.emoji || "✨";
  $("#cardText").textContent = card.text;

  const actions = $("#cardActions");
  if (category === "star") {
    actions.innerHTML =
      `<button class="btn btn-secondary btn-block" id="listenBtn" type="button">🔊 Ouvir</button>` +
      `<button class="btn btn-gold btn-block" id="continueBtn" type="button">Continuar</button>`;
    $("#continueBtn", actions).addEventListener("click", () => closeOverlay("#cardOverlay"));
  } else {
    actions.innerHTML =
      `<button class="btn btn-secondary btn-block" id="listenBtn" type="button">🔊 Ouvir a carta</button>` +
      `<div class="row">` +
      `<button class="btn btn-secondary" id="skipBtn" type="button">Pular</button>` +
      `<button class="btn ${category === "eye" ? "btn-blue" : "btn-green"}" id="doneBtn" type="button">✅ Feito! +1 ⭐</button>` +
      `</div>`;
    $("#skipBtn", actions).addEventListener("click", () => closeOverlay("#cardOverlay"));
    $("#doneBtn", actions).addEventListener("click", () => {
      awardStar(1, true);
      closeOverlay("#cardOverlay");
    });
  }
  $("#listenBtn", actions).addEventListener("click", () => speak(card.text));
  openOverlay("#cardOverlay");
}

/* ---------------- Estrelas, acessórios e avatar ---------------- */

function animatePop(el) {
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

function updateStatPills() {
  $("#starCount").textContent = state.stars;
  $("#lapCount").textContent = state.laps;
}

function checkAccessoryUnlocks(prevStars) {
  ACCESSORIES.forEach((a) => {
    if (a.cost > 0 && prevStars < a.cost && state.stars >= a.cost) {
      setTimeout(() => showBanner(`🎁 Novo acessório: ${a.label} ${a.emoji}`), 900);
    }
  });
}

function awardStar(amount, playSound) {
  const prev = state.stars;
  state.stars += amount;
  if (playSound) playChime("success");
  updateStatPills();
  animatePop($("#starCount"));
  checkAccessoryUnlocks(prev);
  saveState();
}

function applyAvatarVisual(rootEl, color, accessoryId) {
  if (!rootEl) return;
  rootEl.style.setProperty("--avatar-color", color);
  const acc = ACCESSORIES.find((a) => a.id === accessoryId) || ACCESSORIES[0];
  const accEl = rootEl.querySelector(".a-acc");
  if (accEl) accEl.textContent = acc.id === "none" ? "" : acc.emoji;
  rootEl.classList.toggle("has-acc", acc.id !== "none");
}

function refreshAvatar() {
  applyAvatarVisual($("#avatarBtn"), state.avatarColor, state.accessory);
  $("#token").style.setProperty("--avatar-color", state.avatarColor);
}

function renderCloset() {
  applyAvatarVisual($("#closetPreview"), state.avatarColor, state.accessory);

  const swatchWrap = $("#colorSwatches");
  swatchWrap.innerHTML = "";
  AVATAR_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (state.avatarColor === c.value ? " selected" : "");
    b.style.background = c.value;
    b.setAttribute("aria-label", "Escolher cor");
    b.addEventListener("click", () => {
      state.avatarColor = c.value;
      saveState();
      renderCloset();
      refreshAvatar();
    });
    swatchWrap.appendChild(b);
  });

  const accWrap = $("#accessoryGrid");
  accWrap.innerHTML = "";
  ACCESSORIES.forEach((a) => {
    const unlocked = a.cost === 0 || state.stars >= a.cost;
    const b = document.createElement("button");
    b.type = "button";
    b.className =
      "acc-btn" +
      (state.accessory === a.id ? " selected" : "") +
      (!unlocked ? " locked" : "");
    b.disabled = !unlocked;
    b.innerHTML =
      `<span class="em">${unlocked ? a.emoji : "🔒"}</span>` +
      `<span>${a.label}</span>` +
      (!unlocked ? `<span>${a.cost}⭐</span>` : "");
    b.addEventListener("click", () => {
      state.accessory = a.id;
      saveState();
      renderCloset();
      refreshAvatar();
    });
    accWrap.appendChild(b);
  });
}

/* ---------------- Som e voz ---------------- */

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playChime(kind) {
  if (!state.settings.sound) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const freqsByKind = {
    tick: [520],
    success: [523.25, 659.25, 783.99],
    star: [659.25, 987.77],
  };
  const freqs = freqsByKind[kind] || [440];
  let t = ctx.currentTime;
  freqs.forEach((f) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
    t += 0.12;
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

/* ---------------- Confete e banner ---------------- */

function confettiBurst() {
  if (!state.settings.anim) return;
  const colors = ["#FF6B6B", "#FFB800", "#22C55E", "#2F8FE0", "#8B5CF6", "#EC4899"];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = Math.random() * 100 + "vw";
    el.style.background = colors[i % colors.length];
    const dur = 1.6 + Math.random() * 1.2;
    el.style.animationDuration = dur + "s";
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), dur * 1000 + 60);
  }
}

function showBanner(text) {
  const el = $("#celebrateBanner");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------------- Modais ---------------- */

function openOverlay(id) {
  $(id).removeAttribute("hidden");
}

function closeOverlayEl(ov) {
  if (!ov) return;
  ov.setAttribute("hidden", "");
  if (ov.id === "cardOverlay") setControlsEnabled(true);
}

function closeOverlay(id) {
  closeOverlayEl($(id));
}

function bindOverlayDismiss() {
  $$(".modal-overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeOverlayEl(ov);
    });
  });
  $$(".modal-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      closeOverlayEl(e.target.closest(".modal-overlay"));
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $$(".modal-overlay:not([hidden])").forEach(closeOverlayEl);
    }
  });
}

function bindSettings() {
  $("#settingsBtn").addEventListener("click", () => {
    $("#soundToggle").checked = state.settings.sound;
    $("#animToggle").checked = state.settings.anim;
    $("#calmToggle").checked = state.settings.calm;
    openOverlay("#settingsOverlay");
  });
  $("#soundToggle").addEventListener("change", (e) => {
    state.settings.sound = e.target.checked;
    saveState();
    if (e.target.checked) playChime("success");
  });
  $("#animToggle").addEventListener("change", (e) => {
    state.settings.anim = e.target.checked;
    applyBodyClasses();
    saveState();
  });
  $("#calmToggle").addEventListener("change", (e) => {
    state.settings.calm = e.target.checked;
    applyBodyClasses();
    saveState();
  });
  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Isso vai apagar as estrelas, o Bloco e as voltas salvas neste aparelho. Deseja continuar?")) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });
}

/* ---------------- Inicialização ---------------- */

function init() {
  state = loadState();
  applyBodyClasses();
  renderBoard();
  refreshAvatar();
  updateStatPills();
  setDieFace(1);
  requestAnimationFrame(() => positionToken(false));

  $("#dieBtn").addEventListener("click", rollDie);
  $("#advanceBtn").addEventListener("click", rollDie);
  $("#avatarBtn").addEventListener("click", () => {
    renderCloset();
    openOverlay("#closetOverlay");
  });
  bindSettings();
  bindOverlayDismiss();
  window.addEventListener("resize", () => positionToken(false));
}

document.addEventListener("DOMContentLoaded", init);
