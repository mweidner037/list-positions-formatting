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

// TODO: treat all falsy values like null? So you can use e.g. bold: false,
// and so undefined doesn't cause confusion. See what Yjs, Quill, Automerge do.

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

export function equalsAnchor(a: Anchor, b: Anchor): boolean {
  return a.before === b.before && Order.equalsPosition(a.pos, b.pos);
}

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
  /**
   * A view of orderedSpans that is designed for easy querying.
   * This is mostly as described in the Peritext paper.
   */
  private readonly formatList: List<FormatData<S>>;

  /**
   *
   * @param order The source of Positions that you will use as args.
   * Usually your list's `.order`.
   * @param compareSpans
   */
  constructor(
    order: Order,
    private readonly compareSpans: (a: S, b: S) => number
  ) {
    this.orderedSpans = [];
    this.formatList = new List(order);
    // Set the start anchor so you can always "go left" to find FormatData.
    this.formatList.set(Order.MIN_POSITION, { after: new Map() });
  }

  // Stores the literal reference for access in spans() etc. -
  // so you can use === comparison later.
  // Skips redundant spans (according to compareSpans).
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  addSpan(span: S): FormatChange[] {
    const [index, existing] = this.locateSpan(span);
    if (existing !== undefined) return []; // Already exists.

    this.orderedSpans.splice(index, 0, span);

    // Update this.formatList and calculate the changes, in several steps.

    // 1. Create FormatData at the start and end anchors if needed,
    // copying the previous anchor with data.

    this.createData(span.start);
    this.createData(span.end);

    // 2. Merge span into all FormatData in the range
    // [startPos, endPos). While doing so, build slices for the events
    // later.

    const sliceBuilder = new SliceBuilder<FormatChangeInternal>(
      formatChangeEquals
    );

    const start =
      span.start.pos === null
        ? 0
        : this.formatList.indexOfPosition(span.start.pos);
    // If end is an after anchor, { end.pos, "before" } is handled after the loop.
    const end =
      span.end.pos === null
        ? this.formatList.length
        : this.formatList.indexOfPosition(span.end.pos);
    for (let i = start; i < end; i++) {
      const pos = this.formatList.positionAt(i);
      const data = this.formatList.get(pos)!;
      if (data.before !== undefined) {
        this.updateOne({ pos, before: true }, data.before, sliceBuilder, span);
      }
      if (data.after !== undefined) {
        this.updateOne({ pos, before: false }, data.after, sliceBuilder, span);
      }
    }

    if (span.end.pos !== null && !span.end.before) {
      // span ends at an after anchor; update { end.pos, "before" } if present.
      const beforeEnd = this.formatList.get(span.end.pos)?.before;
      if (beforeEnd !== undefined) {
        this.updateOne(
          { pos: span.end.pos, before: true },
          beforeEnd,
          sliceBuilder,
          span
        );
      }
    }

    // 3. Return FormatChanges for spans that actually changed.

    const slices = sliceBuilder.finish(span.end);
    const changes: FormatChange[] = [];
    for (const slice of slices) {
      if (slice.data !== null && slice.data.previousValue !== span.value) {
        changes.push({
          start: slice.start,
          end: slice.end,
          key: span.key,
          value: span.value,
          previousValue: slice.data.previousValue,
          format: slice.data.format,
        });
      }
    }
    return changes;
  }

  // Deletes using compareSpans equality.
  // Use delete + add new to "mutate" a span
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  deleteSpan(span: S): FormatChange[] {
    const [index, existing] = this.locateSpan(span);
    if (existing === undefined) return []; // Already deleted.

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
   * Creates FormatData at anchor if it doesn't already exist,
   * copying the correct values from the previous FormatData.
   */
  private createData(anchor: Anchor): void {
    // We never need to create start or end: start is created in the
    // constructor, and end is not stored.
    if (anchor.pos === null) return;

    let data = this.formatList.get(anchor.pos);
    if (data === undefined) {
      data = {};
      this.formatList.set(anchor.pos, data);
    }

    if (anchor.before) {
      if (data.before !== undefined) return;

      data.before = this.copyPrevAnchor(anchor.pos);
    } else {
      if (data.after !== undefined) return;

      if (data.before !== undefined) data.after = new Map(data.before);
      else data.after = this.copyPrevAnchor(anchor.pos);
    }
  }

  /**
   * Returns a copy of the Map for the last anchor before { pos, before: true }.
   *
   * Assumes pos is present in this.formatList and not Order.MIN_POSITION.
   */
  private copyPrevAnchor(pos: Position): Map<string, S> {
    const posIndex = this.formatList.indexOfPosition(pos);
    // posIndex > 0 by assumption.
    const prevData = this.formatList.getAt(posIndex - 1);
    return new Map(prevData.after ?? prevData.before);
  }

  private updateOne(
    anchor: Anchor,
    anchorData: Map<string, S>,
    sliceBuilder: SliceBuilder<FormatChangeInternal>,
    span: S
  ) {
    const previousSpan = anchorData.get(span.key);
    if (this.wins(span, previousSpan)) {
      anchorData.set(span.key, span);
      sliceBuilder.add(anchor, {
        previousValue: previousSpan?.value,
        format: spansToRecord(anchorData),
      });
    } else {
      sliceBuilder.add(anchor, null);
    }
  }

  /**
   * Returns whether newSpans wins over oldSpan, either in the compareSpans
   * order or because oldSpan is undefined.
   */
  private wins(newSpan: S, oldSpan: S | undefined): boolean {
    if (oldSpan === undefined) return true;
    return this.compareSpans(newSpan, oldSpan) > 0;
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

/**
 * formatList value type.
 *
 * Note: after deletions, both fields may be empty, but they will never
 * both be undefined.
 */
interface FormatData<S extends AbstractSpan> {
  /**
   * Spans starting at or strictly containing anchor { pos, before: true }.
   *
   * Specifically, maps from format key to the winning span for that key.
   *
   * May be undefined instead of empty.
   */
  before?: Map<string, S>;
  /**
   * Spans starting at or strictly containing anchor { pos, before: false }.
   *
   * Specifically, maps from format key to the winning span for that key.
   *
   * May be undefined instead of empty.
   */
  after?: Map<string, S>;
}

function spansToRecord(
  spans: Map<string, AbstractSpan>
): Record<string, unknown> {
  const ans: Record<string, unknown> = {};
  for (const [key, span] of spans) {
    if (span.value !== null) ans[key] = span.value;
  }
  return ans;
}

/**
 * A slice of CRichText.text with attached data, used by SliceBuilder.
 */
interface Slice<D> {
  /** Inclusive. */
  start: Anchor;
  /** Exclusive. */
  end: Anchor;
  data: D;
}

/**
 * Utility class for outputting ranges in Format events and formatted().
 * This class takes care of omitting empty ranges and merging neighboring ranges
 * with the same data (according to the constructor's `equals` arg).
 */
class SliceBuilder<D> {
  private readonly slices: Slice<D>[] = [];
  private prevAnchor: Anchor | null = null;
  private prevData!: D;

  constructor(readonly equals: (a: D, b: D) => boolean) {}

  /**
   * Add a new range with the given data and interval start, ending the
   * previous interval.
   *
   * anchor must not be the end anchor.
   */
  add(anchor: Anchor, data: D): void {
    if (this.prevAnchor !== null) {
      // Record the previous call's data.
      this.record(this.prevAnchor, anchor, this.prevData);
    }
    this.prevAnchor = anchor;
    this.prevData = data;
  }

  /**
   * Ends the most recent interval at nextAnchor and returns the
   * finished slices.
   */
  finish(nextAnchor: Anchor): Slice<D>[] {
    if (this.prevAnchor !== null) {
      this.record(this.prevAnchor, nextAnchor, this.prevData);
    }
    return this.slices;
  }

  private record(start: Anchor, end: Anchor, data: D): void {
    if (equalsAnchor(start, end)) return;

    if (this.slices.length !== 0) {
      const prevSlice = this.slices[this.slices.length - 1];
      if (this.equals(prevSlice.data, data)) {
        // Extend prevSlice.
        prevSlice.end = end;
        return;
      }
    }
    // Add a new slice.
    this.slices.push({ start, end, data });
  }
}

function recordEquals(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(a)) {
    if (b[key] !== value) return false;
  }
  for (const [key, value] of Object.entries(b)) {
    if (a[key] !== value) return false;
  }
  return true;
}

type FormatChangeInternal = {
  previousValue: any;
  format: Record<string, unknown>;
} | null;

function formatChangeEquals(
  a: FormatChangeInternal,
  b: FormatChangeInternal
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.previousValue === b.previousValue && recordEquals(a.format, b.format)
  );
}
