import { LexList, List, Order, Outline } from "list-positions";
import type { Anchor } from "./formatting";

export function spanFromSlice(
  list: List<unknown> | LexList<unknown> | Outline,
  startIndex: number,
  endIndex: number,
  expand: "after" | "before" | "both" | "none" = "after"
): { start: Anchor; end: Anchor } {
  if (startIndex >= endIndex) {
    throw new Error(`startIndex >= endIndex: ${startIndex}, ${endIndex}`);
  }

  const posList = list instanceof LexList ? list.list : list;

  let start: Anchor;
  if (expand === "before" || expand === "both") {
    const pos =
      startIndex === 0
        ? Order.MIN_POSITION
        : posList.positionAt(startIndex - 1);
    start = { pos, before: false };
  } else {
    start = { pos: posList.positionAt(startIndex), before: true };
  }

  let end: Anchor;
  if (expand === "after" || expand === "both") {
    const pos =
      endIndex === list.length
        ? Order.MAX_POSITION
        : posList.positionAt(endIndex);
    end = { pos, before: true };
  } else {
    end = { pos: posList.positionAt(endIndex - 1), before: false };
  }

  return { start, end };
}

// Note: might return trivial slice (same start and end).
// But spanFromSlice won't accept that. TODO: accept it?
export function sliceFromSpan(
  list: List<unknown> | LexList<unknown> | Outline,
  start: Anchor,
  end: Anchor
): { startIndex: number; endIndex: number } {
  return {
    startIndex: indexOfAnchor(list, start),
    endIndex: indexOfAnchor(list, end),
  };
}

/**
 * Returns the next index after anchor in list,
 * or `list.length` if anchor is after all present positions.
 *
 * You can use this function to convert either endpoint of a span
 * to the corresponding slice endpoint (see sliceFromSpan).
 */
export function indexOfAnchor(
  list: List<unknown> | LexList<unknown> | Outline,
  anchor: Anchor
): number {
  const posList = list instanceof LexList ? list.list : list;
  return anchor.before
    ? posList.indexOfPosition(anchor.pos, "right")
    : posList.indexOfPosition(anchor.pos, "left") + 1;
}

/**
 * Returns changes (including null for deletions) to turn current into target.
 *
 * null values are ignored (treated as not present).
 */
export function diffFormats(
  current: Record<string, any>,
  target: Record<string, any>
): Map<string, any> {
  const needsFormat = new Map<string, any>();
  for (const [key, value] of Object.entries(target)) {
    // Skip nulls as if not present.
    if (value !== null) needsFormat.set(key, value);
  }
  for (const [key, value] of Object.entries(current)) {
    if (value === null) {
      // Skip nulls as if not present.
      continue;
    }
    if (needsFormat.get(key) === value) {
      // Already formatted correctly.
      needsFormat.delete(key);
    } else if (!needsFormat.has(key)) {
      // We don't want this format - need to override it.
      needsFormat.set(key, null);
    }
  }
  return needsFormat;
}
