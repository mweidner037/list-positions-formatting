import { BunchMeta, List, Order, Position } from "list-positions";
import { Anchor } from "./abstract_formatting";
import { Formatting, Span } from "./formatting";

// Allow "any" as the span value type.
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

export class RichList<T> {
  readonly order: Order;
  readonly list: List<T>;
  readonly formatting: Formatting;

  private readonly expandRules?: (
    key: string,
    value: any
  ) => "after" | "before" | "none" | "both";

  // TODO: use x2
  onCreateSpan: ((createdSpan: Span) => void) | undefined = undefined;

  constructor(options?: {
    order?: Order; // If not provided, all are "after".
    expandRules?: (
      key: string,
      value: any
    ) => "after" | "before" | "none" | "both";
  }) {
    this.order = options?.order ?? new Order();
    this.list = new List(this.order);
    this.formatting = new Formatting(this.order);
    this.expandRules = options?.expandRules;
  }

  insertAt(
    index: number,
    format: Record<string, any>,
    value: T
  ): [pos: Position, createdBunch: BunchMeta | null, createdSpans: Span[]];
  insertAt(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [startPos: Position, createdBunch: BunchMeta | null, createdSpans: Span[]];
  insertAt(
    index: number,
    format: Record<string, any>,
    ...values: T[]
  ): [
    startPos: Position,
    createdBunch: BunchMeta | null,
    createdSpans: Span[]
  ] {
    const [startPos, createdBunch] = this.list.insertAt(index, ...values);
    const createdSpans = this.formatting.matchFormat(
      this.list,
      index,
      format,
      this.expandRules
    );
    if (this.onCreateSpan) {
      for (const createdSpan of createdSpans) this.onCreateSpan(createdSpan);
    }
    return [startPos, createdBunch, createdSpans];
  }

  format(
    startIndex: number,
    endIndex: number,
    key: string,
    value: any,
    expand: "after" | "before" | "none" | "both" = "after"
  ): Span {
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

    const span = this.formatting.newSpan({ start, end, key, value });
    this.formatting.addSpan(span);
    return span;
  }

  // Other ops only involve one of (list, formatting); do it directly on them?
}
