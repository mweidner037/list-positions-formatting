import {
  BunchMeta,
  Order,
  OrderSavedState,
  Position,
  Text,
  TextSavedState,
} from "list-positions";
import { FormatChange, FormattedSlice } from "./formatting";
import { diffFormats, spanFromSlice } from "./helpers";
import {
  TimestampFormatting,
  TimestampFormattingSavedState,
  TimestampMark,
} from "./timestamp_formatting";

/**
 * A slice of chars with a single format, returned by
 * {@link RichText.formattedChars}.
 */
export type FormattedChars = {
  /**
   * The slice's starting index (inclusive).
   */
  readonly startIndex: number;
  /**
   * The slice's ending index (exclusive).
   */
  readonly endIndex: number;
  /**
   * The slice's chars, i.e., `richText.text.slice(startIndex, endIndex)`.
   */
  readonly chars: string;
  /**
   * The common format for all of the slice's chars.
   */
  readonly format: Record<string, any>;
};

/**
 * A JSON-serializable saved state for a `RichText<T>`.
 *
 * See RichText.save and RichText.load.
 *
 * ### Format
 *
 * For advanced usage, you may read and write RichTextSavedStates directly.
 *
 * The format is merely a `...SavedState` object for each of:
 * - `richText.order` (class Order from [list-positions](https://github.com/mweidner037/list-positions#readme)).
 * - `richText.text` (class Text from [list-positions](https://github.com/mweidner037/list-positions#readme)).
 * - `richText.formatting` (class TimestampFormatting).
 */
export type RichTextSavedState = {
  readonly order: OrderSavedState;
  readonly text: TextSavedState;
  readonly formatting: TimestampFormattingSavedState;
};

/**
 * Convenience wrapper for [Text](https://github.com/mweidner037/list-positions#text) with TimestampFormatting.
 *
 * See [RichText](https://github.com/mweidner037/list-formatting#class-richtext) in the readme.
 *
 * RichText has an API similar to a traditional rich-text data structure,
 * combining indexed access, characters, and formatting in a single object.
 *
 * For operations that only involve `this.text` or `this.formatting`, call methods
 * on those properties directly.
 */
export class RichText {
  /**
   * The Order that manages this RichText's Positions and their metadata.
   *
   * See list-positions's [List, Position, and Order](https://github.com/mweidner037/list-positions#list-position-and-order).
   */
  readonly order: Order;
  /**
   * The plain-text characters.
   *
   * You may read and write this Text directly. RichText is merely a wrapper
   * that provides some convenience methods - in particular,
   * `insertWithFormat`, which wraps `text.insertAt` to ensure
   * a given format.
   */
  readonly text: Text;
  /**
   * The text's formatting.
   *
   * You may read and write this TimestampFormatting directly. RichText is
   * merely a wrapper that provides some convenience methods - in particular,
   * `format` and `formattedChars`, which handle index/Anchor conversions for you.
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
   * It is called with the same `newMarks` that are returned by those
   * methods.
   *
   * __Note:__ This event handler is _not_ called for marks that are
   * created directly on `this.formatting` using its newMark or addMark
   * methods.
   */
  onNewMarks: ((newMarks: TimestampMark[]) => void) | undefined = undefined;

  /**
   * Constructs a RichText.
   *
   * @param options.order The Order to use for `this.order`. Both `this.text`
   * and `this.formatting` share the order. If neither `options.order` nor
   * `options.text` are provided, a `new Order()` is used.
   * Exclusive with `options.text`.
   * @param options.text The Text to use for `this.text`. If not provided,
   * a `new Text(options?.order)` is used. Exclusive with `options.order`.
   * @param options.replicaID The replica ID for `this.formatting`
   * (_not_ `this.order`). All of our created marks will use it as their
   * `creatorID`. Default: A random alphanumeric string from the
   * [maybe-random-string](https://github.com/mweidner037/maybe-random-string#readme) package.
   * @param options.expandRules The value of `expand` to use when one is
   * not provided to `this.format` and for all marks created by `this.insertWithFormat`.
   * Expressed as a function that inputs the mark's key and value
   * and outputs the `expand` to use. Default: Always returns "after".
   */
  constructor(options?: {
    order?: Order;
    text?: Text;
    replicaID?: string;
    expandRules?: (
      key: string,
      value: any
    ) => "after" | "before" | "none" | "both";
  }) {
    if (options?.text !== undefined) {
      if (options.order !== undefined) {
        throw new Error("text and order options are exclusive");
      }
      this.text = options.text;
      this.order = this.text.order;
    } else {
      this.order = options?.order ?? new Order();
      this.text = new Text(this.order);
    }
    this.formatting = new TimestampFormatting(this.order, {
      replicaID: options?.replicaID,
    });
    this.expandRules = options?.expandRules;
  }

