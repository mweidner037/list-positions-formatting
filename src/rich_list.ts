import {
  BunchIDs,
  BunchMeta,
  List,
  ListSavedState,
  Order,
  OrderSavedState,
  Position,
} from "list-positions";
import { Anchor, FormatChange, FormattedSpan, Formatting } from "./formatting";
import { diffFormats, sliceFromSpan, spanFromSlice } from "./helpers";

export type Mark = {
  start: Anchor;
  end: Anchor;
  key: string;
  /** Anything except null - that's reserved to mean "delete this format". */
  value: any;
  creatorID: string;
  /** Lamport timestamp. Ties broken by creatorID. Always positive. */
  timestamp: number;
};

export type FormattedSlice = {
  startIndex: number;
  endIndex: number;
  format: Record<string, any>;
};

export type RichListSavedState<T> = {
  order: OrderSavedState;
  list: ListSavedState<T>;
  formatting: Mark[];
};

export class RichList<T> {
  readonly order: Order;
  readonly list: List<T>;
  private readonly formatting: Formatting<Mark>;

  readonly replicaID: string;
  private timestamp = 0;

  private readonly expandRules?: (
    key: string,
    value: any
  ) => "after" | "before" | "none" | "both";

  onCreateMark: ((createdMark: Mark) => void) | undefined = undefined;

  constructor(options?: {
    // TODO: also accept list as arg?
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
    // TODO: need to capture its created marks so we can update Lamport timestamp.
    // But w/o breaking users own onCreateMark.
    // Maybe subclass/wrapper is the best approach here?
    this.formatting = new Formatting(this.order, RichList.compareMarks);
    this.replicaID = options?.replicaID ?? BunchIDs.newReplicaID();
    this.expandRules = options?.expandRules;
  }

  static compareMarks = (a: Mark, b: Mark): number => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.creatorID === b.creatorID) return 0;
    return a.creatorID > b.creatorID ? 1 : -1;
  };

  // TODO: return changes? So you know which key-value pairs changed,
  // and to let you reuse event methods.
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    value: T
  ): [pos: Position, createdBunch: BunchMeta | null, createdMarks: Mark[]];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [startPos: Position, createdBunch: BunchMeta | null, createdMarks: Mark[]];
  insertWithFormat(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdMarks: Mark[]
  ] {
    const [startPos, createdBunch] = this.list.insertAt(index, ...values);
    // Inserted positions all get the same initial format because they are not
    // interleaved with any existing positios.
    const needsFormat = diffFormats(
      this.formatting.getFormat(startPos),
      format
    );
    const createdMarks: Mark[] = [];
    for (const [key, value] of needsFormat) {
      const expand =
        this.expandRules === undefined ? "after" : this.expandRules(key, value);
      const { start, end } = spanFromSlice(
        this.list,
        index,
        index + values.length,
        expand
      );
      const mark: Mark = {
        start,
        end,
        key,
        value,
        timestamp: ++this.timestamp,
        creatorID: this.replicaID,
      };
      this.formatting.addMark(mark);
      this.onCreateMark?.(mark);
      createdMarks.push(mark);
    }

    return [startPos, createdBunch, createdMarks];
  }

  // TODO: matchFormat wrapper for later set/setAt? One that actually adds the marks.

  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
    expand: "after" | "before" | "none" | "both" = "after"
  ): Mark {
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

    const mark: Mark = {
      start,
      end,
      key,
      value,
      timestamp: ++this.timestamp,
      creatorID: this.replicaID,
    };
    this.formatting.addMark(mark);
    this.onCreateMark?.(mark);
    return mark;
  }

  formattedSlices(): FormattedSlice[] {
    // TODO: combine identical neighbors; opts
    return this.formatting.formattedSpans().map((span) => ({
      ...sliceFromSpan(this.list, span.start, span.end),
      format: span.format,
    }));
  }

  // Wrappers for formatting methods.

  addMark(mark: Mark): FormatChange[] {
    this.timestamp = Math.max(this.timestamp, mark.timestamp);
    return this.formatting.addMark(mark);
  }

  deleteMark(mark: Mark): FormatChange[] {
    return this.formatting.deleteMark(mark);
  }

  clearFormatting(): void {
    this.formatting.clear();
  }

  clear() {
    this.list.clear();
    this.formatting.clear();
  }

  getFormat(pos: Position): Record<string, any> {
    return this.formatting.getFormat(pos);
  }

  getFormatAt(index: number): Record<string, any> {
    return this.formatting.getFormat(this.list.positionAt(index));
  }

  formattedSpans(): FormattedSpan[] {
    return this.formatting.formattedSpans();
  }

  marks(): IterableIterator<Mark> {
    return this.formatting.marks();
  }

  saveFormatting(): Mark[] {
    return this.formatting.save();
  }

  loadFormatting(savedState: Mark[]): void {
    this.formatting.load(savedState);
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

  // TODO: save/load
}
