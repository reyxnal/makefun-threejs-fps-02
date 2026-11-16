// HUD: every DOM element on screen, synced from S once per rendered frame.
// Text is only rewritten when it changes (cached strings), and the minimap
// is drawn from the map's own colliders, so it can never drift from the
// level. The buy menu is the only pointer-events element; it owns the
// pointer-lock dance (open → unlock so rows can be clicked).
import { S } from './state.js';
import { WEAPONS, BUY_ITEMS, MAP, BOMB_TIME, ROUNDS_TO_WIN } from './config.js';
import { currentWeaponId } from './player.js';
import { buyItem } from './rounds.js';

const $ = (id) => document.getElementById(id);
const els = {};
let mapRef = null;
let buyOpen = false;
let lockRequest = null; // set by main.js: () => request pointer lock
let hitmarkT = 0;
let bannerT = 0;
let lastClock = '', lastScore = '', lastMoney = -1, lastHp = -1, lastAr = -1;
let lastAmmo = '', lastNades = '', lastTeam = '', lastFeed = -1, lastPrompt = '';
let lastRadio = -1, radioNext = 0;
let mm = null; // minimap 2d context

export function initHud(map, requestLock) {
  mapRef = map;
  lockRequest = requestLock;
  for (const id of ['clock', 'round-lbl', 'score-a', 'score-b', 'bomb-lbl', 'bomb-bar', 'bomb-fill',
    'money-num', 'money-box', 'hp-num', 'hp-fill', 'ar-num', 'ar-fill', 'ammo-mag', 'ammo-res',
    'wpn-name', 'nade-row', 'xhair', 'hitmark', 'vignette', 'flashov', 'banner', 'prompt',
    'progress', 'progress-fill', 'teamlist', 'killfeed', 'radio-feed', 'spectate', 'buy', 'buy-rows',
    'end-screen', 'end-title', 'end-sub', 'minimap']) {
    els[id] = $(id);
  }
  mm = els.minimap ? els.minimap.getContext('2d') : null;
  buildBuyRows();
  els['buy-rows'].addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    buyItem(S.fighters[0], tr.dataset.key);
    buildBuyRows();
  });
  $('again-btn').addEventListener('click', () => location.reload());
}

function buildBuyRows() {
  const f = S.fighters[0];
  if (!f) return;
  let html = '';
  for (const item of BUY_ITEMS) {
    const price = item.kind === 'weapon' ? WEAPONS[item.id].price : item.price;
    const afford = f.money >= price;
    let own = '';
    if (item.kind === 'weapon') own = f.weapons.primary === item.id ? 'OWNED' : '';
    else if (item.kind === 'armour') own = f.armour > 0 ? 'OWNED' : '';
    else own = f.grenades[item.id] > 0 ? `×${f.grenades[item.id]}` : '';
    html += `<tr data-key="${item.key}" class="${afford ? '' : 'cant'}">`
      + `<td class="key">${item.key}</td><td>${item.label}</td>`
      + `<td class="own">${own}</td><td class="price">$${price}</td></tr>`;
  }
  els['buy-rows'].innerHTML = html;
}

export function isBuyOpen() { return buyOpen; }

export function openBuy() {
  if (S.phase !== 'freeze' || !S.fighters[0]?.alive) return;
  buyOpen = true;
  buildBuyRows();
  els.buy.classList.add('on');
  if (document.pointerLockElement) document.exitPointerLock();
}

export function closeBuy(relock = true) {
  buyOpen = false;
  els.buy.classList.remove('on');
  if (relock && lockRequest && S.started && !S.over) lockRequest();
}

