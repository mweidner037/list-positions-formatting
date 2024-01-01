import {
  BunchIDs,
  LexList,
  List,
  Order,
  Outline,
  Position,
} from "list-positions";
import { Anchor, Anchors } from "./anchor";

/**
 * An inline formatting mark, i.e., an instruction to change the format of a
 * range of values.
 *
 * See [Marks](https://github.com/mweidner037/list-formatting#marks) in the readme.
 *
 * IMark is an interface that a concrete mark type should implement, extending it
 * with extra fields used by its `compareMarks` function.
 * For a default implementation,
 * see TimestampMark, used with the TimestampFormatting class.
 */
export interface IMark {
  /**
   * The mark's starting anchor.
   */
  start: Anchor;
  /**
   * The mark's ending anchor.
   */
  end: Anchor;
  /**
   * The mark's format key.
   */
  key: string;
  /**
   * The mark's format value.
   *
   * A null value deletes key, causing it to no longer appear in
   * format objects. Any other value appears as-is in format objects.
   */
  value: any;
}

/**
 * A span with a single format, returned by
 * RichList.formattedSpans.
 *
 * The span is independent of any particular list.
 */
export type FormattedSpan = {
  /**
   * The span's starting anchor.
   */
  readonly start: Anchor;
  /**
   * The span's ending anchor.
   */
  readonly end: Anchor;
  /**
   * The common format for all Positions that fall within the span.
   *
   * The format applies to a Position regardless of its membership in any
   * particular list.
   */
  readonly format: Record<string, any>;
};

/**
 * A slice of a list with a single format, returned by
 * RichList.formattedSlices.
 *
 * startIndex and endIndex are as in [Array.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice).
 */
export type FormattedSlice = {
  /**
   * The slice's starting index (inclusive).
   */
  readonly startIndex: number;
  /**
   * The slice's ending index (exclusive).
   */
  readonly endIndex: number;
  /**
   * The common format for all of the slice's values.
   *
   * Note: This format is not necessarily accurate for Positions that are not
   * currently present in the target list, even if they lie between
   * slice's endpoints' Positions.
   */
  readonly format: Record<string, any>;
};

/**
 * A change to a span's format, returned by Formatting.addMark and Formatting.deleteMark.
 */
export type FormatChange = {
  /**
   * The span's starting anchor.
   */
  readonly start: Anchor;
  /**
   * The span's ending anchor.
   */
  readonly end: Anchor;
  /**
   * The key whose format changed.
   */
  readonly key: string;
  /**
   * The new format value, or null if the key was deleted.
   */
  readonly value: any;
  /**
   * The previous format value at this span, or null if the key was not previously present.
   */
  readonly previousValue: any;
  /**
   * The span's complete new format.
   *
   * Note that this excludes keys with null values, possibly including `this.key`.
   */
  readonly format: Record<string, any>;
};

/**
 * A JSON-serializable saved state for a `Formatting<M>`.
 *
 * See Formatting.save and Formatting.load.
 *
 * ### Format
 *
 * For advanced usage, you may read and write FormattingSavedStates directly.
 *
 * Its format is the array of all marks _in compareMarks order (ascending)_.
 * This is merely `[...formatting.marks()]`.
 */
export type FormattingSavedState<M extends IMark> = M[];

/**
 * A local data structure storing a set of marks.
 *
 * See [Formatting](https://github.com/mweidner037/list-formatting#class-formatting) in the readme.
 *
 * Mutate the set using `addMark(mark)` and `deleteMark(mark)`.
 * Other methods let you query the formatting resulting from the current set of marks.
 *
 * See also: TimestampFormatting, a subclass that chooses a reasonable default
 * sort order and mark type (TimestampMark).
 */
