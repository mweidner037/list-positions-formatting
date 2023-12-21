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
    // If init is changed, also update clear().
    this.orderedSpans = [];
    this.formatList = new List(order);
    // Set the start anchor so you can always "go left" to find FormatData.
    this.formatList.set(Order.MIN_POSITION, { after: new Map() });
  }

  /**
   * Returns the index where span should be inserted into list
   * (or its current index, if present). Comparisons use compareSpan
   * and assume list is sorted in ascending order with no duplicates.
   */
  private locateSpan(list: S[], span: S): number {
    if (list.length === 0) return 0;

    // Common case: greater than all spans.
    if (this.compareSpans(span, list.at(-1)!) > 0) {
      return list.length;
    }

    // Find index.
    const minus10 = Math.max(0, list.length - 10);
    if (this.compareSpans(span, list[minus10]) >= 0) {
      // Common case: span is "recent" - among the last 10 spans.
      // Search those linearly in reverse.
      for (let i = list.length - 1; i >= minus10; i--) {
        if (this.compareSpans(span, list[1]) > 0) return i + 1;
      }
      // If we get here, the span is == minus10. TODO: check.
      return minus10;
    } else {
      // Binary search the spans at index < minus10. Using
      // https://en.wikipedia.org/wiki/Binary_search_algorithm#Procedure_for_finding_the_leftmost_element
      // which computes the "rank" of span - what we want.
      let L = 0;
      let R = minus10;
      while (L < R) {
        const m = Math.floor((L + R) / 2);
        if (this.compareSpans(span, list[m]) > 0) L = m + 1;
        else R = m;
      }
      return R;
    }
  }

  // Stores the literal reference for access in spans() etc. -
  // so you can use === comparison later.
  // Skips redundant spans (according to compareSpans).
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  addSpan(span: S): FormatChange[] {
    const index = this.locateSpan(this.orderedSpans, span);
    if (
      index < this.orderedSpans.length &&
      this.compareSpans(span, this.orderedSpans[index]) === 0
    ) {
      // Already exists.
      return [];
    }
    this.orderedSpans.splice(index, 0, span);

    // Update this.formatList and calculate the changes, in several steps:

    // 1. Create FormatData at the start and end anchors if needed,
    // copying the previous anchor with data.

    this.createData(span.start);
    this.createData(span.end);

    // 2. Merge span into all FormatData in the range
    // [span.start, span.end). While doing so, build slices for the events
    // later.

    const sliceBuilder = new SliceBuilder<FormatChangeInternal>(
      formatChangeEquals
    );

    const startIndex = this.formatList.indexOfPosition(span.start.pos);
    const endIndex = this.formatList.indexOfPosition(span.end.pos);
    for (let i = startIndex; i <= endIndex; i++) {
      const pos = this.formatList.positionAt(i);
      const data = this.formatList.get(pos)!;
      // Only update the pos anchors that have data and are
      // in the range [span.start, span.end).
      if (data.before !== undefined) {
        if (
          (startIndex < i && i < endIndex) ||
          (i === startIndex && span.start.before) ||
          (i === endIndex && !span.end.before)
        ) {
          this.addToAnchor(
            { pos, before: true },
            data.before,
            sliceBuilder,
            span
          );
        }
      }
      if (data.after !== undefined) {
        if (i < endIndex) {
          this.addToAnchor(
            { pos, before: false },
            data.after,
            sliceBuilder,
            span
          );
        }
      }
    }

    // 3. Return FormatChanges for spans that actually changed.

    const slices = sliceBuilder.finish(span.end);
    const changes: FormatChange[] = [];
    for (const slice of slices) {
      if (slice.data !== null && slice.data.otherValue !== span.value) {
        changes.push({
          start: slice.start,
          end: slice.end,
          key: span.key,
          value: span.value,
          previousValue: slice.data.otherValue,
          format: slice.data.format,
        });
      }
    }
    return changes;
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
  private copyPrevAnchor(pos: Position): Map<string, S[]> {
    const posIndex = this.formatList.indexOfPosition(pos);
    // posIndex > 0 by assumption.
    const prevData = this.formatList.getAt(posIndex - 1);
    const toCopy = prevData.after ?? prevData.before!;
    const copy = new Map<string, S[]>();
    for (const [key, spans] of toCopy) {
      copy.set(key, spans.slice());
    }
    return copy;
  }

  private addToAnchor(
    anchor: Anchor,
    anchorData: Map<string, S[]>,
    sliceBuilder: SliceBuilder<FormatChangeInternal>,
    span: S
  ) {
    let spans = anchorData.get(span.key);
    if (spans === undefined) {
      spans = [];
      anchorData.set(span.key, spans);
    }
    const index = this.locateSpan(spans, span);
    spans.splice(index, 0, span);
    if (index === spans.length - 1) {
      // New span wins over old. Record the change.
      sliceBuilder.add(anchor, {
        otherValue: spans.length === 1 ? null : spans[spans.length - 2],
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
  }

  // Deletes using compareSpans equality.
  // Use delete + add new to "mutate" a span
  /**
   * @returns Format changes in order (not nec contiguous or the whole span).
   */
  deleteSpan(span: S): FormatChange[] {
    const index = this.locateSpan(this.orderedSpans, span);
    if (
      index === this.orderedSpans.length ||
      this.compareSpans(span, this.orderedSpans[index]) !== 0
    ) {
      // Not present.
      return [];
    }
    // Our canonical copy of the span, which can be compared by-reference.
    const canonSpan = this.orderedSpans[index];
    this.orderedSpans.splice(index, 1);

    // Update this.formatList and calculate the changes, in several steps:

    // 1. Merge span into all FormatData in the range
    // [span.start, span.end). While doing so, build slices for the events
    // later.

    const sliceBuilder = new SliceBuilder<FormatChangeInternal>(
      formatChangeEquals
    );

    // Since the span currently exists, its start and end anchors must have data.
    const startIndex = this.formatList.indexOfPosition(canonSpan.start.pos);
    const endIndex = this.formatList.indexOfPosition(canonSpan.end.pos);
    for (let i = startIndex; i <= endIndex; i++) {
      const pos = this.formatList.positionAt(i);
      const data = this.formatList.get(pos)!;
      // Only update the pos anchors that have data and are
      // in the range [span.start, span.end).
      if (data.before !== undefined) {
        if (
          (startIndex < i && i < endIndex) ||
          (i === startIndex && canonSpan.start.before) ||
          (i === endIndex && !canonSpan.end.before)
        ) {
          this.deleteFromAnchor(
            { pos, before: true },
            data.before,
            sliceBuilder,
            canonSpan
          );
        }
      }
      if (data.after !== undefined) {
        if (i < endIndex) {
          this.deleteFromAnchor(
            { pos, before: false },
            data.after,
            sliceBuilder,
            canonSpan
          );
        }
      }
    }

    // 2. Return FormatChanges for spans that actually changed.

    const slices = sliceBuilder.finish(canonSpan.end);
    const changes: FormatChange[] = [];
    for (const slice of slices) {
      if (slice.data !== null && slice.data.otherValue !== canonSpan.value) {
        changes.push({
          start: slice.start,
          end: slice.end,
          key: canonSpan.key,
          value: slice.data.otherValue,
          previousValue: canonSpan.value,
          format: slice.data.format,
        });
      }
    }
    return changes;
  }

  private deleteFromAnchor(
    anchor: Anchor,
    anchorData: Map<string, S[]>,
    sliceBuilder: SliceBuilder<FormatChangeInternal>,
    span: S
  ) {
    const spans = anchorData.get(span.key)!;
    // This won't break the asymptotics b/c splice will be equally slow.
    const index = spans.lastIndexOf(span);
    spans.splice(index, 1);
    if (index === spans.length) {
      // Deleted span used to win. Record the change.
      sliceBuilder.add(anchor, {
        otherValue: spans.length === 0 ? null : spans[spans.length - 1],
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
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
      throw new Error("list.positionAt(index) is the min or max Position");
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

  clear(): void {
    this.orderedSpans = [];
    this.formatList.clear();
    // Init like in constructor.
    this.formatList.set(Order.MIN_POSITION, { after: new Map() });
  }

  /**
   * @throws If pos is min or max Position.
   */
  getFormat(pos: Position): Record<string, any> {
    if (pos.bunchID === BunchIDs.ROOT) {
      throw new Error("pos is the min or max Position");
    }

    const posData = this.formatList.get(pos);
    if (posData?.before !== undefined) return dataToRecord(posData.before);

    // Since MIN_POSITION is always set, prevIndex is never -1.
    const prevIndex = this.formatList.indexOfPosition(pos, "left");
    const prevData = this.formatList.getAt(prevIndex)!;
    return dataToRecord(prevData.after ?? prevData.before!);
  }

  // getActiveSpans(pos: Position): Map<string, S> {}

  // For each key, nonempty and in precedence order.
  // getAllSpans(pos: Position): Map<string, S[]> {}

  // TODO: slice args?
  /**
   * The whole list as a series of ranges with their current formats.
   *
   * In order; starts with open minPos, ends with open maxPos.
   */
  formatted(): FormattedRange[] {
    const sliceBuilder = new SliceBuilder<Record<string, unknown>>(recordEquals);
    // formatList always contains the starting anchor, so this will cover the
    // whole beginning.
    for (const [pos, data] of this.formatList.entries()) {
      if (data.before !== undefined) {
        sliceBuilder.add({ pos, before: true }, dataToRecord(data.before));
      }
      if (data.after !== undefined) {
        sliceBuilder.add({ pos, before: false }, dataToRecord(data.after));
      }
    }
    // Reach the end of the list if we haven't already.
    const slices = sliceBuilder.finish({ pos: Order.MAX_POSITION, before: true });

    // Map the slices to the expected format.
    return slices.map((slice) => ({
      start: slice.start,
      end: slice.end,
      format: slice.data,
    }));
  }

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

    // TODO: can we do this more efficiently?
    // Skipping change computation; exploiting order.
    for (const span of savedState) this.addSpan(span);
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
  before?: Map<string, S[]>;
  /**
   * Spans starting at or strictly containing anchor { pos, before: false }.
   *
   * Specifically, maps from format key to the winning span for that key.
   *
   * May be undefined instead of empty.
   */
  after?: Map<string, S[]>;
}

function dataToRecord(
  anchorData: Map<string, AbstractSpan[]>
): Record<string, unknown> {
  const ans: Record<string, unknown> = {};
  for (const [key, spans] of anchorData) {
    const span = spans[spans.length - 1];
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
  /**
   * For adds, the previous value; for deletes, the new value.
   * null for not-present.
   */
  otherValue: any;
  format: Record<string, unknown>;
} | null;

function formatChangeEquals(
  a: FormatChangeInternal,
  b: FormatChangeInternal
): boolean {
  if (a === null || b === null) return a === b;
  return a.otherValue === b.otherValue && recordEquals(a.format, b.format);
}