export function toggleBuy() {
  if (buyOpen) closeBuy();
  else openBuy();
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showBanner(big, sub, cls) {
  els.banner.querySelector('.big').textContent = big;
  els.banner.querySelector('.sub').textContent = sub;
  els.banner.className = cls || '';
  els.banner.style.display = 'block';
  bannerT = 3.2;
}

export function onHudEvent(e) {
  switch (e.kind) {
    case 'hitmark':
      // The fight screenshot holds the hitmarker for the shutter, like the
      // tracer it belongs to; in play it flashes for a quarter second.
      hitmarkT = S.shotMode === 'fight' ? 5 : 0.25;
      els.hitmark.classList.toggle('kill', false);
      break;
    case 'kill':
      if (e.a === 0) {
        hitmarkT = S.shotMode === 'fight' ? 5 : 0.3;
        els.hitmark.classList.add('kill');
      }
      break;
    case 'roundend': {
      const youWon = (e.winner === 'attack');
      showBanner(
        youWon ? 'ROUND WON' : 'ROUND LOST',
        `${e.reason}  ·  ${S.score.attack} – ${S.score.defend}`,
        e.winner === 'attack' ? 'atk' : 'def',
      );
      break;
    }
    case 'roundstart': {
      // The banner carries the team plan: every teammate's assigned route
      // plus who carries the charge — the same plan the bots then execute.
      const mates = S.fighters.filter((g) => g.team === 'attack' && g.isBot);
      const plan = mates.map((g) => `${g.name}→${g.brain.route ?? '?'}`).join(' · ');
      const carrier = S.bomb.carrier != null ? S.fighters[S.bomb.carrier] : null;
      const carry = carrier
        ? (carrier.index === 0 ? 'You carry the charge' : `${carrier.name} carries the charge`)
        : '';
      showBanner(`ROUND ${e.round}`, [plan, carry].filter(Boolean).join('  —  '), '');
      break;
    }
    case 'matchend': {
      const youWon = e.winner === 'attack';
      els['end-title'].textContent = youWon ? 'BREAKERS TAKE THE MATCH' : 'WATCH HOLDS THE TERMINAL';
      els['end-title'].style.color = youWon ? 'var(--amber)' : 'var(--cyan)';
      els['end-sub'].textContent = `Final score ${S.score.attack} – ${S.score.defend}. Thanks for playing.`;
      els['end-screen'].style.display = 'flex';
      if (document.pointerLockElement) document.exitPointerLock();
      break;
    }
    case 'golive':
      if (buyOpen) closeBuy(false);
      break;
    case 'planted':
      showBanner('CHARGE PLANTED', `Site ${e.site} — defend it until it blows`, 'atk');
      break;
    case 'buy':
    case 'buydenied':
      if (buyOpen) buildBuyRows();
      break;
    default:
      break;
  }
}

function drawMinimap() {
  if (!mm || !mapRef) return;
  const W = 148, H = 112;
  const px = (x) => ((x + 34) / 68) * W;
  const pz = (z) => ((z + 26) / 52) * H;
  mm.clearRect(0, 0, W, H);
  mm.fillStyle = 'rgba(8,13,22,0.72)';
  mm.fillRect(0, 0, W, H);
  mm.fillStyle = 'rgba(233,230,220,0.28)';
  for (const c of mapRef.colliders) {
    mm.fillRect(px(c.minX), pz(c.minZ), Math.max(1, px(c.maxX) - px(c.minX)), Math.max(1, pz(c.maxZ) - pz(c.minZ)));
  }
  // Sites.
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    mm.strokeStyle = key === 'A' ? '#ffb340' : '#4fc3e8';
    mm.lineWidth = 1;
    mm.strokeRect(px(s.minX), pz(s.minZ), px(s.maxX) - px(s.minX), pz(s.maxZ) - pz(s.minZ));
    mm.fillStyle = mm.strokeStyle;
    mm.font = 'bold 9px sans-serif';
    mm.fillText(key, px(s.cx) - 3, pz(s.cz) + 3);
  }
  // Bomb.
  if (S.bomb.state === 'planted' || S.bomb.state === 'dropped') {
    mm.fillStyle = '#ff5a4e';
    mm.beginPath();
    mm.arc(px(S.bomb.x), pz(S.bomb.z), 3, 0, 7);
    mm.fill();
  }
  // Radio pings: expanding rings where a teammate heard something, fading
  // out over ~1.6 s. The ring marks the sound, never an enemy position.
  for (const p of S.pings) {
    const age = S.time - p.t;
    if (age < 0 || age > 1.6) continue;
    mm.strokeStyle = `rgba(255,179,64,${(1 - age / 1.6).toFixed(2)})`;
    mm.lineWidth = 1.5;
    mm.beginPath();
    mm.arc(px(p.x), pz(p.z), 3 + age * 9, 0, 7);
    mm.stroke();
  }
  // Fighters: teammates amber, enemies cyan only when recently seen is too
  // generous — show teammates always, enemies never. The player is white.
  for (const f of S.fighters) {
    if (!f.alive) continue;
    if (f.team !== 'attack') continue;
    mm.fillStyle = f.index === 0 ? '#ffffff' : '#ffb340';
    mm.beginPath();
    mm.arc(px(f.x), pz(f.z), f.index === 0 ? 3 : 2.2, 0, 7);
    mm.fill();
  }
  // Player facing tick.
  const p = S.fighters[0];
  if (p && p.alive) {
    mm.strokeStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(px(p.x), pz(p.z));
    mm.lineTo(px(p.x) - Math.sin(p.yaw) * 7, pz(p.z) - Math.cos(p.yaw) * 7);
    mm.stroke();
  }
}

