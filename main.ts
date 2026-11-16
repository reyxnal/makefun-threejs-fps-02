// Tidebreak Terminal — entry program (Node 22, standard library only).
//
// The game itself is the static game/ folder beside this file: plain HTML
// + ES modules, three.js from the import map, no build step. This program
// hands it in: it stages game/ and screenshots/ into the output directory
// and writes dossier.json, the summary the judge reads, with the vendored
// make.fun library. Running it twice produces byte-identical output —
// there are no timestamps, no randomness, and no network anywhere here.
//
// Local check (outside the grader, where /output is the target):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps (reference/gate.json). text_max_bytes shapes the
// dossier's source listing; the rest refuse an entry the scorer would
// refuse: at most 4 screenshots of 256 KiB each, at most 993 files and
// 48 MiB under game/ (game/ counts beside /output's own 1000-entry cap).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function stageDirectory(name) {
  const src = join(root, name);
  if (!existsSync(src)) return;
  cpSync(src, join(outDir, name), { recursive: true });
}

mkdirSync(outDir, { recursive: true });
stageDirectory('game');
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
stageDirectory('screenshots');

const dossier = buildDossier(outDir, DOSSIER_CAPS);
writeFileSync(join(outDir, 'dossier.json'), dossier);
