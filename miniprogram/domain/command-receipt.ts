import { PracticeError, type CommandReceipt } from './types';
import { newId, requireId } from './values';

/** Requests contain only local command data; key order must not turn a genuine retry into a new operation. */
function requestKey(request: unknown): string {
  return JSON.stringify(request, (_key, value) => {
    // JSON maps NaN/Infinity to null; rejecting them prevents a malformed command from matching a valid null metric.
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new PracticeError('INVALID', '请填写有效数值。');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value;
  });
}

/** Keep the operation identity only while the submitted content is identical, including its base revision. */
export function submission(previous: CommandReceipt | null, request: unknown): CommandReceipt {
  const key = requestKey(request);
  return previous?.request === key ? previous : { id: newId('op'), request: key };
}

/** Optional tokens preserve older callers. They deduplicate commands and never grant permission to bypass validation. */
export function commandReceipt(
  id: string | undefined,
  request: unknown,
): CommandReceipt | undefined {
  if (id === undefined) return undefined;
  requireId(id);
  const receipt = { id, request: requestKey(request) };
  assertReceipt(receipt);
  return receipt;
}

/** Legacy entities omit the receipt; present metadata is validated before a recovered snapshot is trusted. */
export function assertReceipt(receipt: CommandReceipt | undefined): void {
  if (receipt === undefined) return;
  if (!receipt || typeof receipt.id !== 'string') throw new Error('command receipt');
  requireId(receipt.id);
  if (typeof receipt.request !== 'string' || receipt.request.length > 16_384)
    throw new Error('command request');
}

/** Reusing an identity for different data is always a conflict; equality of values alone is never enough. */
export function confirms(
  previous: CommandReceipt | undefined,
  candidate: CommandReceipt | undefined,
) {
  if (!candidate || previous?.id !== candidate.id) return false;
  if (previous.request !== candidate.request)
    throw new PracticeError('CONFLICT', '保存内容已更改，请重新提交。');
  return true;
}
