// Match flow: freeze / live / planted / end phases, the round economy,
// bomb plant + defuse channels, buy rules, and win conditions.
// Win rules (Counter-Strike-style, simplified): elimination wins at once,
// except a planted bomb keeps the round alive until it explodes or is
// defused; a live-round timeout is a defender win.
import {
  FREEZE_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
  ROUNDS_TO_WIN, WIN_REWARD, LOSS_REWARD, PLANT_REWARD, MAX_MONEY,
  MAP, BUY_ITEMS, WEAPONS, BOT_NAMES,
} from './config.js';
import { S, makeFighter } from './state.js';
import { assignRoles, botBuy, sendBotsToPositions } from './bots.js';

const END_TIME = 3.5; // seconds the round banner stays up

export function startMatch() {
  S.fighters.length = 0;
  for (let i = 0; i < 5; i++) {
    const [ax, az] = MAP.spawns.attack[i];
    const [dx, dz] = MAP.spawns.defend[i];
    if (i === 0) S.fighters.push(makeFighter(0, 'attack', 'You', false, ax, az));
    else S.fighters.push(makeFighter(i, 'attack', BOT_NAMES.attack[i], true, ax, az));
    S.fighters.push(makeFighter(5 + i, 'defend', BOT_NAMES.defend[i], true, dx, dz));
  }
  S.score.attack = 0; S.score.defend = 0;
  S.round = 1;
  S.over = false;
  startRound();
}

export function startRound() {
  const atkSpawns = MAP.spawns.attack;
  const defSpawns = MAP.spawns.defend;
  S.fighters.forEach((f) => {
    const spawn = f.team === 'attack' ? atkSpawns[f.index] : defSpawns[f.index - 5];
    const survived = f.alive && S.round > 1;
    f.x = spawn[0]; f.z = spawn[1]; f.y = 0;
    f.vx = 0; f.vy = 0; f.vz = 0;
    f.yaw = f.team === 'attack' ? Math.PI : 0;
    f.pitch = 0;
    f.hp = 100; f.alive = true;
    f.reloading = 0; f.fireCooldown = 0; f.switchT = 0; f.throwCd = 0;
    f.bloom = 0; f.flash = 0; f.moving = 0; f.crouch = false; f.airborne = false;
    if (!survived) {
      // The dead rebuy from scratch; survivors keep their kit.
      f.weapons.primary = null;
      f.weapons.sidearm = 'p9';
      f.slot = 'sidearm';
      f.mag = { p9: 12, k7: 0, r4: 0, l96: 0 };
      f.reserve = { p9: 48, k7: 0, r4: 0, l96: 0 };
      f.armour = 0;
    }
    f.grenades = { frag: 0, smoke: 0, flash: 0 };
    if (f.isBot) botBuy(f);
  });

  // The bomb goes to a random attacker each round (the player included).
  const attackers = S.fighters.filter((f) => f.team === 'attack');
  const carrier = attackers[Math.floor(S.rng() * attackers.length)];
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.carrier = carrier.index;
  S.bomb.planter = null; S.bomb.defuser = null; S.bomb.progress = 0;
  S.bomb.x = carrier.x; S.bomb.z = carrier.z;

  S.grenades.length = 0;
  S.smokes.length = 0;
  S.flashes.length = 0;
  S.noises.length = 0;
  S.view.spectate = -1;
  S.view.flashBlind = 0;
  S.view.damageFlash = 0;

  assignRoles();
  S.phase = 'freeze';
  S.phaseT = FREEZE_TIME;
  S.roundWinner = null;
  S.roundReason = '';
  S.events.push({ kind: 'roundstart', round: S.round });
}

export function buyItem(f, key) {
  const item = BUY_ITEMS.find((b) => b.key === key);
  if (!item || !f.alive || S.phase !== 'freeze') return false;
  const price = item.kind === 'weapon' ? WEAPONS[item.id].price : item.price;
  if (f.money < price) {
    S.events.push({ kind: 'buydenied', reason: 'funds' });
    return false;
  }
  if (item.kind === 'weapon') {
    f.weapons.primary = item.id;
    f.mag[item.id] = WEAPONS[item.id].mag;
    f.reserve[item.id] = WEAPONS[item.id].reserve;
    f.slot = 'primary';
  } else if (item.kind === 'armour') {
    if (f.armour >= 100) return false;
    f.armour = 100;
  } else {
    if (f.grenades[item.id] >= 2) return false;
    f.grenades[item.id]++;
  }
  f.money -= price;
  S.events.push({ kind: 'buy', item: item.id, x: f.x, z: f.z });
  return true;
}

function aliveCount(team) {
  return S.fighters.filter((f) => f.team === team && f.alive).length;
}

function endRound(winner, reason) {
  S.score[winner]++;
  S.roundWinner = winner;
  S.roundReason = reason;
  for (const f of S.fighters) {
    const reward = f.team === winner ? WIN_REWARD : LOSS_REWARD;
    f.money = Math.min(MAX_MONEY, f.money + reward);
  }
  S.phase = 'end';
  S.phaseT = END_TIME;
  S.events.push({ kind: 'roundend', winner, reason });
}

