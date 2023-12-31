import { BunchIDs, Order } from "list-positions";
import { Anchor } from "./anchor";
import { FormatChange, Formatting, FormattingSavedState } from "./formatting";

/**
 * Mark type for TimestampFormatting.
 *
 * To create a TimestampMark, use `TimestampFormatting.newMark`.
 *
 * TimestampMark implements IMark and uses
 * [Lamport timestamps](https://en.wikipedia.org/wiki/Lamport_timestamp)
 * for the compareMarks order. TimestampMarks work even in a
 * collaborative setting, with the properties:
 * 1. TimestampMarks are globally unique, even if multiple collaborators
 * create them concurrently.
 * Specifically, the pair (creatorID, timestamp) is unique.
 * 2. A new TimestampMark is always greater than all marks that were
 * previously created or added by its TimestampFormatting.
 * Thus a new mark "wins" over all marks in the current state, as expected.
 */
export type TimestampMark = {
  /** TODO: copy from IMark. x4 */
  start: Anchor;
  end: Anchor;
  key: string;
  value: any;
  /**
   * The replicaID of the TimestampFormatting instance that created this mark
   * (via `TimestampFormatting.newMark`).
   */
  creatorID: string;
  /**
   * The mark's [Lamport timestamps](https://en.wikipedia.org/wiki/Lamport_timestamp).
   *
   * Marks are sorted by this timestamp, with ties broken using the lexicographic
   * order on creatorIDs.
   */
  timestamp: number;
};

/**
 * Compare function for TimestampMarks.
 */
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

/**
 * TODO
 */
export class TimestampFormatting extends Formatting<TimestampMark> {
  /**
   * Our replicaID, used as all of our created marks'
   * `creatorID`.
   */
  readonly replicaID: string;
  /**
   * Current Lamport timestamp. Our next timestamp will be one greater.
   */
  private timestamp = 0;

  /**
   * Constructs a TimestampFormatting.
   *
   * @param order The Order to use for `this.order`.
   * Typically, it should be shared with the list(s) that this
   * is formatting.
   * If not provided, a `new Order()` is used.
   * @param options.replicaID Our replicaID, used as all of our created marks'
   * `creatorID`. It is _not_ used by `this.order`.
   * Default: list-positions's `BunchIDs.newReplicaID()`.
   */
  constructor(order: Order, options?: { replicaID?: string }) {
    super(order, compareTimestampMarks);

    this.replicaID = options?.replicaID ?? BunchIDs.newReplicaID();
  }

  /**
   * Creates and returns a unique new TimestampMark. The mark is _not_
   * added to our set of marks; you must call `this.addMark` separately.
   *
   * The mark's timestamp is greater than that of all previously created or added marks,
   * and it uses `this.replicaID` as its creatorID.
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
