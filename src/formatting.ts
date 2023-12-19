import { LexList, List, Order, Outline, Position } from "list-positions";

// Allow "any" as the span value type.
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

export type Anchor = {
  /**
   * Could be min or max position, but spans can't include them.
   * So be careful allowing min/max Positions in your list.
   */
  pos: Position;
  /**
   * true if before, false if after.
   */
  before: boolean;
};

/**
 * Missing metadata needed for comparison (incl equality check),
 * e.g., a Lamport timestamp. Hence why "abstract" (not really).
 */
export interface AbstractSpan {
  start: Anchor;
  end: Anchor;
  key: string;
  /** Anything except null - that's reserved to mean "delete this format". */
  value: any;
}

export type FormattedRange = {
  start: Anchor;
  end: Anchor;
  format: Record<string, any>;
  // TODO: activeSpans: Map<string, S>? Precludes combining equi-formatted neighbors.
};

// TODO: methods to convert a Span/Range + List into indexed slice.
// And vice versa (take indices and "expand" behavior to get Span).

// TODO: mutators return changes.

export class Formatting<S extends AbstractSpan> {
  constructor(private readonly compareSpans: (a: S, b: S) => number) {}

  // TODO: accept multiple in spread arg? If not for loading, so less tempted to overflow stack.
  addSpan(span: S): void {}

  // TODO: reference equality? Or can we make it work with compare === 0?
  deleteSpan(span: S): void {}

  /**
   * All spans, regardless of whether they are currently winning.
   *
   * No particular order.
   *
   * Use for saving (w/ addSpans to load).
   *
   * TODO: explicit saving and loading that uses more internal format
   * for faster loading? E.g. sorting by compareSpans. (Warn not to change order.)
   */
  *spans(): IterableIterator<S> {}

  getFormat(pos: Position): Record<string, any> {}

  // getActiveSpans(pos: Position): Map<string, S> {}

  // For each key, nonempty and in precedence order.
  // getAllSpans(pos: Position): Map<string, S[]> {}

  /**
   * The whole list as a series of ranges with their current formats.
   *
   * In order; starts with open minPos, ends with open maxPos.
   */
  formatted(): FormattedRange[] {}

  // TODO: version that takes a List (etc.) and directly gives you index-ranges?

  // TODO: insert helpers (check and repair format at a pos). Maybe with newSpan callback in constructor.

  /**
   *
   * @throws If `list.positionAt(index)` is min or max Position.
   */
  matchFormat(
    // Need list so that expand rules can go up to but exclude index +/- 1
    list: List<any> | LexList<any> | Outline,
    index: number,
    // nulls are ignored.
    format: Record<string, any>,
    // If not provided, all are "after".
    expandRules?: (
      key: string,
      value: any
    ) => "after" | "before" | "none" | "both"
  ): AbstractSpan[] {
    function positionAt(i: number) {
      const listPos = list.positionAt(i);
      if (typeof listPos === "string") return list.order.unlex(listPos);
      else return listPos;
    }
    const pos = positionAt(index);
    if (
      Order.equalsPosition(pos, Order.MIN_POSITION) ||
      Order.equalsPosition(pos, Order.MAX_POSITION)
    ) {
      throw new Error(
        "list.positionAt(index) is the min or max Position: " +
          JSON.stringify(pos)
      );
    }
    const prevPos = index === 0 ? Order.MIN_POSITION : positionAt(index - 1);
    const nextPos =
      index === list.length - 1 ? Order.MAX_POSITION : positionAt(index + 1);

    const existing = this.getFormat(pos);
    const needsFormat = new Map(Object.entries(format));
    for (const [key, value] of Object.entries(existing)) {
      if (needsFormat.get(key) === value) {
        // Already formatted correctly.
        needsFormat.delete(key);
      } else if (!needsFormat.has(key)) {
        // We don't want this format - need to unmark it.
        needsFormat.set(key, null);
      }
    }

    const newSpans: AbstractSpan[] = [];
    for (const [key, value] of needsFormat) {
      const expandRule =
        expandRules === undefined ? "after" : expandRules(key, value);
      const start: Anchor =
        expandRule === "before" || expandRule === "both"
          ? { pos: prevPos, before: false }
          : { pos, before: true };
      const end: Anchor =
        expandRule === "after" || expandRule === "both"
          ? { pos: nextPos, before: true }
          : { pos, before: false };
      newSpans.push({ start, end, key, value });
    }
    return newSpans;
  }
}