function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
  }
  return null;
}

function stepBombChannels(map, dt) {
  const bomb = S.bomb;

  // Pickup: a living attacker walking over a dropped bomb takes it.
  if (bomb.state === 'dropped') {
    for (const f of S.fighters) {
      if (f.team !== 'attack' || !f.alive) continue;
      if (Math.hypot(f.x - bomb.x, f.z - bomb.z) < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = f.index;
        S.events.push({ kind: 'bombpickup', by: f.index, x: f.x, z: f.z });
        break;
      }
    }
    return;
  }
  if (bomb.state !== 'carried' && bomb.state !== 'planted') return;

  // --- Plant channel (live phase, carrier inside a site). ---
  if (bomb.state === 'carried' && S.phase === 'live') {
    const carrier = S.fighters[bomb.carrier];
    const site = carrier && carrier.alive ? siteAt(carrier.x, carrier.z) : null;
    let channeling = false;
    if (carrier && carrier.alive && site) {
      if (carrier.index === 0) {
        channeling = S.input.use && S.input.fwd === 0 && S.input.strafe === 0;
      } else {
        channeling = carrier.brain.state === 'plant';
      }
    }
    if (channeling) {
      if (bomb.planter !== carrier.index) { bomb.planter = carrier.index; bomb.progress = 0; }
      bomb.progress += dt / PLANT_TIME;
      if (bomb.progress >= 1) {
        bomb.state = 'planted';
        bomb.site = site;
        bomb.x = carrier.x; bomb.z = carrier.z;
        bomb.timer = BOMB_TIME;
        bomb.carrier = null; bomb.planter = null; bomb.progress = 0;
        carrier.money = Math.min(MAX_MONEY, carrier.money + PLANT_REWARD);
        S.phase = 'planted';
        S.phaseT = BOMB_TIME;
        S.events.push({ kind: 'planted', site, x: bomb.x, z: bomb.z });
      }
    } else if (bomb.planter !== null) {
      bomb.planter = null;
      bomb.progress = 0;
    }
    return;
  }

  // --- Defuse channel (planted phase, defender next to the bomb). ---
  if (bomb.state === 'planted') {
    let defuser = null;
    for (const f of S.fighters) {
      if (f.team !== 'defend' || !f.alive) continue;
      if (Math.hypot(f.x - bomb.x, f.z - bomb.z) > 2.2) continue;
      if (f.index === 0) {
        if (S.input.use && S.input.fwd === 0 && S.input.strafe === 0) defuser = f;
      } else if (f.brain.state === 'defuse') {
        defuser = f;
      }
      if (defuser) break;
    }
    if (defuser) {
      if (bomb.defuser !== defuser.index) { bomb.defuser = defuser.index; bomb.progress = 0; }
      bomb.progress += dt / DEFUSE_TIME;
      if (bomb.progress >= 1) {
        bomb.state = 'defused';
        bomb.defuser = null; bomb.progress = 0;
        endRound('defend', 'BOMB DEFUSED');
      }
    } else if (bomb.defuser !== null) {
      bomb.defuser = null;
      bomb.progress = 0;
    }
  }
}

export function stepRound(map, dt) {
  if (S.phase === 'freeze') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = 'live';
      S.phaseT = ROUND_TIME;
      sendBotsToPositions(map);
      S.events.push({ kind: 'golive' });
    }
    return;
  }

  if (S.phase === 'end') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      if (S.score.attack >= ROUNDS_TO_WIN || S.score.defend >= ROUNDS_TO_WIN) {
        S.over = true;
        S.phase = 'over';
        S.events.push({ kind: 'matchend', winner: S.score.attack >= ROUNDS_TO_WIN ? 'attack' : 'defend' });
      } else {
        S.round++;
        startRound();
      }
    }
    return;
  }

  if (S.phase === 'over') return;

  // Live / planted: the bomb channels run before the win checks so a
  // defuse landing on the same step as the timer still counts.
  stepBombChannels(map, dt);
  if (S.phase === 'end') return; // a defuse just ended the round

  if (S.phase === 'live') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      endRound('defend', 'TIME EXPIRED');
      return;
    }
  } else if (S.phase === 'planted') {
    S.bomb.timer -= dt;
    S.phaseT = S.bomb.timer;
    if (S.bomb.timer <= 0) {
      S.bomb.state = 'exploded';
      S.events.push({ kind: 'explosion', x: S.bomb.x, y: 0.4, z: S.bomb.z, big: true });
      endRound('attack', 'BOMB DETONATED');
      return;
    }
  }

  const atkAlive = aliveCount('attack');
  const defAlive = aliveCount('defend');
  if (defAlive === 0) {
    endRound('attack', S.bomb.state === 'planted' ? 'DEFENDERS ELIMINATED' : 'TEAM ELIMINATED');
  } else if (atkAlive === 0 && S.bomb.state !== 'planted') {
    endRound('defend', 'TEAM ELIMINATED');
  }
}
