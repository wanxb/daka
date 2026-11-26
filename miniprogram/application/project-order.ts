/** IDs preserve project identity while a drag changes only their display order. */
export function moveProject(ids: readonly string[], id: string, target: number): string[] {
  const next = [...ids],
    from = next.indexOf(id);
  if (from < 0 || target < 0 || target >= next.length) return next;
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}
export interface CardSlot {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Use document coordinates so edge scrolling cannot make a hovered slot drift away from the finger. */
export function nearestSlot(slots: readonly CardSlot[], x: number, pageY: number): number {
  let result = -1,
    distance = Infinity;
  slots.forEach((slot, index) => {
    const d = (x - slot.left - slot.width / 2) ** 2 + (pageY - slot.top - slot.height / 2) ** 2;
    if (d < distance) {
      distance = d;
      result = index;
    }
  });
  return result;
}

/** Pack the prospective permutation, including wide legacy cards, before changing the actual array.
 * The dragged card reserves a hole; displaced cards move away from that hole in a short cascade. */
export function previewProjectOrder(
  ids: readonly string[],
  id: string,
  target: number,
  slots: readonly CardSlot[],
) {
  if (!slots.length || slots.length !== ids.length || !ids.includes(id)) return null;
  const next = moveProject(ids, id, target);
  const left = Math.min(...slots.map((slot) => slot.left));
  const right = Math.max(...slots.map((slot) => slot.left + slot.width));
  const top = Math.min(...slots.map((slot) => slot.top));
  const adjacent = slots.findIndex(
    (slot, index) => index > 0 && Math.abs(slot.top - slots[index - 1].top) < 2,
  );
  const gap =
    adjacent > 0
      ? Math.max(0, slots[adjacent].left - slots[adjacent - 1].left - slots[adjacent - 1].width)
      : 12;
  let x = left,
    y = top,
    rowHeight = 0;
  const positions = new Map<string, CardSlot>();
  for (const item of next) {
    const slot = slots[ids.indexOf(item)];
    if (x > left && x + slot.width > right + 1) {
      x = left;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    positions.set(item, { ...slot, left: x, top: y });
    x += slot.width + gap;
    rowHeight = Math.max(rowHeight, slot.height);
  }
  const shifts = ids.map((item, index) => {
    const destination = positions.get(item)!;
    const dx = destination.left - slots[index].left,
      dy = destination.top - slots[index].top;
    return {
      id: item,
      x: dx,
      y: dy,
      delay:
        item !== id && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
          ? Math.min(140, Math.abs(index - target) * 28)
          : 0,
    };
  });
  const hole = positions.get(id)!;
  return { shifts, hole, origin: { left, top } };
}
