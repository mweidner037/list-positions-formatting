import { assert } from "chai";
import { BunchIDs, List, Order, Position } from "list-positions";
import { describe, test } from "mocha";
import seedrandom from "seedrandom";
import { FormattedSpan, TimestampFormatting } from "../src";

describe("TimestampFormatting", () => {
  let rng!: seedrandom.prng;
  beforeEach(() => {
    rng = seedrandom("42");
  });

  describe("single instance", () => {
    let list!: List<string>;
    let formatting!: TimestampFormatting;
    // 10 Positions to use.
    let pos!: Position[];

    beforeEach(() => {
      list = new List();
      const startPos = list.insertAt(0, ..."0123456789")[0];
      pos = Order.startPosToArray(startPos, 10);
      formatting = new TimestampFormatting(list.order, {
        replicaID: BunchIDs.newReplicaID({ rng }),
      });
    });

    test("one mark", () => {
      // Add one mark and check changes & formattedSpans.
      let t = 1;
      for (const start of [
        { pos: Order.MIN_POSITION, before: false },
        { pos: pos[0], before: true },
        { pos: pos[0], before: false },
        { pos: pos[3], before: true },
        { pos: pos[3], before: false },
      ]) {
        for (const end of [
          { pos: Order.MAX_POSITION, before: true },
          { pos: pos[9], before: false },
          { pos: pos[9], before: true },
          { pos: pos[6], before: false },
          { pos: pos[6], before: true },
        ]) {
          formatting.clear();
          const mark = formatting.newMark(start, end, "italic", true);
          assert.strictEqual(mark.creatorID, formatting.replicaID);
          assert.strictEqual(mark.timestamp, t);

          const changes = formatting.addMark(mark);
          assert.deepStrictEqual(changes, [
            {
              start,
              end,
              key: "italic",
              value: true,
              previousValue: null,
              format: { italic: true },
            },
          ]);

          const spans: FormattedSpan[] = [];
          if (!Order.equalsPosition(start.pos, Order.MIN_POSITION)) {
            spans.push({
              start: { pos: Order.MIN_POSITION, before: false },
              end: start,
              format: {},
            });
          }
          spans.push({ start, end, format: { italic: true } });
          if (!Order.equalsPosition(end.pos, Order.MAX_POSITION)) {
            spans.push({
              start: end,
              end: { pos: Order.MAX_POSITION, before: true },
              format: {},
            });
          }
          assert.deepStrictEqual(formatting.formattedSpans(), spans);

          t++;
        }
      }
    });
  });
});
