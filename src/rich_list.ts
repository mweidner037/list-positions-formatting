import {
  BunchMeta,
  List,
  ListSavedState,
  Order,
  OrderSavedState,
  Position,
} from "list-positions";
import { Anchors } from "./anchor";
import { FormatChange } from "./formatting";
import { diffFormats, spanFromSlice } from "./helpers";
import {
  TimestampFormatting,
  TimestampFormattingSavedState,
  TimestampMark,
} from "./timestamp_formatting";

/**
 * A slice of values with the same format, returned by
 * RichList.formattedValues.
 *
 * startIndex and endIndex are as in [Array.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice).
 */
export type FormattedValues<T> = {
  /**
   * The slice's starting index (inclusive).
   */
  startIndex: number;
  /**
   * The slice's ending index (exclusive).
   */
  endIndex: number;
  /**
   * The slice's values, i.e., `richList.list.slice(startIndex, endIndex)`.
   */
  values: T[];
  /**
   * The common format for all of the slice's values.
   */
  format: Record<string, any>;
};

/**
 * A JSON-serializable saved state for a `RichList<T>`.
 *
 * See RichList.save and RichList.load.
 *
 * ### Format
 *
 * For advanced usage, you may read and write RichListSavedStates directly.
 *
 * The format is merely a `...SavedState` object for each of:
 * - `richList.order` (class Order from [list-positions](https://github.com/mweidner037/list-positions)).
 * - `richList.list` (class List from [list-positions](https://github.com/mweidner037/list-positions)).
 * - `richList.formatting` (class TimestampFormatting).
 */
export type RichListSavedState<T> = {
  order: OrderSavedState;
  list: ListSavedState<T>;
  formatting: TimestampFormattingSavedState;
};

export class RichList<T> {
  readonly order: Order;
  readonly list: List<T>;
  readonly formatting: TimestampFormatting;

  private readonly expandRules?: (
    key: string,
    value: any
  ) => "after" | "before" | "none" | "both";

  /**
   * Only called by this class's methods that create & return a Mark.
   * Not called for formatting.newMark or formatting.addMark.
   */
  onCreateMark: ((createdMark: TimestampMark) => void) | undefined = undefined;

  constructor(options?: {
    order?: Order;
    // Takes precedence over order.
    list?: List<T>;
    // For formatting - not the order.
    replicaID?: string;
    // If not provided, all are "after".
    expandRules?: (
      key: string,
      value: any
    ) => "after" | "before" | "none" | "both";
  }) {
    if (options?.list !== undefined) {
      this.list = options.list;
      this.order = this.list.order;
    } else {
      this.order = options?.order ?? new Order();
      this.list = new List(this.order);
    }
    this.formatting = new TimestampFormatting(this.order, {
      replicaID: options?.replicaID,
    });
    this.expandRules = options?.expandRules;
  }

  /**
   * FormatChanges: you can infer from createdMarks (they'll never "lose" to
   * an existing mark, so each applies fully, with previousValue null).
   * @param index
   * @param format null values treated as not-present.
   * @param value
   */
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    value: T
  ): [
    pos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: TimestampMark[]
  ];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: TimestampMark[]
  ];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: TimestampMark[]
  ] {
    const [startPos, createdBunch] = this.list.insertAt(index, ...values);
    // Inserted positions all get the same initial format because they are not
    // interleaved with any existing positios.
    const needsFormat = diffFormats(
      this.formatting.getFormat(startPos),
      format
    );
    const createdMarks: TimestampMark[] = [];
    for (const [key, value] of needsFormat) {
      const expand =
        this.expandRules === undefined ? "after" : this.expandRules(key, value);
      const { start, end } = spanFromSlice(
        this.list,
        index,
        index + values.length,
        expand
      );
      const mark = this.formatting.newMark(start, end, key, value);
      this.formatting.addMark(mark);
      this.onCreateMark?.(mark);
      createdMarks.push(mark);
    }

    return [startPos, createdBunch, createdMarks];
  }

  // Always creates a new mark, even if redundant.
  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
    // Default: ask expandRules, which itself defaults to "after".
    expand?: "after" | "before" | "none" | "both"
  ): [createdMark: TimestampMark, changes: FormatChange[]] {
    if (expand === undefined) {
      expand =
        this.expandRules === undefined ? "after" : this.expandRules(key, value);
    }

    const { start, end } = spanFromSlice(this.list, startIndex, endIndex);
    const mark = this.formatting.newMark(start, end, key, value);
    const changes = this.formatting.addMark(mark);
    this.onCreateMark?.(mark);
    return [mark, changes];
  }

  clear() {
    this.list.clear();
    this.formatting.clear();
  }

  getFormatAt(index: number): Record<string, any> {
    return this.formatting.getFormat(this.list.positionAt(index));
  }

  // TODO: slice args?
  formattedValues(): FormattedValues<T>[] {
    const slices = this.formatting.formattedSlices(this.list);
    const values = this.list.slice();
    for (const slice of slices) {
      // Okay to modify slice in-place.
      (slice as FormattedValues<T>).values = values.slice(
        slice.startIndex,
        slice.endIndex
      );
    }
    return slices as FormattedValues<T>[];
  }

  /**
   * Long form of formattedValues that emits each value individually, like
   * list.entries().
   */
  *entries(): IterableIterator<
    [pos: Position, value: T, format: Record<string, any>]
  > {
    let index = 0;
    for (const span of this.formatting.formattedSpans()) {
      const endIndex = Anchors.indexOfAnchor(this.list, span.end);
      for (; index < endIndex; index++) {
        const pos = this.list.positionAt(index);
        yield [pos, this.list.get(pos)!, span.format];
      }
    }
  }

  /**
   * Returns a saved state for this RichList.
   *
   * The saved state describes our current list and formatting, plus
   * [Order metadata](https://github.com/mweidner037/list-positions#managing-metadata),
   * in JSON-serializable form. You can load this state on another RichList
   * by calling `load(savedState)`, possibly in a different session or on a
   * different device.
   *
   * Note: You can instead save and load each component (`this.order`, `this.list`,
   * and `this.formatting`) separately. If you do so, be sure to load `this.order`
   * before the others.
   */
  save(): RichListSavedState<T> {
    return {
      order: this.order.save(),
      list: this.list.save(),
      formatting: this.formatting.save(),
    };
  }

  /**
   * Loads a saved state returned by another RichList's `save()` method.
   *
   * Loading sets our list and formatting to match the saved RichList's,
   * *overwriting* our current state.
   */
  load(savedState: RichListSavedState<T>): void {
    this.order.load(savedState.order);
    this.list.load(savedState.list);
    this.formatting.load(savedState.formatting);
  }

  // Other ops only involve one of (list, formatting); do it directly on them?
}
