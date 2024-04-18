import { AbsList, List, Text, Outline } from "list-positions";
import { Anchor, Anchors } from "./anchor";

// Helper functions.
// See RichText for example usage.

/**
 * Returns a span `{ start: Anchor, end: Anchor }` that covers precisely
 * the given slice of list.
 *
 * The span covers all positions from
 * `list.positionAt(startIndex)` to `list.positionAt(endIndex - 1)` inclusive,
 * including positions that are not currently present in list.
 * It may also "expand" to cover not-currently-present positions at
 * the slice's endpoints, depending on the value of `expand`.
 *
 * Invert with {@link sliceFromSpan}, possibly on a different list or a different device.
 *
 * @param expand Whether the span covers not-currently-present positions at
 * the slice's endpoints.
 * - "after" (default): The span expands to cover positions at the end, i.e.,
 * between `list.positionAt(endIndex - 1)` and `list.positionAt(endIndex)`.
 * This is the typical behavior for most rich-text format keys (e.g. bold): the
 * formatting also affects future (& concurrent) characters inserted at the end.
 * - "before": Expands to cover positions at the beginning, i.e.,
 * between `list.positionAt(startIndex - 1)` and `list.positionAt(startIndex)`.
 * - "both": Combination of "before" and "after".
 * - "none": Does not expand.
 * This is the typical behavior for certain rich-text format keys, such as hyperlinks.
 *
 * @throws If `startIndex` or `endIndex` is not in the range `[0, list.length]`.
 */
export function spanFromSlice(
  list: List<unknown> | Text | Outline | AbsList<unknown>,
  startIndex: number,
  endIndex: number,
  expand: "after" | "before" | "both" | "none" = "after"
): { start: Anchor; end: Anchor } {
  const startExpand = expand === "before" || expand === "both";
  const endExpand = expand === "after" || expand === "both";
  return {
    start: Anchors.anchorAt(list, startIndex, startExpand ? "left" : "right"),
    end: Anchors.anchorAt(list, endIndex, endExpand ? "right" : "left"),
  };
}

/**
 * Projects the span `{ start: Anchor, end: Anchor }` onto the given list,
 * returning the slice that it currently covers.
 *
 * The slice is expressed in terms of its `startIndex` (inclusive) and `endIndex`
 * (exclusive). Both are always in the range `[0, list.length]`.
 *
 * Inverts {@link spanFromSlice}.
 */
export function sliceFromSpan(
  list: List<unknown> | Text | Outline | AbsList<unknown>,
  start: Anchor,
  end: Anchor
): { startIndex: number; endIndex: number } {
  return {
    startIndex: Anchors.indexOfAnchor(list, start),
    endIndex: Anchors.indexOfAnchor(list, end),
  };
}

/**
 * Returns the format changes needed to turn `format` into `current`.
 *
 * Usually, you will create a new mark for each key-value pair in the returned map.
 * Note that the map may contain null
 * values; when used in marks, these delete their keys.
 *
 * See also: RichText.insertWithFormat, which uses this function to ensure that
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
