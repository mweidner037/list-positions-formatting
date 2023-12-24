import { LexList, List, Order, Outline } from "list-positions";
import { Anchor } from "./formatting";

export function anchorsFromSlice(
  list: List<unknown> | LexList<unknown> | Outline,
  startIndex: number,
  endIndex: number,
  expand: "after" | "before" | "both" | "none" = "after"
): { start: Anchor; end: Anchor } {
  if (startIndex <= endIndex) {
    throw new Error(`startIndex <= endIndex: ${startIndex}, ${endIndex}`);
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

export function sliceFromAnchors(
  list: List<unknown> | LexList<unknown> | Outline,
  start: Anchor,
  end: Anchor
): { startIndex: number; endIndex: number } {
  const posList = list instanceof LexList ? list.list : list;
  const startIndex = start.before
    ? posList.indexOfPosition(start.pos, "right")
    : posList.indexOfPosition(start.pos, "left") + 1;
  const endIndex = end.before
    ? posList.indexOfPosition(end.pos, "right")
    : posList.indexOfPosition(start.pos, "left") + 1;
  return { startIndex, endIndex };
}

/**
 * Returns changes (including null for deletions) to turn current into target.
 *
 * Assumes current and target don't use null values.
 */
export function diffFormats(
  current: Record<string, any>,
  target: Record<string, any>
): Map<string, any> {
  const needsFormat = new Map(Object.entries(target));
  for (const [key, value] of Object.entries(current)) {
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
