import { BunchIDs, Order } from "list-positions";
import { Anchor } from "./anchor";
import { FormatChange, Formatting, FormattingSavedState } from "./formatting";

export type TimestampMark = {
  start: Anchor;
  end: Anchor;
  key: string;
  /** Anything except null - that's reserved to mean "delete this format". */
  value: any;
  creatorID: string;
  /** Lamport timestamp. Ties broken by creatorID. Always positive. */
  timestamp: number;
};

function compareTimestampMarks(a: TimestampMark, b: TimestampMark): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.creatorID === b.creatorID) return 0;
  return a.creatorID > b.creatorID ? 1 : -1;
}

/**
 * A JSON-serializable saved state for a `TimestampFormatting`.
 *
 * See TimestampFormatting.save and TimestampFormatting.load.
 *
 * ### Format
 *
 * For advanced usage, you may read and write TimestampFormattingSavedStates directly.
 *
 * Its format is the array of all marks _in compareMarks order (ascending)_.
 * This is merely `[...formatting.marks()]`.
 */
export type TimestampFormattingSavedState = FormattingSavedState<TimestampMark>;

export class TimestampFormatting extends Formatting<TimestampMark> {
  readonly replicaID: string;
  private timestamp = 0;

  constructor(order: Order, options?: { replicaID?: string }) {
    super(order, compareTimestampMarks);

    this.replicaID = options?.replicaID ?? BunchIDs.newReplicaID();
  }

  /**
   * Creates a new TimestampMark without adding it.
   *
   * It is greater than all known marks and uses our replicaID.
   *
   * @param start
   * @param end
   * @param key
   * @param value
   */
  newMark(start: Anchor, end: Anchor, key: string, value: any): TimestampMark {
    return {
      start,
      end,
      key,
      value,
      creatorID: this.replicaID,
      timestamp: ++this.timestamp,
    };
  }

  addMark(mark: TimestampMark): FormatChange[] {
    this.timestamp = Math.max(this.timestamp, mark.timestamp);
    return super.addMark(mark);
  }

  /**
   * Returns a saved state for this TimestampFormatting.
   *
   * The saved state describes all of our (non-deleted) marks in JSON-serializable form.
   * (In fact, it is merely the array `[...this.marks()]`.)
   * You can load this state on another TimestampFormatting
   * by calling `load(savedState)`, possibly in a different session or on a
   * different device.
   */
  save(): TimestampFormattingSavedState {
    return super.save();
  }

  /**
   * Loads a saved state returned by another TimestampFormatting's `save()` method.
   *
   * Loading sets our marks to match the saved TimestampFormatting's,
   * *overwriting* our current state.
   */
  load(savedState: TimestampFormattingSavedState): void {
    super.load(savedState);
    if (savedState.length !== 0) {
      // Use the fact that savedState is in order by timestamp.
      this.timestamp = Math.max(
        this.timestamp,
        savedState[savedState.length - 1].timestamp
      );
    }
  }
}
