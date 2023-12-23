import { BunchIDs, Order } from "list-positions";
import {
  AbstractFormatting,
  AbstractSpan,
  Anchor,
  FormatChange,
} from "./abstract_formatting";

export type Span = {
  start: Anchor;
  end: Anchor;
  key: string;
  /** Anything except null - that's reserved to mean "delete this format". */
  value: any;
  creatorID: string;
  /** Lamport timestamp. Ties broken by creatorID. Always positive. */
  timestamp: number;
};

export class Formatting extends AbstractFormatting<Span> {
  readonly replicaID: string;
  private lamport = 0;

  constructor(order: Order, replicaID?: string) {
    super(order);

    this.replicaID = replicaID ?? BunchIDs.newReplicaID();
  }

  compareSpans(a: Span, b: Span): number {
    // Lamport timestamp order, with ties broken by creatorID.
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.creatorID === b.creatorID) return 0;
    return a.creatorID > b.creatorID ? 1 : -1;
  }

  // Note: doesn't add the span.
  newSpan(base: AbstractSpan): Span {
    this.lamport++;
    return {
      ...base,
      creatorID: this.replicaID,
      timestamp: this.lamport,
    };
  }

  // Overrides to track Lamport timestamp.

  addSpan(span: Span): FormatChange[] {
    this.lamport = Math.max(this.lamport, span.timestamp);
    return super.addSpan(span);
  }

  load(savedState: Span[]): void {
    // Since savedState is in order, the last timestamp is the greatest.
    if (savedState.length !== 0) {
      this.lamport = Math.max(
        this.lamport,
        savedState[savedState.length - 1].timestamp
      );
    }
    super.load(savedState);
  }

  // TODO: change matchFormatting to actually add the spans?
}