export class Formatting<M extends IMark> {
  /**
   * [Compare function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#comparefn)
   * used for marks in this Formatting.
   *
   * The compareMarks order determines which mark "wins" (i.e., sets its key's current value)
   * when multiple marks cover the same Position.
   *
   * Its implied equality semantics (a equals b if and only if `compareMarks(a, b) === 0`)
   * is also used to check whether an added
   * mark is redundant in `addMark`, and to find the mark to delete
   * in `deleteMark`.
   */
  readonly compareMarks: (a: M, b: M) => number;
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
   * Constructs a TimestampFormatting.
   *
   * @param order The Order to use for `this.order`.
   * Typically, it should be shared with the list(s) that this
   * is formatting.
   * If not provided, a `new Order()` is used.
   * @param compareMarks The function to use for `this.compareMarks`.
   */
  constructor(readonly order: Order, compareMarks: (a: M, b: M) => number) {
    this.compareMarks = compareMarks;
    // If init logic is changed, also update clear().
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
        if (this.compareMarks(mark, list[i]) > 0) return i + 1;
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

  /**
   * Adds the given mark to our internal state.
   *
   * Changes to the current winning formatting are returned. These are in list
   * order, but they might not be contiguous and might not cover the mark's
   * entire span, if the given mark loses to existing marks.
   *
   * If the mark is already present, nothing happens. Here equality is tested
   * using compareMarks, *not* by-reference equality.
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
      equalsFormatChangeInternal
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

      if (data.before !== undefined) {
        // Deep copy.
        // TODO: use shallow copy at first and clone-on-write?
        // For the keys that aren't changing.
        // (Would it make sense to have a different formatList per key?)
        data.after = new Map();
        for (const [key, marks] of data.before) {
          data.after.set(key, marks.slice());
        }
      } else data.after = this.copyPrevAnchor(anchor.pos);
    }
  }

  /**
   * Returns a deep copy of the Map for the last anchor before { pos, before: true }.
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
        otherValue: marks.length === 1 ? null : marks[marks.length - 2].value,
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
  }

  /**
   * Deletes the given mark from our internal state.
   *
   * Changes to the current winning formatting are returned. These are in list
   * order, but they might not be contiguous and might not cover the mark's
   * entire span, if the given mark was losing to other marks.
   *
   * If the mark is already not present, nothing happens. Here equality is tested
   * using compareMarks, *not* by-reference equality.
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
      equalsFormatChangeInternal
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
    // Preserve the invariant that anchorData arrays are never empty.
    if (marks.length === 0) {
      anchorData.delete(mark.key);
    }

    if (index === marks.length) {
      // Deleted mark used to win. Record the change.
      sliceBuilder.add(anchor, {
        otherValue: marks.length === 0 ? null : marks[marks.length - 1].value,
        format: dataToRecord(anchorData),
      });
    } else sliceBuilder.add(anchor, null);
  }

  /**
   * Deletes every mark, making our start empty.
   *
   * `this.order` is unaffected (retains all metadata).
   */
  clear(): void {
    this.orderedMarks = [];
    this.formatList.clear();
    // Init like in constructor.
    this.formatList.set(Order.MIN_POSITION, { after: new Map() });
  }

  /**
   * Returns the current format at pos.
   *
   * @throws If pos is min or max Position.
   */
  getFormat(pos: Position): Record<string, any> {
    return dataToRecord(this.getFormatData(pos));
  }

  /**
   * Returns the current active (winning) marks at pos, as a Map from format keys
   * to marks.
   *
   * Note that an active mark may have value null, in which case its key does
   * not appear in `getFormat(pos)`.
   *
   * @throws If pos is min or max Position.
   */
  getActiveMarks(pos: Position): Map<string, M> {
    const active = new Map<string, M>();
    for (const [key, marks] of this.getFormatData(pos)) {
      active.set(key, marks[marks.length - 1]);
    }
    return active;
  }

  /**
   * Returns all marks at pos, as a Map from format keys
   * to marks using that key.
   *
   * Each array of marks
   * is nonempty and in compareMarks order.
   *
   * @throws If pos is min or max Position.
   */
  getAllMarks(pos: Position): Map<string, M[]> {
    // Defensive deep copy.
    const copy = new Map<string, M[]>();
    for (const [key, marks] of this.getFormatData(pos)) {
      copy.set(key, marks.slice());
    }
    return copy;
  }

  /**
   * Returns the format data that is active at pos (not necessarily
   * keyed by pos).
   *
   * @throws If pos is min or max Position.
   */
  private getFormatData(pos: Position): Map<string, M[]> {
    if (pos.bunchID === BunchIDs.ROOT) {
      throw new Error("pos is the min or max Position");
    }

    const posData = this.formatList.get(pos);
    if (posData?.before !== undefined) return posData.before;

    // Since MIN_POSITION is always present and less than pos,
    // prevIndex is never -1.
    const prevIndex = this.formatList.indexOfPosition(pos, "right") - 1;
    const prevData = this.formatList.getAt(prevIndex)!;
    return prevData.after ?? prevData.before!;
  }

  /**
   * Iterates over an efficient representation of our current Formatting state,
   * independent of a specific list.
   *
   * Same as `this.formattedSpans()`.
   */
  [Symbol.iterator](): IterableIterator<FormattedSpan> {
    return this.formattedSpans()[Symbol.iterator]();
  }

  // TODO: slice args? E.g. so you can clear/overwrite a range's format.
  /**
   * Returns an efficient representation of our current Formatting state,
   * independent of a specific list.
   *
   * Specifically, returns an array of FormattedSpans in list order.
   * Each object describes a span with a single format.
   * The spans start at `Anchors.MIN_ANCHOR` and
   * end at `Anchors.MAX_ANCHOR`, with each span's `start` equal to the previous
   * span's `end`.
   */
  formattedSpans(): FormattedSpan[] {
    const sliceBuilder = new SpanBuilder<Record<string, unknown>>(equalsRecord);
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

  // TODO: slice args?
  /**
   * Returns an efficient representation of the given list's formatting,
   * according to our current Formatting state.
   *
   * Specifically, returns an array of FormattedSlices in list order.
   * Each object describes a slice of the list with a single format.
   */
  formattedSlices(
    list: List<unknown> | LexList<unknown> | Outline
  ): FormattedSlice[] {
    // TODO: Stop formattedSpans early if we reach the end of list, using slice args.
    // Or at least break once endIndex == length, to save on indexOfAnchor calls.
    const slices: FormattedSlice[] = [];
    let prevSlice: FormattedSlice | null = null;
    for (const span of this.formattedSpans()) {
      const startIndex: number = prevSlice?.endIndex ?? 0;
      const endIndex = Anchors.indexOfAnchor(list, span.end);
      if (endIndex !== startIndex) {
        if (prevSlice !== null && equalsRecord(span.format, prevSlice.format)) {
          // Combine sequential slices with the same format.
          (prevSlice as { endIndex: number }).endIndex = endIndex;
        } else {
          const slice = { startIndex, endIndex, format: span.format };
          slices.push(slice);
          prevSlice = slice;
        }
      }
      // Else skip - span maps to empty slice.
    }
    return slices;
  }

  /**
   * Returns an iterator of our current marks, in compareMarks order (ascending).
   *
   * This includes all marks that have been added and not deleted, regardless
   * of whether they currently win at any Position.
   */
  marks(): IterableIterator<M> {
    return this.orderedMarks[Symbol.iterator]();
  }

  /**
   * Returns a saved state for this Formatting.
   *
   * The saved state describes all of our (non-deleted) marks in JSON-serializable form.
   * (In fact, it is merely the array `[...this.marks()]`.)
   * You can load this state on another Formatting
   * by calling `load(savedState)`, possibly in a different session or on a
   * different device.
   */
  save(): FormattingSavedState<M> {
    return this.orderedMarks.slice();
  }

  /**
   * Loads a saved state returned by another Formatting's `save()` method.
   * The other Formatting must have used the same compareMarks function as us.
   *
   * Loading sets our marks to match the saved Formatting's,
   * *overwriting* our current state.
   */
  load(savedState: FormattingSavedState<M>): void {
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
 *
 * Marks arrays are never empty.
 */
interface FormatData<S extends IMark> {
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
  anchorData: Map<string, IMark[]>
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
    if (Anchors.equals(start, end)) return;

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

function equalsRecord(
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

function equalsFormatChangeInternal(
  a: FormatChangeInternal,
  b: FormatChangeInternal
): boolean {
  if (a === null || b === null) return a === b;
  return a.otherValue === b.otherValue && equalsRecord(a.format, b.format);
}
