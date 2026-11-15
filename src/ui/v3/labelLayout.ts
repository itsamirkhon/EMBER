export interface LabelRect { x: number; y: number; width: number; height: number }
export function overlaps(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x
    && a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
}
/** Keep projected annotations near their anchors, away from foreground copy and other labels. */
export function placeLabel(anchor: LabelRect, width: number, height: number, occupied: readonly LabelRect[]): LabelRect | null {
  const clamp = (value: number, max: number) => Math.max(8, Math.min(value, max));
  if (anchor.width > width - 16 || anchor.height > height - 16) return null;
  const xs = [anchor.x, ...occupied.flatMap((r) => [r.x + r.width + 8, r.x - anchor.width - 8])];
  const ys = [anchor.y, ...occupied.flatMap((r) => [r.y + r.height + 8, r.y - anchor.height - 8])];
  const at = (x: number, y: number) => ({ ...anchor,
    x: clamp(x, width - anchor.width - 8), y: clamp(y, height - anchor.height - 8),
  });
  const original = at(anchor.x, anchor.y);
  if (!occupied.some((rect) => overlaps(original, rect))) return original;
  const candidates = [...xs.map((x) => at(x, anchor.y)), ...ys.map((y) => at(anchor.x, y))];
  candidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));
  return candidates.find((candidate) => !occupied.some((r) => overlaps(candidate, r))) ?? null;
}
