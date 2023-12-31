import { assert } from "chai";
import { BunchIDs, Order } from "list-positions";
import { beforeEach, describe, test } from "mocha";
import seedrandom from "seedrandom";
import { RichList } from "../src";

describe("RichList", () => {
  let rng!: seedrandom.prng;
  let alice!: RichList<string>;
  let bob!: RichList<string>;

  function expandRules(key: string, value: any) {
    if (key === "url") {
      // Peritext rule 9: hyperlinks don't expand, but their cancellations do.
      return value === null ? "both" : "none";
    } else return "after";
  }

  beforeEach(() => {
    rng = seedrandom("42");
    alice = new RichList({
      order: new Order({
        newBunchID: BunchIDs.usingReplicaID(BunchIDs.newReplicaID({ rng })),
      }),
      replicaID: "alice",
      expandRules,
    });
    bob = new RichList({
      order: new Order({
        newBunchID: BunchIDs.usingReplicaID(BunchIDs.newReplicaID({ rng })),
      }),
      replicaID: "bob",
      expandRules,
    });

    // Sync order metadata for convenience.
    alice.order.onCreateBunch = (createdBunch) =>
      bob.order.receive([createdBunch]);
    bob.order.onCreateBunch = (createdBunch) =>
      alice.order.receive([createdBunch]);
  });

  function checkMisc() {
    for (const richList of [alice, bob]) {
      // At each index, check that getFormatAt matches formattedValues().
      for (const slice of richList.formattedValues()) {
        assert.isAbove(slice.endIndex, slice.startIndex);
        for (let i = slice.startIndex; i < slice.endIndex; i++) {
          assert.deepStrictEqual(richList.getFormatAt(i), slice.format);
        }
      }

      // Check that entries() matches getters.
      let i = 0;
      for (const [pos, value, format] of richList.entries()) {
        assert.deepStrictEqual(pos, richList.list.positionAt(i));
        assert.strictEqual(value, richList.list.getAt(i));
        assert.deepStrictEqual(format, richList.getFormatAt(i));
        i++;
      }
      assert.strictEqual(i, richList.list.length);

      // Test save and load.
      const richList2 = new RichList({ expandRules });
      richList2.load(richList.save());
      assert.deepStrictEqual(
        richList2.formattedValues(),
        richList.formattedValues()
      );
    }
  }

  describe("insertWithFormat", () => {
    test("plain", () => {
      const values = [..."one two three"];
      const [, , createdMarks] = alice.insertWithFormat(0, {}, ...values);
      assert.deepStrictEqual(alice.formattedValues(), [
        { startIndex: 0, endIndex: values.length, values, format: {} },
      ]);
      assert.deepStrictEqual(createdMarks, []);
      checkMisc();
    });

    test("new format", () => {
      const values = [..."one two three"];
      const [startPos, , createdMarks] = alice.insertWithFormat(
        0,
        { bold: true },
        ...values
      );
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: values.length,
          values,
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(createdMarks, [
        {
          start: { pos: startPos, before: true },
          end: { pos: Order.MAX_POSITION, before: true },
          key: "bold",
          value: true,
          creatorID: "alice",
          timestamp: 1,
        },
      ]);
      checkMisc();
    });

    test("existing format", () => {
      const values1 = [..."zero "];
      alice.insertWithFormat(0, { bold: true }, ...values1);

      // Append more values.
      // Since bold expands after, these will already be bold.
      const values2 = [..."one two three"];
      const [, , createdMarks] = alice.insertWithFormat(
        alice.list.length,
        { bold: true },
        ...values2
      );
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: alice.list.length,
          values: [...values1, ...values2],
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(createdMarks, []);
      checkMisc();
    });

    test("after non-expanding mark", () => {
      const values1 = [..."zero "];
      alice.insertWithFormat(0, { url: "www1" }, ...values1);

      // Append more values.
      // Since url does *not* expand after, these need a new mark.
      const values2 = [..."one two three"];
      const [startPos, , createdMarks] = alice.insertWithFormat(
        alice.list.length,
        { url: "www1" },
        ...values2
      );
      const poss = Order.startPosToArray(startPos, values2.length);
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: alice.list.length,
          values: [...values1, ...values2],
          format: { url: "www1" },
        },
      ]);
      assert.deepStrictEqual(createdMarks, [
        {
          start: { pos: startPos, before: true },
          end: { pos: poss.at(-1)!, before: false },
          key: "url",
          value: "www1",
          creatorID: "alice",
          timestamp: 2,
        },
      ]);
      checkMisc();
    });
  });
});
