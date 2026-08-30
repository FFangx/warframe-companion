import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const failures = [];

const required = [
  'LICENSE', 'NOTICE.md', 'SECURITY.md', 'SUPPORT.md', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'CODEOWNERS', '.github/dependabot.yml',
  '.github/workflows/ci.yml', 'docs/ACCEPTANCE.md', 'docs/DEPENDENCY_RISK.md',
];
for (const path of required) {
  if (!tracked.includes(path)) failures.push(`required public file is not tracked: ${path}`);
}

const forbiddenPath = /(^|\/)(?:\.env(?:\..*)?|node_modules|dist|coverage|out|release|data|state|snapshots|secrets|\.cache)(?:\/|$)|\.(?:log|local|pem|pfx|p12|key|sqlite|db)$/iu;
for (const path of tracked) {
  if (forbiddenPath.test(path)) failures.push(`forbidden tracked path: ${path}`);
}

const textExtensions = new Set(['', '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const sensitivePatterns = [
  ['Windows user path', /[A-Z]:\\Users\\[^\\\s]+/u],
  ['macOS user path', /\/Users\/[^/\s]+/u],
  ['Linux home path', /\/home\/[^/\s]+/u],
  ['GitHub token', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/u],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['private key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u],
  ['credential-bearing URL', /https?:\/\/[^/@\s]+:[^/@\s]+@/u],
  ['QQ/OpenID-like identifier', /\b(?:qq|openid|open_id)\b[^\r\n]{0,32}\d{5,}/iu],
];

for (const path of tracked) {
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const content = readFileSync(resolve(root, path), 'utf8');
  for (const [label, pattern] of sensitivePatterns) {
    if (pattern.test(content)) failures.push(`${label} found in ${path}`);
  }
}

const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/gu;
for (const path of tracked.filter((entry) => entry.endsWith('.md'))) {
  const content = readFileSync(resolve(root, path), 'utf8');
  for (const match of content.matchAll(markdownLink)) {
    let target = match[1].trim().replace(/^<|>$/gu, '');
    target = target.split(/\s+["']/u, 1)[0];
    if (!target || target.startsWith('#') || /^(?:https?:|mailto:)/iu.test(target)) continue;
    target = decodeURIComponent(target.split('#', 1)[0].split('?', 1)[0]);
    if (!existsSync(resolve(root, dirname(path), target))) failures.push(`broken relative Markdown link in ${path}: ${target}`);
  }
}

const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
if (lock.lockfileVersion !== 3) failures.push(`package-lock.json must use lockfileVersion 3, got ${lock.lockfileVersion}`);
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!entry?.resolved || typeof entry.resolved !== 'string') continue;
  const allowed = entry.resolved.startsWith('https://registry.npmjs.org/')
    || /^(?:apps|packages)\//u.test(entry.resolved)
    || /^git\+ssh:\/\/git@github\.com\/electron\/node-gyp\.git#[0-9a-f]{40}$/u.test(entry.resolved);
  if (!allowed) failures.push(`unapproved lockfile resolution at ${path}`);
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)]) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`Public repository contract passed: ${tracked.length} tracked files checked.\n`);
