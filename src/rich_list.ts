import {
  BunchMeta,
  List,
  ListSavedState,
  Order,
  OrderSavedState,
  Position,
} from "list-positions";
import { Anchor, FormatChange } from "./formatting";
import { diffFormats, indexOfAnchor, spanFromSlice } from "./helpers";
import { TimestampFormatting, TimestampMark } from "./timestamp_formatting";

export type FormattedValues<T> = {
  startIndex: number;
  endIndex: number;
  values: T[];
  format: Record<string, any>;
};

export type RichListSavedState<T> = {
  order: OrderSavedState;
  list: ListSavedState<T>;
  formatting: TimestampMark[];
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
   *
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
    createdMarks: TimestampMark[],
    changes: FormatChange[]
  ];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: TimestampMark[],
    changes: FormatChange[]
  ];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: TimestampMark[],
    changes: FormatChange[]
  ] {
    const [startPos, createdBunch] = this.list.insertAt(index, ...values);
    // Inserted positions all get the same initial format because they are not
    // interleaved with any existing positios.
    const needsFormat = diffFormats(
      this.formatting.getFormat(startPos),
      format
    );
    const createdMarks: TimestampMark[] = [];
    // Since each mark affects a different key, these all commute.
    // But for the record, they're stored in the order they happened.
    const changes: FormatChange[] = [];
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
      changes.push(...this.formatting.addMark(mark));
      this.onCreateMark?.(mark);
      createdMarks.push(mark);
    }

    return [startPos, createdBunch, createdMarks, changes];
  }

  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
    expand: "after" | "before" | "none" | "both" = "after"
  ): [createMark: TimestampMark, changes: FormatChange[]] {
    if (startIndex <= endIndex) {
      throw new Error(`startIndex <= endIndex: ${startIndex}, ${endIndex}`);
    }

    let start: Anchor;
    if (expand === "before" || expand === "both") {
      const pos =
        startIndex === 0
          ? Order.MIN_POSITION
          : this.list.positionAt(startIndex - 1);
      start = { pos, before: false };
    } else {
      start = { pos: this.list.positionAt(startIndex), before: true };
    }
    let end: Anchor;
    if (expand === "after" || expand === "both") {
      const pos =
        endIndex === this.list.length
          ? Order.MAX_POSITION
          : this.list.positionAt(endIndex);
      end = { pos, before: true };
    } else {
      end = { pos: this.list.positionAt(endIndex - 1), before: false };
    }

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
      const endIndex = indexOfAnchor(this.list, span.end);
      for (; index < endIndex; index++) {
        const pos = this.list.positionAt(index);
        yield [pos, this.list.get(pos)!, span.format];
      }
    }
  }

  save(): RichListSavedState<T> {
    return {
      order: this.order.save(),
      list: this.list.save(),
      formatting: this.formatting.save(),
    };
  }

  load(savedState: RichListSavedState<T>): void {
    this.order.load(savedState.order);
    this.list.load(savedState.list);
    this.formatting.load(savedState.formatting);
  }

  // Other ops only involve one of (list, formatting); do it directly on them?
}
