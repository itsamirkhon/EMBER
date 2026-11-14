/**
 * JSON.parse that tolerates bare NaN / Infinity tokens (as written by Python's json.dump
 * with allow_nan=True) by mapping them to null. Strict JSON parses unchanged.
 */
export function parseJsonLenient(text: string): { value: unknown; repaired: number } {
  try {
    return { value: JSON.parse(text), repaired: 0 };
  } catch {
    let repaired = 0;
    const fixed = text.replace(/([:[,]\s*)-?(?:NaN|Infinity)(?=\s*[,\]}])/g, (_m, pre: string) => {
      repaired += 1;
      return `${pre}null`;
    });
    return { value: JSON.parse(fixed), repaired };
  }
}
