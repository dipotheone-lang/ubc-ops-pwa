/**
 * check-syntax.mjs — lightweight syntax validation without external deps.
 *
 * Uses Node's built-in vm + the fact that `new Function(code)` throws on a
 * syntax error. Runs over every .gs (treated as classic script) and frontend
 * .js file. Apps Script .gs files are ES5/V8 JavaScript so they parse cleanly.
 *
 * Usage:  node scripts/check-syntax.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (['.js', '.gs', '.mjs'].includes(extname(name))) out.push(p);
  }
  return out;
}

let failed = 0;
const files = walk(root);
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  try {
    // Parse-only: wrap in a Function so we never execute the body.
    // For .mjs (ESM) we skip the Function trick (import syntax) and just check braces.
    if (f.endsWith('.mjs')) {
      checkBalance(code, f);
    } else {
      new Function(code);
    }
    console.log('OK   ' + f.replace(root, '.'));
  } catch (e) {
    failed++;
    console.error('FAIL ' + f.replace(root, '.') + '  -> ' + e.message);
  }
}

function checkBalance(code, f) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let inStr = null, inComment = null, prev = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i], next = code[i + 1];
    if (inComment === 'line') { if (c === '\n') inComment = null; prev = c; continue; }
    if (inComment === 'block') { if (c === '*' && next === '/') { inComment = null; i++; } prev = c; continue; }
    if (inStr) { if (c === '\\') { i++; } else if (c === inStr) inStr = null; prev = c; continue; }
    if (c === '/' && next === '/') { inComment = 'line'; i++; prev = c; continue; }
    if (c === '/' && next === '*') { inComment = 'block'; i++; prev = c; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (pairs[c]) { if (stack.pop() !== pairs[c]) throw new Error('Unbalanced ' + c + ' at index ' + i); }
    prev = c;
  }
  if (stack.length) throw new Error('Unclosed ' + stack.join(''));
}

console.log('\n' + (failed ? (failed + ' FILE(S) FAILED') : 'ALL ' + files.length + ' FILES OK'));
process.exit(failed ? 1 : 0);
