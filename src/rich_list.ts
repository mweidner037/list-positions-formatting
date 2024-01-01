import {
  BunchMeta,
  List,
  ListSavedState,
  Order,
  OrderSavedState,
  Position,
} from "list-positions";
import { Anchors } from "./anchor";
import { FormatChange, FormattedSlice } from "./formatting";
import { diffFormats, spanFromSlice } from "./helpers";
import {
  TimestampFormatting,
  TimestampFormattingSavedState,
  TimestampMark,
} from "./timestamp_formatting";

/**
 * A slice of values with a single format, returned by
 * RichList.formattedValues.
 *
 * startIndex and endIndex are as in [Array.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/slice).
 */
export type FormattedValues<T> = {
  /**
   * The slice's starting index (inclusive).
   */
  readonly startIndex: number;
  /**
   * The slice's ending index (exclusive).
   */
  readonly endIndex: number;
  /**
   * The slice's values, i.e., `richList.list.slice(startIndex, endIndex)`.
   */
  readonly values: T[];
  /**
   * The common format for all of the slice's values.
   */
  readonly format: Record<string, any>;
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
  readonly order: OrderSavedState;
  readonly list: ListSavedState<T>;
  readonly formatting: TimestampFormattingSavedState;
};

/**
 * Convenience wrapper for a List with TimestampFormatting.
 *
 * See [RichList](https://github.com/mweidner037/list-formatting#class-richlist) in the readme.
 *
 * RichList has an API similar to a traditional rich-text data structure,
 * combining indexed access, values, and formatting in a single object.
 *
 * For operations that only involve `this.list` or `this.formatting`, call methods
 * on them directly.
 */
export class RichList<T> {
  /**
   * The Order that manages this RichList's Positions and their metadata.
   *
   * See list-positions's [List, Position, and Order](https://github.com/mweidner037/list-positions#list-position-and-order).
   */
  readonly order: Order;
  /**
   * The list of values.
   *
   * You may read and write this List directly. RichList is merely a wrapper
   * that provides some convenience methods - in particular,
   * `insertWithFormat`, which wraps `list.insertAt` to ensure
   * a given format.
   */
  readonly list: List<T>;
  /**
   * The list's formatting.
   *
   * You may read and write this TimestampFormatting directly. RichList is
   * merely a wrapper that provides some convenience methods - in particular,
   * `format` and `formattedValues`, which handle index-Anchor conversions for you.
   */
  readonly formatting: TimestampFormatting;

  private readonly expandRules?: (
    key: string,
    value: any
  ) => "after" | "before" | "none" | "both";

  /**
   * Event handler that you can set to be notified when `this.format` or
   * `this.insertWithFormat` creates a mark.
   *
   * It is called with the same `createdMark(s)` that are returned by those
   * methods.
   *
   * __Note:__ This event handler is _not_ called for marks that are
   * created directly on `this.formatting` using its newMark or addMark
   * methods.
   */
  onCreateMark: ((createdMark: TimestampMark) => void) | undefined = undefined;

