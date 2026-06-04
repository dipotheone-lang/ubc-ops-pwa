/**
 * build.mjs — produce a deploy-ready static bundle in dist/.
 *
 * The frontend is dependency-free vanilla JS, so "build" = a verbatim copy of
 * frontend/ into dist/. We deliberately do NOT strip comments or minify:
 * naive regex comment-stripping corrupts code (e.g. the `/*` inside the string
 * 'image/*'), and the payoff is negligible for an internal app. dist/ is what
 * you deploy to Firebase Hosting / GitHub Pages / Vercel.
 *
 * Usage:  node scripts/build.mjs
 */
import { mkdirSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'frontend');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let count = 0;
for (const file of walk(src)) {
  const rel = file.slice(src.length + 1);
  const target = join(dist, rel);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);   // verbatim — no comment stripping (see header note)
  count++;
}

console.log(`Built ${count} files -> ${dist.replace(root, '.')}`);
console.log('Deploy dist/ to your static host (Firebase / GitHub Pages / Vercel).');
