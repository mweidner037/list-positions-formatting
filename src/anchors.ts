import { LexList, List, Order, Outline } from "list-positions";
import type { Anchor } from "./formatting";

export const Anchors = {
  MIN_ANCHOR: { pos: Order.MIN_POSITION, before: false } as Anchor,

  MAX_ANCHOR: { pos: Order.MAX_POSITION, before: true } as Anchor,

  equals(a: Anchor, b: Anchor): boolean {
    return a.before === b.before && Order.equalsPosition(a.pos, b.pos);
  },

  /**
   * Returns the next index after anchor in list,
   * or `list.length` if anchor is after all present positions.
   *
   * You can use this function to convert either endpoint of a span
   * to the corresponding slice endpoint (see sliceFromSpan).
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
