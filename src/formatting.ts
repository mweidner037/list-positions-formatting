import {
  BunchIDs,
  LexList,
  List,
  Order,
  Outline,
  Position,
} from "list-positions";

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

export type FormatChange = {
  start: Anchor;
  end: Anchor;
  key: string;
  // null if deleted.
  value: any;
  // null if previously not present.
  previousValue: any;
  // The complete new format (excluding nulls).
  format: Record<string, any>;
};

// TODO: methods to convert a Span/Range + List into indexed slice.
// And vice versa (take indices and "expand" behavior to get Span).

// TODO: mutators return changes.

// Needs a compareSpans function, hence why "abstract" (not really).
export class AbstractFormatting<S extends AbstractSpan> {
  /**
   * All spans in sort order.
   *
   * Readonly except for this.load.
   */
  private orderedSpans: S[];

  constructor(private readonly compareSpans: (a: S, b: S) => number) {
    this.orderedSpans = [];
  }

  // Stores the literal reference for access in spans() etc. -
  // so you can use === comparison later.
  // Skips redundant spans (according to compareSpans).
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  addSpan(span: S): FormatChange[] {
    const [index, existing] = this.locateSpan(span);
    if (existing !== undefined) return; // Already exists.

    this.orderedSpans.splice(index, 0, span);

    // TODO: update maps
  }

  // Deletes using compareSpans equality.
  // Use delete + add new to "mutate" a span
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  deleteSpan(span: S): FormatChange[] {
    const [index, existing] = this.locateSpan(span);
    if (existing === undefined) return; // Already deleted.

    this.orderedSpans.splice(index, 1);

    // TODO: update maps
  }

  /**
   * Returns the index where span should be inserted into orderedSpans
   * (or is already), plus the existing copy of span. Equality is
   * determined using compareSpans.
   */
  private locateSpan(span: S): [index: number, existing: S | undefined] {
    if (this.orderedSpans.length === 0) return [0, undefined];

    // Common case: greater than all spans.
    if (this.compareSpans(span, this.orderedSpans.at(-1)!) > 0) {
      return [this.orderedSpans.length, undefined];
    }

    // Find index.
    const minus10 = Math.max(0, this.orderedSpans.length - 10);
    if (this.compareSpans(span, this.orderedSpans[minus10]) >= 0) {
      // Common case: span is "recent" - among the last 10 spans.
      // Search those linearly in reverse.
      for (let i = this.orderedSpans.length - 1; i >= minus10; i--) {
        const iCompare = this.compareSpans(span, this.orderedSpans[i]);
        if (iCompare === 0) return [i, this.orderedSpans[i]];
        if (iCompare > 0) return [i + 1, undefined];
      }
      // If we get here, compareSpans(span, @minus10) must be inconsistent.
      throw new Error("compareSpans is inconsistent");
    } else {
      // Binary search the spans at index < minus10. Using
      // https://en.wikipedia.org/wiki/Binary_search_algorithm#Procedure_for_finding_the_leftmost_element
      // which computes the "rank" of span - what we want.
      let L = 0;
      let R = minus10;
      while (L < R) {
        const m = Math.floor((L + R) / 2);
        if (this.compareSpans(span, this.orderedSpans[m]) > 0) L = m + 1;
        else R = m;
      }
      const maybeExisting = this.orderedSpans[R];
      return [
        R,
        this.compareSpans(span, maybeExisting) === 0
          ? maybeExisting
          : undefined,
      ];
    }
  }

  /**
   * Does not change the state - gives you AbstractSpans that you can fill out
   * and pass to addSpan.
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
    if (pos.bunchID === BunchIDs.ROOT) {
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
        // We don't want this format - need to override it.
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

  clear(): void {}

  /**
   * @throws If pos is min or max Position.
   */
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

  /**
   * All spans, regardless of whether they are currently winning.
   *
   * In compareSpans order.
   *
   * TODO: explicit saving and loading that uses more internal format
   * for faster loading? E.g. sorting by compareSpans. (Warn not to change order.)
   */
  spans(): IterableIterator<S> {
    return this.orderedSpans[Symbol.iterator]();
  }

  // Save format: all spans in compareSpans order (same as spans()).
  save(): S[] {
    return this.orderedSpans.slice();
  }

  // Overwrites existing state. (To merge, call addSpans in a loop.)
  // To see result, call formatted.
  load(savedState: S[]): void {
    this.clear();

    this.orderedSpans = savedState.slice();
    // TODO: fill maps
  }
}
