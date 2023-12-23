import { LexList, List, Order, Outline } from "list-positions";
import { Anchor } from "./abstract_formatting";

export function anchorsFromIndexes(
  list: List<unknown> | LexList<unknown> | Outline,
  startIndex: number,
  endIndex: number,
  expand: "after" | "before" | "both" | "none" = "after"
): { start: Anchor; end: Anchor } {
  if (startIndex <= endIndex) {
    throw new Error(`startIndex <= endIndex: ${startIndex}, ${endIndex}`);
  }

  function positionAt(i: number) {
    const listPos = list.positionAt(i);
    if (typeof listPos === "string") return list.order.unlex(listPos);
    else return listPos;
  }

  let start: Anchor;
  if (expand === "before" || expand === "both") {
    const pos =
      startIndex === 0 ? Order.MIN_POSITION : positionAt(startIndex - 1);
    start = { pos, before: false };
  } else {
    start = { pos: positionAt(startIndex), before: true };
  }

  let end: Anchor;
  if (expand === "after" || expand === "both") {
    const pos =
      endIndex === list.length ? Order.MAX_POSITION : positionAt(endIndex);
    end = { pos, before: true };
  } else {
    end = { pos: positionAt(endIndex - 1), before: false };
  }

  return { start, end };
}

export function formatDiff(
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
