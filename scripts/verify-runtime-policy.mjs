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
  const semanticText = maskCommentsAndStrings(text);
  for (const rule of policyRules) {
    rule.pattern.lastIndex = 0;
    for (const match of semanticText.matchAll(rule.pattern)) {
      violations.push({ label: rule.label, text: match[0], index: match.index ?? 0 });
    }
  }
  return violations;
}

/**
 * Mask prose while preserving executable template interpolation. A template
 * literal is static text except between `${` and its matching `}`; that range
 * is ordinary JavaScript and must be scanned with the same comment/string/
 * nested-template handling as the surrounding source.
 */
function maskCommentsAndStrings(source) {
  let index = 0;
  let output = '';
  const mask = (character) => {
    output += character === '\n' ? '\n' : ' ';
  };
  const consumeQuoted = (quote, importSpecifier = false) => {
    const append = (character) => {
      if (importSpecifier) output += character;
      else mask(character);
    };
    append(source[index++]);
    let escaped = false;
    while (index < source.length) {
      const character = source[index++];
      append(character);
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) return;
    }
  };
  const consumeLineComment = () => {
    mask(source[index++]);
    mask(source[index++]);
    while (index < source.length) {
      const character = source[index++];
      mask(character);
      if (character === '\n') return;
    }
  };
  const consumeBlockComment = () => {
    mask(source[index++]);
    mask(source[index++]);
    while (index < source.length) {
      const character = source[index++];
      mask(character);
      if (character === '*' && source[index] === '/') {
        mask(source[index++]);
        return;
      }
    }
  };
  const consumeTemplate = () => {
    mask(source[index++]);
    while (index < source.length) {
      const character = source[index] ?? '';
      const next = source[index + 1] ?? '';
      if (character === '`') {
        mask(source[index++]);
        return;
      }
      if (character === '\\') {
        mask(source[index++]);
        if (index < source.length) mask(source[index++]);
        continue;
      }
      if (character === '$' && next === '{') {
        output += '${';
        index += 2;
        consumeCode(true);
        continue;
      }
      mask(source[index++]);
    }
  };
  const consumeCode = (insideInterpolation) => {
    let braceDepth = insideInterpolation ? 1 : 0;
    while (index < source.length) {
      const character = source[index] ?? '';
      const next = source[index + 1] ?? '';
      if (insideInterpolation && character === '{') {
        output += character;
        index += 1;
        braceDepth += 1;
        continue;
      }
      if (insideInterpolation && character === '}') {
        output += character;
        index += 1;
        braceDepth -= 1;
        if (braceDepth === 0) return;
        continue;
      }
      if (character === '/' && next === '/') {
        consumeLineComment();
        continue;
      }
      if (character === '/' && next === '*') {
        consumeBlockComment();
        continue;
      }
      if (character === '"' || character === "'") {
        consumeQuoted(
          character,
          /(?:\bfrom|\bimport|\brequire)\s*(?:\(\s*)?$/.test(output),
        );
        continue;
      }
      if (character === '`') {
        consumeTemplate();
        continue;
      }
      output += character;
      index += 1;
    }
  };
  consumeCode(false);
  return output;
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