  /**
   * Constructs a RichList.
   *
   * @param options.order The Order to use for `this.order`. Both `this.list`
   * and `this.formatting` share the order. If neither `options.order` nor
   * `options.list` are provided, a `new Order()` is used.
   * Exclusive with `options.list`.
   * @param options.list The List to use for `this.list`. If not provided,
   * a `new List(options?.order)` is used. Exclusive with `options.order`.
   * @param options.replicaID The replica ID for `this.formatting`
   * (_not_ `this.order`). All of our created marks will use it as their
   * `creatorID`. Default: list-positions's `BunchIDs.newReplicaID()`.
   * @param options.expandRules The value of `expand` to use when one is
   * not provided to `this.format` and for all marks created by `this.insertWithFormat`.
   * Expressed as a function that inputs the mark's key and value
   * and outputs the `expand` to use. Default: Always returns "after".
   */
  constructor(options?: {
    expandRules?: (
      key: string,
      value: any
    ) => "after" | "before" | "none" | "both";
    order?: Order;
    list?: List<T>;
    replicaID?: string;
  }) {
    if (options?.list !== undefined) {
      if (options.order !== undefined) {
        throw new Error("list and order options are exclusive");
      }
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
   * Inserts the given value at `index` using `this.list.insertAt`,
   * and applies new formatting marks
   * as needed so that the value has the exact given format.
   *
   * @returns [insertion Position,
   * [created bunch's](https://github.com/mweidner037/list-positions#createdBunch)
   * BunchMeta (or null), created formatting marks]
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
  /**
   * Inserts the given values at `index` using `this.list.insertAt`,
   * and applies new formatting marks
   * as needed so that the values have the exact given format.
   *
   * @returns [starting Position,
   * [created bunch's](https://github.com/mweidner037/list-positions#createdBunch)
   * BunchMeta (or null), created formatting marks]
   * @throws If no values are provided.
   */
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

    // We don't return the FormatChanges because they are not really needed
    // (you already know what the final format will be) and a bit confusing
    // (format props don't all match the final format; only make sense in order even
    // though marks commute). If you need them, you can add the marks yourself.
    return [startPos, createdBunch, createdMarks];
  }

  /**
   * Formats the slice `this.list.slice(startIndex, endIndex)`,
   * setting the given format key to value.
   *
   * This method always creates a new mark, even if it is redundant.
   *
   * The mark covers all positions from
   * `this.list.positionAt(startIndex)` to `this.list.positionAt(endIndex - 1)` inclusive,
   * including positions that are not currently present in `this.list`.
   * It may also "expand" to cover not-currently-present positions at
   * the slice's endpoints, depending on the value of `expand`.
   *
   * @param expand Whether the mark covers not-currently-present positions at
   * the slice's endpoints. If not provided, the output of the constructors
   * `options.expandRules` function is used, which defaults to "after".
   * - "after": The mark expands to cover positions at the end, i.e.,
   * between `this.list.positionAt(endIndex - 1)` and `this.list.positionAt(endIndex)`.
   * This is the typical behavior for most rich-text format keys (e.g. bold): the
   * formatting also affects future (& concurrent) characters inserted at the end.
   * - "before": Expands to cover positions at the beginning, i.e.,
   * between `this.list.positionAt(startIndex - 1)` and `this.list.positionAt(startIndex)`.
   * - "both": Combination of "before" and "after".
   * - "none": Does not expand.
   * This is the typical behavior for certain rich-text format keys, such as hyperlinks.
   * @returns [created mark, non-redundant format changes]
   */
  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
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
    // TODO: return index version of changes instead? If you need the spans,
    // you can DIY.
    return [mark, changes];
  }

  /**
   * Clears `this.list` and `this.formatting`, so that this RichList
   * has no values and no marks.
   *
   * `this.order` is unaffected (retains all metadata).
   */
  clear() {
    this.list.clear();
    this.formatting.clear();
  }

  /**
   * Returns the current format at index.
   */
  getFormatAt(index: number): Record<string, any> {
    return this.formatting.getFormat(this.list.positionAt(index));
  }

  /**
   * Iterates over an efficient representation of this RichList's values and their current
   * formatting.
   *
   * Same as `this.formattedValues()`.
   */
  [Symbol.iterator](): IterableIterator<FormattedValues<T>> {
    return this.formattedValues()[Symbol.iterator]();
  }

  // TODO: slice args?
  /**
   * Returns an efficient representation of this RichList's values and their current
   * formatting.
   *
   * Specifically, returns an array of FormattedValues objects in list order.
   * Each object describes a slice of values with a single format.
   */
  formattedValues(): FormattedValues<T>[] {
    const slices = this.formatting.formattedSlices(
      this.list
    ) as (FormattedSlice & { values?: T[] })[];
    const values = this.list.slice();
    for (const slice of slices) {
      // slice only appears here, so it's okay to modify it in-place.
      slice.values = values.slice(slice.startIndex, slice.endIndex);
    }
    return slices as FormattedValues<T>[];
  }

  /**
   * Returns an iterator of [position, value, format] tuples for every
   * value in the list, in list order.
   *
   * Typically, you should instead use `formattedValues()`, which returns a
   * more efficient representation of the formatted values.
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
}
