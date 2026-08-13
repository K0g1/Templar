import type { TemplarNoteStyle } from '../types';
import { noteStyleToFrontmatter } from '../templates/note-format';

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) return '{"$type":"undefined"}';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '{"$type":"nan"}';
    if (value === Infinity) return '{"$type":"infinity"}';
    if (value === -Infinity) return '{"$type":"-infinity"}';
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') return `{"$type":"bigint","value":${JSON.stringify(String(value))}}`;
  if (typeof value === 'function' || typeof value === 'symbol') {
    return `{"$type":"${typeof value}"}`;
  }
  if (typeof value !== 'object') return JSON.stringify({ $type: typeof value });
  if (seen.has(value)) return '{"$type":"circular"}';
  seen.add(value);
  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    serialized = `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(record[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return serialized;
}

export function stableFingerprint(value: unknown): string {
  return stableSerialize(value);
}

export function rawTemplarFingerprint(raw: unknown): string {
  return stableFingerprint(raw);
}

export function noteStyleFingerprint(style: TemplarNoteStyle): string {
  return stableFingerprint(noteStyleToFrontmatter(style));
}
