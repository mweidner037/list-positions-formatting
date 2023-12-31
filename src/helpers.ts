import { LexList, List, Order, Outline } from "list-positions";
import { Anchor, Anchors } from "./anchor";

// Helper functions.
// See RichList for example usage.

/**
 * Returns a span `{ start: Anchor, end: Anchor }` that covers precisely
 * the given slice of list. The startIndex and endIndex are as in [Array.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice).
 *
 * TODO: move expand desc to readme and link here?
 * The span covers all positions from
 * `list.positionAt(startIndex)` to `list.positionAt(endIndex - 1)` inclusive,
 * including positions that are not currently present in list.
 * It may also "expand" to cover not-currently-present positions at
 * the slice's endpoints, depending on the value of `expand`.
 *
 * @param expand How the span affects not-currently-present positions at
 * the slice's endpoints.
 * - "after" (default): The span expands to cover positions at the end, i.e.,
 * between `list.positionAt(endIndex - 1)` and `list.positionAt(endIndex)`.
 * This is how most marks (e.g. bold) usually behave in rich-text editors.
 * - "before": Expands to cover positions at the beginning, i.e.,
 * between `list.positionAt(startIndex - 1)` and `list.positionAt(startIndex)`
 * - "both": Combination of "after" and "before".
 * - "none": Does not expand. This is how hyperlinks usually behave in rich-text editors.
 *
 * @throws If startIndex >= endIndex (the slice is empty).
 */
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
/**
 * Projects the span `{ start: Anchor, end: Anchor }` onto the given list,
 * returning the slice that it currently covers.
 *
 * The slice is expressed in terms of its startIndex and endIndex
 * (endIndex not included), like arguments to [Array.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice).
 */
export function sliceFromSpan(
  list: List<unknown> | LexList<unknown> | Outline,
  start: Anchor,
  end: Anchor
): { startIndex: number; endIndex: number } {
  return {
    startIndex: Anchors.indexOfAnchor(list, start),
    endIndex: Anchors.indexOfAnchor(list, end),
  };
}

/**
 * Returns a map of format changes needed to turn `format` into `current`.
 *
 * Usually, you will create a new mark for each key-value pair in the returned map.
 * Note that the map may contain null
 * values; when used in marks, these delete their keys.
 *
 * See also: RichList.insertWithFormat, which uses this function to ensure that
 * newly-inserted values have the desired format.
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
