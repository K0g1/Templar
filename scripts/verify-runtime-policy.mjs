import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const policyRules = [
  { label: 'Node/Electron import', pattern: /(?:from\s+|import\s*\(|require\s*\()["'](?:node:|electron)/g },
  { label: 'dynamic require', pattern: /\brequire\s*\(/g },
  { label: 'network API', pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/g },
  { label: 'network beacon', pattern: /navigator\s*\.\s*sendBeacon\b/g },
  { label: 'requestUrl', pattern: /\brequestUrl\b/g },
  { label: 'Node runtime global', pattern: /\b(?:Buffer|process)\s*(?:\.|\[)/g },
  { label: 'regex lookbehind', pattern: /\(\?<(?=[=!])/g },
  { label: 'FileSystemAdapter', pattern: /\bFileSystemAdapter\b/g },
];

export function runtimePolicyViolations(text) {
  const violations = [];
  for (const rule of policyRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      violations.push({ label: rule.label, text: match[0], index: match.index ?? 0 });
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

export async function verifyRuntimePolicy(directory = sourceRoot) {
  const failures = [];
  for (const path of await sourceFiles(directory)) {
    const text = await readFile(path, 'utf8');
    for (const violation of runtimePolicyViolations(text)) {
      failures.push({ path, ...violation });
    }
  }
  if (failures.length > 0) {
    const details = failures
      .map(({ path, label, text }) => `${path}: ${label} (${text})`)
      .join('\n');
    throw new Error(`Runtime policy check failed:\n${details}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (!existsSync(sourceRoot)) throw new Error(`Missing runtime source directory: ${sourceRoot}`);
  await verifyRuntimePolicy();
  console.log('Runtime API policy verified.');
}
