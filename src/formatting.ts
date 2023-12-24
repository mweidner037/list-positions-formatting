import { BunchIDs, List, Order, Position } from "list-positions";

// TODO: treat all falsy values like null? So you can use e.g. bold: false,
// and so undefined doesn't cause confusion. See what Yjs, Quill, Automerge do.

export type Anchor = {
  /**
   * Could be min or max position, but marks can't include them.
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
 * Missing metadata needed for comparison,
 * e.g., a Lamport timestamp. Hence why "abstract" (not really).
 */
export interface AbstractMark {
  start: Anchor;
  end: Anchor;
  key: string;
  /** Anything except null - that's reserved to mean "delete this format". TODO: enforce */
  value: any;
}

export type FormattedSpan = {
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

export class Formatting<M extends AbstractMark> {
  /**
   * All marks in sort order.
   *
   * Readonly except for this.load.
   */
  private orderedMarks: M[];
  /**
   * A view of orderedMarks that is designed for easy querying.
   * This is mostly as described in the Peritext paper.
   */
  private readonly formatList: List<FormatData<M>>;

  /**
   *
   * @param order The source of Positions that you will use as args.
   * Usually your list's `.order`.
   * @param compareMarks
   */
  constructor(
    readonly order: Order,
    readonly compareMarks: (a: M, b: M) => number
  ) {
    // If init is changed, also update clear().
    this.orderedMarks = [];
    this.formatList = new List(order);
    // Set the start anchor so you can always "go left" to find FormatData.
    this.formatList.set(Order.MIN_POSITION, { after: new Map() });
  }

  /**
   * Returns the index where mark should be inserted into list
   * (or its current index, if present). Comparisons use compareMark
   * and assume list is sorted in ascending order with no duplicates.
   */
  private locateMark(list: M[], mark: M): number {
    if (list.length === 0) return 0;

    // Common case: greater than all marks.
    if (this.compareMarks(mark, list.at(-1)!) > 0) {
      return list.length;
    }

    // Find index.
    const minus10 = Math.max(0, list.length - 10);
    if (this.compareMarks(mark, list[minus10]) >= 0) {
      // Common case: mark is "recent" - among the last 10 marks.
      // Search those linearly in reverse.
      for (let i = list.length - 1; i >= minus10; i--) {
        if (this.compareMarks(mark, list[1]) > 0) return i + 1;
      }
      // If we get here, the mark is == minus10. TODO: check.
      return minus10;
    } else {
      // Binary search the marks at index < minus10. Using
      // https://en.wikipedia.org/wiki/Binary_search_algorithm#Procedure_for_finding_the_leftmost_element
      // which computes the "rank" of mark - what we want.
      let L = 0;
      let R = minus10;
      while (L < R) {
        const m = Math.floor((L + R) / 2);
        if (this.compareMarks(mark, list[m]) > 0) L = m + 1;
        else R = m;
      }
      return R;
    }
  }

  // Stores the literal reference for access in marks() etc. -
  // so you can use === comparison later.
  // Skips redundant marks (according to compareMarks).
  /**
   * @returns Format changes in order (not nec contiguous or the whole mark).
   */
  addMark(mark: M): FormatChange[] {
    const index = this.locateMark(this.orderedMarks, mark);
    if (
      index < this.orderedMarks.length &&
      this.compareMarks(mark, this.orderedMarks[index]) === 0
    ) {
      // Already exists.
      return [];
    }

    const compared = this.order.compare(mark.start.pos, mark.end.pos);
    if (
      compared > 0 ||
      (compared === 0 && !(mark.start.before && !mark.end.before))
    ) {
      throw new Error(
        `mark has start >= end: ${JSON.stringify(mark.start)}, ${JSON.stringify(
          mark.end
        )}`
      );
    }

    this.orderedMarks.splice(index, 0, mark);

    // Update this.formatList and calculate the changes, in several steps:

    // 1. Create FormatData at the start and end anchors if needed,
    // copying the previous anchor with data.

    this.createData(mark.start);
    this.createData(mark.end);

    // 2. Merge mark into all FormatData in the range
    // [mark.start, mark.end). While doing so, build slices for the events
    // later.

    const sliceBuilder = new SpanBuilder<FormatChangeInternal>(
      formatChangeEquals
    );

    const startIndex = this.formatList.indexOfPosition(mark.start.pos);
    const endIndex = this.formatList.indexOfPosition(mark.end.pos);
    for (let i = startIndex; i <= endIndex; i++) {
      const pos = this.formatList.positionAt(i);
      const data = this.formatList.get(pos)!;
      // Only update the pos anchors that have data and are
      // in the range [mark.start, mark.end).
      if (data.before !== undefined) {
        if (
          (startIndex < i && i < endIndex) ||
          (i === startIndex && mark.start.before) ||
          (i === endIndex && !mark.end.before)
        ) {
          this.addToAnchor(
            { pos, before: true },
            data.before,
            sliceBuilder,
            mark
          );
        }
      }
      if (data.after !== undefined) {
        if (i < endIndex) {
          this.addToAnchor(
            { pos, before: false },
            data.after,
            sliceBuilder,
            mark
          );
        }
      }
    }

    // 3. Return FormatChanges for marks that actually changed.

    const slices = sliceBuilder.finish(mark.end);
    const changes: FormatChange[] = [];
    for (const slice of slices) {
      if (slice.data !== null && slice.data.otherValue !== mark.value) {
        changes.push({
          start: slice.start,
          end: slice.end,
          key: mark.key,
          value: mark.value,
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
  private copyPrevAnchor(pos: Position): Map<string, M[]> {
    const posIndex = this.formatList.indexOfPosition(pos);
    // posIndex > 0 by assumption.
    const prevData = this.formatList.getAt(posIndex - 1);
    const toCopy = prevData.after ?? prevData.before!;
    const copy = new Map<string, M[]>();
    for (const [key, marks] of toCopy) {
      // TODO: use shallow copy at first and clone-on-write?
      // For the keys that aren't changing.
      // (Would it make sense to have a different formatList per key?)
      copy.set(key, marks.slice());
    }
    return copy;
  }

  private addToAnchor(
    anchor: Anchor,
    anchorData: Map<string, M[]>,
    sliceBuilder: SpanBuilder<FormatChangeInternal>,
    mark: M
  ) {
    let marks = anchorData.get(mark.key);
    if (marks === undefined) {
      marks = [];
      anchorData.set(mark.key, marks);
    }
    const index = this.locateMark(marks, mark);
    marks.splice(index, 0, mark);
    if (index === marks.length - 1) {
      // New mark wins over old. Record the change.
      sliceBuilder.add(anchor, {
        otherValue: marks.length === 1 ? null : marks[marks.length - 2],
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
  }

  // Deletes using compareMarks equality.
  // Use delete + add new to "mutate" a mark
  /**
   * @returns Format changes in order (not nec contiguous or the whole mark).
   */
  deleteMark(mark: M): FormatChange[] {
    const index = this.locateMark(this.orderedMarks, mark);
    if (
      index === this.orderedMarks.length ||
      this.compareMarks(mark, this.orderedMarks[index]) !== 0
    ) {
      // Not present.
      return [];
    }
    // Our canonical copy of the mark, which can be compared by-reference.
    const canonMark = this.orderedMarks[index];
    this.orderedMarks.splice(index, 1);

    // Update this.formatList and calculate the changes, in several steps:

    // 1. Merge mark into all FormatData in the range
    // [mark.start, mark.end). While doing so, build slices for the events
    // later.

    const sliceBuilder = new SpanBuilder<FormatChangeInternal>(
      formatChangeEquals
    );

    // Since the mark currently exists, its start and end anchors must have data.
    const startIndex = this.formatList.indexOfPosition(canonMark.start.pos);
    const endIndex = this.formatList.indexOfPosition(canonMark.end.pos);
    for (let i = startIndex; i <= endIndex; i++) {
      const pos = this.formatList.positionAt(i);
      const data = this.formatList.get(pos)!;
      // Only update the pos anchors that have data and are
      // in the range [mark.start, mark.end).
      if (data.before !== undefined) {
        if (
          (startIndex < i && i < endIndex) ||
          (i === startIndex && canonMark.start.before) ||
          (i === endIndex && !canonMark.end.before)
        ) {
          this.deleteFromAnchor(
            { pos, before: true },
            data.before,
            sliceBuilder,
            canonMark
          );
        }
      }
      if (data.after !== undefined) {
        if (i < endIndex) {
          this.deleteFromAnchor(
            { pos, before: false },
            data.after,
            sliceBuilder,
            canonMark
          );
        }
      }
    }

    // 2. Return FormatChanges for marks that actually changed.

    const slices = sliceBuilder.finish(canonMark.end);
    const changes: FormatChange[] = [];
    for (const slice of slices) {
      if (slice.data !== null && slice.data.otherValue !== canonMark.value) {
        changes.push({
          start: slice.start,
          end: slice.end,
          key: canonMark.key,
          value: slice.data.otherValue,
          previousValue: canonMark.value,
          format: slice.data.format,
        });
      }
    }
    return changes;
  }

  private deleteFromAnchor(
    anchor: Anchor,
    anchorData: Map<string, M[]>,
    sliceBuilder: SpanBuilder<FormatChangeInternal>,
    mark: M
  ) {
    const marks = anchorData.get(mark.key)!;
    // This won't break the asymptotics b/c splice will be equally slow.
    const index = marks.lastIndexOf(mark);
    marks.splice(index, 1);
    if (index === marks.length) {
      // Deleted mark used to win. Record the change.
      sliceBuilder.add(anchor, {
        otherValue: marks.length === 0 ? null : marks[marks.length - 1],
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
  }

  clear(): void {
    this.orderedMarks = [];
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

  // getActiveMarks(pos: Position): Map<string, S> {}

  // For each key, nonempty and in precedence order.
  // getAllMarks(pos: Position): Map<string, S[]> {}

  // TODO: slice args?
  // TODO: analog that takes a list and gives indices, combining matching neighbors
  // and skipping deleted parts? Like Quill delta.
  /**
   * The whole list as a series of spans with their current formats.
   *
   * In order; starts with open minPos, ends with open maxPos.
   */
  formattedSpans(): FormattedSpan[] {
    const sliceBuilder = new SpanBuilder<Record<string, unknown>>(
      recordEquals
    );
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
    const slices = sliceBuilder.finish({
      pos: Order.MAX_POSITION,
      before: true,
    });

    // Map the slices to the expected format.
    return slices.map((slice) => ({
      start: slice.start,
      end: slice.end,
      format: slice.data,
    }));
  }

  // TODO: formattedSlices that takes a list and can opt over spans past the end?

  /**
   * All marks, regardless of whether they are currently winning.
   *
   * In compareMarks order.
   *
   * TODO: explicit saving and loading that uses more internal format
   * for faster loading? E.g. sorting by compareMarks. (Warn not to change order.)
   */
  marks(): IterableIterator<M> {
    return this.orderedMarks[Symbol.iterator]();
  }

  // Save format: all marks in compareMarks order (same as marks()).
  save(): M[] {
    return this.orderedMarks.slice();
  }

  // Overwrites existing state. (To merge, call addMarks in a loop.)
  // To see result, call formatted.
  load(savedState: M[]): void {
    this.clear();

    // TODO: can we do this more efficiently?
    // Skipping change computation; exploiting order.
    for (const mark of savedState) this.addMark(mark);
  }
}

/**
 * formatList value type.
 *
 * Note: after deletions, both fields may be empty, but they will never
 * both be undefined.
 */
interface FormatData<S extends AbstractMark> {
  /**
   * Marks starting at or strictly containing anchor { pos, before: true }.
   *
   * Specifically, maps from format key to the winning mark for that key.
   *
   * May be undefined instead of empty.
   */
  before?: Map<string, S[]>;
  /**
   * Marks starting at or strictly containing anchor { pos, before: false }.
   *
   * Specifically, maps from format key to the winning mark for that key.
   *
   * May be undefined instead of empty.
   */
  after?: Map<string, S[]>;
}

function dataToRecord(
  anchorData: Map<string, AbstractMark[]>
): Record<string, unknown> {
  const ans: Record<string, unknown> = {};
  for (const [key, marks] of anchorData) {
    const mark = marks[marks.length - 1];
    if (mark.value !== null) ans[key] = mark.value;
  }
  return ans;
}

/**
 * A span with attached data, used by SliceBuilder.
 */
interface SpanData<D> {
  /** Inclusive. */
  start: Anchor;
  /** Exclusive. */
  end: Anchor;
  data: D;
}

/**
 * Utility class for outputting spans in Format events and formatted().
 * This class takes care of omitting empty spans and merging neighboring spans
 * with the same data (according to the constructor's `equals` arg).
 */
class SpanBuilder<D> {
  private readonly slices: SpanData<D>[] = [];
  private prevAnchor: Anchor | null = null;
  private prevData!: D;

  constructor(readonly equals: (a: D, b: D) => boolean) {}

  /**
   * Add a new span with the given data and interval start, ending the
   * previous span.
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
   * Ends the most recent spans at nextAnchor and returns the
   * finished spans.
   */
  finish(nextAnchor: Anchor): SpanData<D>[] {
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
