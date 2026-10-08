/** Pure helpers for `uiautomator dump` output, so they can be tested without a device. */

export interface FoundNode {
  /** Center of the node, normalized to 0..1 of the screen in its current orientation. */
  x: number;
  y: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : "";
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Finds the first visible node whose text or content description contains `query` (case-insensitive).
 * Screen size is taken from the widest node bounds, which is the root window in the current rotation.
 */
export function findNodeByText(xml: string, query: string): FoundNode | undefined {
  const needle = normalize(query);
  if (!needle) return undefined;
  let width = 0;
  let height = 0;
  let found: { l: number; t: number; r: number; b: number } | undefined;
  for (const [tag] of xml.matchAll(/<node\b[^>]*>/g)) {
    const bounds = /\sbounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
    if (!bounds) continue;
    const [l, t, r, b] = bounds.slice(1).map(Number) as [number, number, number, number];
    width = Math.max(width, r);
    height = Math.max(height, b);
    if (found || r <= l || b <= t) continue;
    if ([attr(tag, "text"), attr(tag, "content-desc")].some((v) => normalize(v).includes(needle))) found = { l, t, r, b };
  }
  if (!found || width <= 0 || height <= 0) return undefined;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((found.l + found.r) / 2 / width), y: clamp((found.t + found.b) / 2 / height) };
}

/** `uiautomator dump` prints errors (e.g. "could not get idle state") instead of XML when the UI never settles. */
export function isHierarchy(output: string): boolean {
  return output.includes("<hierarchy");
}