  /**
   * Inserts the given char at `index` using `this.text.insertAt`,
   * and applies new formatting marks
   * as needed so that the char has the exact given format.
   *
   * @returns [insertion Position,
   * [new bunch's BunchMeta](https://github.com/mweidner037/list-positions#newMeta) (or null),
   * new formatting marks]
   */
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    char: string
  ): [pos: Position, newMeta: BunchMeta | null, newMarks: TimestampMark[]];
  /**
   * Inserts the given chars at `index` using `this.text.insertAt`,
   * and applies new formatting marks
   * as needed so that the chars have the exact given format.
   *
   * @returns [starting insertion Position,
   * [new bunch's BunchMeta](https://github.com/mweidner037/list-positions#newMeta) (or null),
   * newformatting marks]
   * @throws If no chars are provided.
   */
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    chars: string
  ): [startPos: Position, newMeta: BunchMeta | null, newMarks: TimestampMark[]];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    chars: string
  ): [
    startPos: Position,
    newMeta: BunchMeta | null,
    newMarks: TimestampMark[]
  ] {
    const [startPos, newMeta] = this.text.insertAt(index, chars);
    // Inserted positions all get the same initial format because they are not
    // interleaved with any existing positios.
    const needsFormat = diffFormats(
      this.formatting.getFormat(startPos),
      format
    );
    const newMarks: TimestampMark[] = [];
    for (const [key, value] of needsFormat) {
      const expand =
        this.expandRules === undefined ? "after" : this.expandRules(key, value);
      const { start, end } = spanFromSlice(
        this.text,
        index,
        index + chars.length,
        expand
      );
      const mark = this.formatting.newMark(start, end, key, value);
      this.formatting.addMark(mark);
      newMarks.push(mark);
    }
    this.onNewMarks?.(newMarks);

    // We don't return the FormatChanges because they are not really needed
    // (you already know what the final format will be) and a bit confusing
    // (format props don't all match the final format; only make sense in order even
    // though marks commute). If you need them, you can add the marks yourself.
    return [startPos, newMeta, newMarks];
  }

  /**
   * Formats the slice `this.text.slice(startIndex, endIndex)`,
   * setting the given format key to value.
   *
   * This method always creates a new mark, even if it is redundant.
   *
   * The mark covers all positions from
   * `this.text.positionAt(startIndex)` to `this.text.positionAt(endIndex - 1)` inclusive,
   * including positions that are not currently present in `this.text`.
   * It may also "expand" to cover not-currently-present positions at
   * the slice's endpoints, depending on the value of `expand`.
   *
   * @param expand Whether the mark covers not-currently-present positions at
   * the slice's endpoints. If not provided, the output of the constructor's
   * `options.expandRules` function is used, which defaults to "after".
   * - "after": The mark expands to cover positions at the end, i.e.,
   * between `this.text.positionAt(endIndex - 1)` and `this.text.positionAt(endIndex)`.
   * This is the typical behavior for most rich-text format keys (e.g. bold): the
   * formatting also affects future (& concurrent) characters inserted at the end.
   * - "before": Expands to cover positions at the beginning, i.e.,
   * between `this.text.positionAt(startIndex - 1)` and `this.text.positionAt(startIndex)`.
   * - "both": Combination of "before" and "after".
   * - "none": Does not expand.
   * This is the typical behavior for certain rich-text format keys, such as hyperlinks.
   * @returns [new mark, non-redundant format changes]
   */
  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
    expand?: "after" | "before" | "none" | "both"
  ): [newMark: TimestampMark, changes: FormatChange[]] {
    if (expand === undefined) {
      expand =
        this.expandRules === undefined ? "after" : this.expandRules(key, value);
    }

    const { start, end } = spanFromSlice(this.text, startIndex, endIndex);
    const mark = this.formatting.newMark(start, end, key, value);
    const changes = this.formatting.addMark(mark);
    this.onNewMarks?.([mark]);
    return [mark, changes];
  }

  /**
   * Clears `this.text` and `this.formatting`, so that this RichText
   * has no chars and no marks.
   *
   * `this.order` is unaffected (retains all metadata).
   */
  clear() {
    this.text.clear();
    this.formatting.clear();
  }

  /**
   * Returns the current format at index.
   */
  getFormatAt(index: number): Record<string, any> {
    return this.formatting.getFormat(this.text.positionAt(index));
  }

  /**
   * Iterates over an efficient representation of this RichText's chars and their current
   * formatting.
   *
   * Same as {@link formattedChars}.
   */
  [Symbol.iterator](): IterableIterator<FormattedChars> {
    return this.formattedChars()[Symbol.iterator]();
  }

  /**
   * Returns an efficient representation of this RichText's chars and their current
   * formatting.
   *
   * Specifically, this method returns an array of FormattedChars objects in list order.
   * Each object describes a slice of chars with a single format.
   * It is similar to [Quill's Delta format](https://quilljs.com/docs/delta/).
   *
   * Optionally, you may specify a range of indices `[start, end)` instead of
   * iterating the entire list.
   *
   * @throws If `start < 0`, `end > this.text.length`, or `start > end`.
   */
  formattedChars(start?: number, end?: number): FormattedChars[] {
    const slices = this.formatting.formattedSlices(
      this.text,
      start,
      end
    ) as (FormattedSlice & { chars?: string })[];
    if (slices.length === 0) return [];

    const chars = this.text.slice(start, end);
    const charsStart = slices[0].startIndex;
    for (const slice of slices) {
      // slice only appears here, so it's okay to modify it in-place.
      slice.chars = chars.slice(
        slice.startIndex - charsStart,
        slice.endIndex - charsStart
      );
    }
    return slices as FormattedChars[];
  }

  /**
   * Iterators over [position, char, format] tuples in the list, in list order.
   * These are its entries as a formatted & ordered map.
   *
   * Typically, you should instead use `formattedChars()`, which returns a
   * more efficient representation of the formatted chars.
   *
   * Optionally, you may specify a range of indices `[start, end)` instead of
   * iterating the entire list.
   *
   * @throws If `start < 0`, `end > this.text.length`, or `start > end`.
   */
  *entries(
    start?: number,
    end?: number
  ): IterableIterator<
    [pos: Position, char: string, format: Record<string, any>]
  > {
    for (const chars of this.formattedChars(start, end)) {
      for (let index = chars.startIndex; index < chars.endIndex; index++) {
        const pos = this.text.positionAt(index);
        yield [pos, chars.chars[index - chars.startIndex], chars.format];
      }
    }
  }

  /**
   * Returns a saved state for this RichText.
   *
   * The saved state describes our current text and formatting, plus
   * [Order metadata](https://github.com/mweidner037/list-positions#managing-metadata),
   * in JSON-serializable form. You can load this state on another RichText
   * by calling `load(savedState)`, possibly in a different session or on a
   * different device.
   *
   * Note: You can instead save and load each component (`this.order`, `this.text`,
   * and `this.formatting`) separately. If you do so, be sure to load `this.order`
   * before the others.
   */
  save(): RichTextSavedState {
    return {
      order: this.order.save(),
      text: this.text.save(),
      formatting: this.formatting.save(),
    };
  }

  /**
   * Loads a saved state returned by another RichText's `save()` method.
   *
   * Loading sets our text and formatting to match the saved RichText's,
   * *overwriting* our current state.
   */
  load(savedState: RichTextSavedState): void {
    this.order.load(savedState.order);
    this.text.load(savedState.text);
    this.formatting.load(savedState.formatting);
  }
}
