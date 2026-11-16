# Tidebreak Terminal — a three.js tactical FPS

[![make.fun](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/reyxnal/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/reyxnal/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A complete, original round-based tactical first-person shooter built on
three.js 0.187.0, entered in the [make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02).
Counter-Strike-style, never a copy: its own map, art, sounds and names.

**The game.** Night rain over a container port. Two teams of five — you plus
four bots against five enemy bots — fight short rounds across three lanes and
two bomb sites. Win by eliminating the other team, detonating the device, or
defusing it. Earn money every round and spend it in the buy menu: four
weapons, armour, and three grenade types. Gunfire rewards stopping to aim:
recoil and spread punish firing on the move, headshots pay triple, and bots
follow routes, hold positions, and react to what they see and hear.

**Play it.** Serve `game/` with any static file server and open `index.html`
in desktop Chrome — no build step, no network requests. Click to lock the
mouse, WASD to move, Shift to walk, Ctrl/C to crouch, R to reload, B for the
buy menu, E to plant/defuse, G to throw a grenade, 1–4 to switch weapons.

**How it is built.** `main.ts` (Node 22, standard library only) copies `game/`
and `screenshots/` to the output directory and writes `dossier.json` with the
kit's vendored `buildDossier`. The game itself is plain ES modules under
`game/src/`: a fixed-step simulation kept apart from rendering, one module per
job, a single shared state object. Run it the way the grader does:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

**Layout.** `game/index.html` (shell, HUD, import map) · `game/src/`
(game code) · `game/vendor/three/` (three.js 0.187.0, byte for byte from npm)
· `screenshots/` (real renders of the game) · `vendor/makefun-threejs.ts`
(the kit's dossier library, unchanged) · `main.ts` (the entry program).

MIT licensed. Built in one agent session for the bounty.
