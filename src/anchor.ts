import { LexList, List, Order, Outline, Position } from "list-positions";

/**
 * An anchor in a list, as a JSON object.
 *
 * An *anchor* is a spot immediately before or after a
 * [position](https://github.com/mweidner037/list-positions#about).
 * See [Anchors](https://github.com/mweidner037/list-formatting#anchors) in the readme.
 *
 * Each formatting mark starts and ends at an anchor.
 * Using anchors instead of positions lets the mark choose whether it "expands"
 * to include new positions before/after its original range.
 *
 * See also: [Utilities](https://github.com/mweidner037/list-formatting#utilities)
 * for working with Anchors.
 */
export type Anchor = {
  /**
   * The anchor's Position, from the [list-positions](https://github.com/mweidner037/list-positions)
   * library.
   */
  readonly pos: Position;
  /**
   * True for a "before" anchor, false for an "after" anchor.
   */
  readonly before: boolean;
};

export const Anchors = {
  /**
   * The minimum Anchor, which is after Order.MIN_POSITION.
   */
  MIN_ANCHOR: { pos: Order.MIN_POSITION, before: false } as Anchor,

  /**
   * The maximum Anchor, which is before Order.MAX_POSITION.
   */
  MAX_ANCHOR: { pos: Order.MAX_POSITION, before: true } as Anchor,

  /**
   * Returns whether two Anchors are equal, i.e., they have equal contents.
   */
  equals(a: Anchor, b: Anchor): boolean {
    return a.before === b.before && Order.equalsPosition(a.pos, b.pos);
  },

  /**
   * [Compare function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#comparefn)
   * for Anchors.
   *
   * @param order The Order for the anchors' Positions.
   */
  compare(order: Order, a: Anchor, b: Anchor): number {
    const posCompare = order.compare(a.pos, b.pos);
    if (posCompare === 0) {
      if (a.before === b.before) return 0;
      return a.before ? -1 : 1;
    }
    return posCompare;
  },

  /**
   * Returns the next index to the right of anchor in the given list,
   * or `list.length` if anchor is after all present positions.
   *
   * A span `{ start: Anchor, end: Anchor }`, when projected onto a list,
   * covers precisely the slice
   * ```ts
   * {
   *   startIndex: Anchors.indexOfAnchor(list, start),
   *   endIndex: Anchors.indexOfAnchor(list, end)
   * }
   * ```
   * (endIndex not included).
   *
   * See also:
   * - sliceFromSpan: Does the above start/end to slice conversion.
   * - spanFromSlice: Partial inverse for sliceFromSpan, and the closest thing
   * to an inverse for this function.
   */
  indexOfAnchor(
    list: List<unknown> | LexList<unknown> | Outline,
    anchor: Anchor
  ): number {
    const posList = list instanceof LexList ? list.list : list;
    return anchor.before
      ? posList.indexOfPosition(anchor.pos, "right")
      : posList.indexOfPosition(anchor.pos, "left") + 1;
  },
} as const;