export function syncHud(dt) {
  const f = S.fighters[0];
  if (!f) return;

  // Clock + scores + round label.
  const clock = fmtClock(S.phaseT);
  if (clock !== lastClock) { els.clock.textContent = clock; lastClock = clock; }
  els.clock.classList.toggle('low', (S.phase === 'live' && S.phaseT < 10) || S.phase === 'planted');
  const score = `${S.score.attack}-${S.score.defend}`;
  if (score !== lastScore) {
    els['score-a'].textContent = S.score.attack;
    els['score-b'].textContent = S.score.defend;
    lastScore = score;
  }
  els['round-lbl'].textContent = `ROUND ${S.round} · FIRST TO ${ROUNDS_TO_WIN}`;
  const planted = S.phase === 'planted';
  els['bomb-lbl'].style.display = planted ? 'block' : 'none';
  els['bomb-bar'].style.display = planted ? 'block' : 'none';
  if (planted) els['bomb-fill'].style.width = `${(S.bomb.timer / BOMB_TIME) * 100}%`;

  // Money.
  if (f.money !== lastMoney) {
    els['money-num'].textContent = `$${f.money}`;
    if (lastMoney !== -1) {
      els['money-box'].classList.remove('flash');
      void els['money-box'].offsetWidth;
      els['money-box'].classList.add('flash');
    }
    lastMoney = f.money;
  }

  // Vitals.
  const hp = Math.max(0, Math.ceil(f.hp));
  if (hp !== lastHp) {
    els['hp-num'].textContent = hp;
    els['hp-fill'].style.width = `${hp}%`;
    els['hp-fill'].style.background = hp > 50 ? 'var(--green)' : hp > 25 ? 'var(--amber)' : 'var(--red)';
    lastHp = hp;
  }
  const ar = Math.ceil(f.armour);
  if (ar !== lastAr) {
    els['ar-num'].textContent = ar > 0 ? ar : '';
    els['ar-fill'].style.width = `${ar}%`;
    lastAr = ar;
  }

  // Ammo + weapon + grenades.
  const wid = currentWeaponId(f);
  const w = WEAPONS[wid];
  const ammo = f.reloading > 0 ? 'RELOADING' : `${f.mag[wid]} / ${f.reserve[wid]}`;
  if (ammo !== lastAmmo) {
    els['ammo-mag'].textContent = f.reloading > 0 ? '···' : f.mag[wid];
    els['ammo-res'].textContent = f.reloading > 0 ? '' : ` / ${f.reserve[wid]}`;
    els['wpn-name'].textContent = f.reloading > 0 ? `${w.name} — RELOADING` : w.name;
    lastAmmo = ammo;
  }
  const nades = ['frag', 'smoke', 'flash'].map((k) =>
    `${k === f.nadeSel ? '<b>' : ''}${k.toUpperCase()} ×${f.grenades[k]}${k === f.nadeSel ? '</b>' : ''}`).join(' · ');
  if (nades !== lastNades) { els['nade-row'].innerHTML = nades; lastNades = nades; }

  // Crosshair gap grows with spread (bloom + movement), shrinks on ADS —
  // the gap is the gun's current cone, drawn honestly. Firing visibly
  // opens it; stopping to aim visibly closes it.
  const gap = Math.min(30, 7 + (f.bloom * 260) + f.moving * 9 - (S.input.ads ? 4 : 0));
  const parts = els.xhair.children;
  parts[0].style.left = `${-9 - gap}px`; parts[1].style.left = `${gap}px`;
  parts[2].style.top = `${-9 - gap}px`; parts[3].style.top = `${gap}px`;
  els.xhair.style.opacity = f.alive ? 1 : 0;

  // Hitmarker + overlays.
  if (hitmarkT > 0) {
    hitmarkT -= dt;
    els.hitmark.style.opacity = hitmarkT > 0 ? 1 : 0;
  }
  els.vignette.style.opacity = S.view.damageFlash;
  els.flashov.style.opacity = S.view.flashBlind;
  if (bannerT > 0) bannerT -= dt;
  // The banner and the prompt step aside while the buy menu is open, so
  // the menu never fights them for the same screen space.
  els.banner.style.display = (bannerT > 0 && !buyOpen) ? 'block' : 'none';

  // Contextual prompt + channel progress.
  let prompt = '';
  if (buyOpen) prompt = '';
  else if (!f.alive) prompt = '';
  else if (S.phase === 'freeze') prompt = 'Press <b>B</b> to buy — round starts soon';
  else if (S.bomb.state === 'carried' && S.bomb.carrier === 0 && S.phase === 'live') {
    const inA = f.x >= MAP.sites.A.minX && f.x <= MAP.sites.A.maxX && f.z >= MAP.sites.A.minZ && f.z <= MAP.sites.A.maxZ;
    const inB = f.x >= MAP.sites.B.minX && f.x <= MAP.sites.B.maxX && f.z >= MAP.sites.B.minZ && f.z <= MAP.sites.B.maxZ;
    prompt = (inA || inB) ? 'Hold <b>E</b> to plant the charge' : 'You carry the charge — take it to site A or B';
  } else if (S.bomb.state === 'dropped' && Math.hypot(f.x - S.bomb.x, f.z - S.bomb.z) < 4) {
    prompt = 'Walk over the charge to pick it up';
  } else if (S.phase === 'planted') {
    prompt = `Charge planted at site ${S.bomb.site} — defend it`;
  }
  if (prompt !== lastPrompt) {
    els.prompt.innerHTML = prompt;
    els.prompt.style.display = prompt ? 'block' : 'none';
    lastPrompt = prompt;
  }
  const channeling = (S.bomb.planter === 0 || S.bomb.defuser === 0) && S.bomb.progress > 0;
  els.progress.style.display = channeling ? 'block' : 'none';
  if (channeling) els['progress-fill'].style.width = `${S.bomb.progress * 100}%`;

  // Spectate label.
  els.spectate.style.display = (!f.alive && !S.over) ? 'block' : 'none';

  // Team roster (rebuilt only when membership/alive changes).
  const teamKey = S.fighters.map((g) => `${g.index}:${g.alive ? 1 : 0}`).join(',');
  if (teamKey !== lastTeam) {
    let html = '';
    for (const g of S.fighters) {
      const cls = `${g.team === 'attack' ? 'atk' : 'def'}${g.alive ? '' : ' dead'}${g.index === 0 ? ' me' : ''}`;
      const bomb = S.bomb.carrier === g.index && S.bomb.state === 'carried' ? ' ●' : '';
      html += `<div class="${cls}">${g.name}${bomb}</div>`;
    }
    els.teamlist.innerHTML = html;
    lastTeam = teamKey;
  }

  // Killfeed: last 5 kills, expiring after 6 s.
  if (S.kills.length !== lastFeed) {
    const now = S.time;
    const recent = S.kills.filter((k) => now - k.t < 6).slice(-5);
    let html = '';
    for (const k of recent) {
      const a = k.a >= 0 ? S.fighters[k.a] : null;
      const b = S.fighters[k.b];
      const wpn = k.weapon === 'frag' ? 'FRAG' : (WEAPONS[k.weapon]?.name ?? k.weapon);
      html += `<div><span class="${a?.team === 'attack' ? 'atk' : 'def'}">${a ? a.name : '—'}</span> `
        + `<span class="wpn">[${wpn}${k.headshot ? ' · HEADSHOT' : ''}]</span> `
        + `<span class="${b.team === 'attack' ? 'atk' : 'def'}">${b.name}</span></div>`;
    }
    els.killfeed.innerHTML = html;
    lastFeed = S.kills.length;
  }

  // Radio feed: last 4 teammate callouts, expiring after 6 s. Rebuilt on
  // new chatter and twice a sim-second, so expired lines leave on time.
  if (S.callouts.length !== lastRadio || S.time > radioNext) {
    const now = S.time;
    const recent = S.callouts.filter((c) => now - c.t < 6).slice(-4);
    let html = '<div class="radio-h">RADIO</div>';
    for (const c of recent) html += `<div><b>${c.who}</b> ${c.text}</div>`;
    els['radio-feed'].innerHTML = html;
    lastRadio = S.callouts.length;
    radioNext = S.time + 0.5;
  }

  drawMinimap();
}
