import {
  AbsList,
  List,
  Text,
  MAX_POSITION,
  MIN_POSITION,
  Order,
  Outline,
  Position,
  positionEquals,
  BunchIDs,
} from "list-positions";

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
 * @see {@link Anchors} Utilities for working with Anchors.
 */
export type Anchor = {
  /**
   * The anchor's Position, from the [list-positions](https://github.com/mweidner037/list-positions#readme)
   * library.
   */
  readonly pos: Position;
  /**
   * True for a "before" anchor, false for an "after" anchor.
   */
  readonly before: boolean;
};

/**
 * Utilities for working with Anchors.
 */
export const Anchors = {
  /**
   * The minimum Anchor, which is after Order.MIN_POSITION.
   */
  MIN_ANCHOR: { pos: MIN_POSITION, before: false } as Anchor,

  /**
   * The maximum Anchor, which is before Order.MAX_POSITION.
   */
  MAX_ANCHOR: { pos: MAX_POSITION, before: true } as Anchor,

  /**
   * Returns whether two Anchors are equal, i.e., they have equal contents.
   */
  equals(a: Anchor, b: Anchor): boolean {
    return a.before === b.before && positionEquals(a.pos, b.pos);
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
   * Throws an error if anchor is invalid.
   *
   * The only invalid anchors are `{ pos: MIN_POSITION, before: true }`
   * and `{ pos: MAX_POSITION, before: false }`: They are outside the range
   * `[MIN_ANCHOR, MAX_ANCHOR]`, hence will not work with Formatting.
   */
  validate(anchor: Anchor): void {
    if (anchor.pos.bunchID === BunchIDs.ROOT) {
      if ((anchor.pos.innerIndex === 0) === anchor.before) {
        throw new Error(`Invalid anchor: ${JSON.stringify(anchor)}`);
      }
    }
  },

  /**
   * Returns the next index to the right of anchor in the given list,
   * or `list.length` if anchor is after all present positions.
   *
   * Inverts {@link Anchors.anchorAt}.
   *
   * @see sliceFromSpan Function to convert a span `{ start: Anchor, end: Anchor }`
   * to a slice `{ startIndex: number, endIndex: number }`. Internally, it just
   * calls this function twice.
   */
  indexOfAnchor(
    list: List<unknown> | Text | Outline | AbsList<unknown>,
    anchor: Anchor
  ): number {
    Anchors.validate(anchor);

    const posList = list instanceof AbsList ? list.list : list;
    return anchor.before
      ? posList.indexOfPosition(anchor.pos, "right")
      : posList.indexOfPosition(anchor.pos, "left") + 1;
  },

  /**
   * Returns an anchor that is just to the left of the given index in `list`,
   * i.e., in the gap between `index - 1` and `index`.
   *
   * If positions later appear between `index - 1` and `index`,
   * the `bind` argument determines whether the anchor binds to the left or right side of the gap.
   *
   * Invert with {@link Anchors.indexOfAnchor}, possibly on a different list or a different device.
   *
   * @see spanFromSlice Function to convert a slice `{ startIndex: number, endIndex: number }`
   * to a span `{ start: Anchor, end: Anchor }`. Internally, it just
   * calls this function twice.
   * @throws If index is not in the range `[0, list.length]`.
   */
  anchorAt(
    list: List<unknown> | Text | Outline | AbsList<unknown>,
    index: number,
    bind: "left" | "right"
  ): Anchor {
    const posList = list instanceof AbsList ? list.list : list;
    if (bind === "left") {
      return {
        pos: index === 0 ? MIN_POSITION : posList.positionAt(index - 1),
        before: false,
      };
    } else {
      return {
        pos: index === list.length ? MAX_POSITION : posList.positionAt(index),
        before: true,
      };
    }
  },
} as const;
