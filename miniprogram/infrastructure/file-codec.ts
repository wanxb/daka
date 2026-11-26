/** The on-disk envelope is a compatibility boundary; extraction must preserve bytes, checksums and manifest references. */
import type { Database } from '../domain/model';
export interface Reference {
  path: string;
  kind: 'projects' | 'records';
}
export interface Manifest {
  schemaVersion: 1;
  generation: number;
  refs: Reference[];
  newProjectDraft: Database['newProjectDraft'];
  undo: Database['undo'];
}
export function byteLength(text: string): number {
  let length = 0;
  for (const char of text) {
    const n = char.codePointAt(0)!;
    length += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
  }
  return length;
}
// This checksum detects accidental truncation/corruption; it is deliberately not an authentication scheme.
export function checksum(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function encode(data: unknown): string {
  const payload = JSON.stringify(data);
  return JSON.stringify({ bytes: byteLength(payload), checksum: checksum(payload), payload });
}
export function decode<T>(text: string): T {
  const entry = JSON.parse(text);
  if (
    typeof entry.payload !== 'string' ||
    entry.bytes !== byteLength(entry.payload) ||
    entry.checksum !== checksum(entry.payload)
  )
    throw new Error('checksum');
  return JSON.parse(entry.payload) as T;
}
