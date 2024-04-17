import { assert } from "chai";
import { Order, expandPositions } from "list-positions";
import { maybeRandomString } from "maybe-random-string";
import { beforeEach, describe, test } from "mocha";
import seedrandom from "seedrandom";
import { Anchors, FormattedValues, RichList } from "../src";

describe("RichList", () => {
  let prng!: seedrandom.PRNG;
  let alice!: RichList<string>;
  let bob!: RichList<string>;

  function expandRules(key: string, value: any) {
    if (key === "url") {
      // Peritext rule 9: hyperlinks don't expand, but their cancellations do.
      return value === null ? "both" : "none";
    } else return "after";
  }

  beforeEach(() => {
    prng = seedrandom("42");
    alice = new RichList({
      order: new Order({
        replicaID: maybeRandomString({ prng }),
      }),
      replicaID: "alice",
      expandRules,
    });
    bob = new RichList({
      order: new Order({
        replicaID: maybeRandomString({ prng }),
      }),
      replicaID: "bob",
      expandRules,
    });

    // Sync order metadata for convenience.
    alice.order.onNewMeta = (newMeta) => bob.order.addMetas([newMeta]);
    bob.order.onNewMeta = (newMeta) => alice.order.addMetas([newMeta]);
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

      // Check slice args to formattedValues.
      const formattedValues = richList.formattedValues();
      for (let s = 0; s <= richList.list.length; s++) {
        for (let e = s; e <= richList.list.length; e++) {
          assert.deepStrictEqual(
            richList.formattedValues(s, e),
            restrictFormattedValues(formattedValues, s, e)
          );
        }
      }
    }

    /**
     * Computes the restriction of slices to the given range [startIndex, endIndex).
     */
    function restrictFormattedValues<T>(
      slices: FormattedValues<T>[],
      startIndex: number,
      endIndex: number
    ): FormattedValues<T>[] {
      const restricted: FormattedValues<T>[] = [];
      for (const slice of slices) {
        const newStartIndex = Math.max(startIndex, slice.startIndex);
        const newEndIndex = Math.min(endIndex, slice.endIndex);
        if (newStartIndex < newEndIndex) {
          restricted.push({
            startIndex: newStartIndex,
            endIndex: newEndIndex,
            format: slice.format,
            values: slice.values.slice(
              newStartIndex - slice.startIndex,
              newEndIndex - slice.startIndex
            ),
          });
        }
      }
      return restricted;
    }
  }

  describe("insertWithFormat", () => {
    test("plain", () => {
      const values = [..."one two three"];
      const [, , newMarks] = alice.insertWithFormat(0, {}, ...values);
      assert.deepStrictEqual(alice.formattedValues(), [
        { startIndex: 0, endIndex: values.length, values, format: {} },
      ]);
      assert.deepStrictEqual(newMarks, []);
      checkMisc();
    });

    test("new format", () => {
      const values = [..."one two three"];
      const [startPos, , newMarks] = alice.insertWithFormat(
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
      assert.deepStrictEqual(newMarks, [
        {
          start: { pos: startPos, before: true },
          end: Anchors.MAX_ANCHOR,
          key: "bold",
          value: true,
          creatorID: "alice",
          timestamp: 1,
        },
      ]);
      checkMisc();
    });

    test("existing format", () => {
      alice.insertWithFormat(0, { bold: true }, ..."zero ");

      // Append more values.
      // Since bold expands after, these will already be bold.
      const [, , newMarks] = alice.insertWithFormat(
        alice.list.length,
        { bold: true },
        ..."one two three"
      );
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: alice.list.length,
          values: [..."zero one two three"],
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMarks, []);
      checkMisc();
    });

    test("after non-expanding mark", () => {
      alice.insertWithFormat(0, { url: "www1" }, ..."zero ");

      // Append more values.
      // Since url does *not* expand after, these need a new mark.
      const values2 = [..."one two three"];
      const [startPos, , newMarks] = alice.insertWithFormat(
        alice.list.length,
        { url: "www1" },
        ...values2
      );
      const poss = expandPositions(startPos, values2.length);
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: alice.list.length,
          values: [..."zero one two three"],
          format: { url: "www1" },
        },
      ]);
      assert.deepStrictEqual(newMarks, [
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

    test("deletion", () => {
      alice.insertWithFormat(0, { bold: true }, ..."one three");

      // Splice in "two " without the bold format.
      const [, , newMarks] = alice.insertWithFormat(4, {}, ..."two ");
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: 4,
          values: [..."one "],
          format: { bold: true },
        },
        {
          startIndex: 4,
          endIndex: 8,
          values: [..."two "],
          format: {},
        },
        {
          startIndex: 8,
          endIndex: 13,
          values: [..."three"],
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMarks, [
        {
          start: { pos: alice.list.positionAt(4), before: true },
          end: { pos: alice.list.positionAt(8), before: true },
          key: "bold",
          value: null,
          creatorID: "alice",
          timestamp: 2,
        },
      ]);
      checkMisc();
    });

    test("multiple changes", () => {
      alice.insertWithFormat(0, { bold: true, url: "www1" }, ..."one three");

      // Splice in "two " with a different format.
      let [, , newMarks] = alice.insertWithFormat(
        4,
        { italic: true, url: "www2" },
        ..."two "
      );
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: 4,
          values: [..."one "],
          format: { bold: true, url: "www1" },
        },
        {
          startIndex: 4,
          endIndex: 8,
          values: [..."two "],
          format: { italic: true, url: "www2" },
        },
        {
          startIndex: 8,
          endIndex: 13,
          values: [..."three"],
          format: { bold: true, url: "www1" },
        },
      ]);
      // timestamps and array order are arbitrary, so throw them out before checking.
      newMarks = newMarks.map((mark) => ({ ...mark, timestamp: -1 }));
      newMarks.sort((a, b) => (a.key > b.key ? 1 : -1));
      assert.deepStrictEqual(newMarks, [
        {
          start: { pos: alice.list.positionAt(4), before: true },
          end: { pos: alice.list.positionAt(8), before: true },
          key: "bold",
          value: null,
          creatorID: "alice",
          timestamp: -1,
        },
        {
          start: { pos: alice.list.positionAt(4), before: true },
          end: { pos: alice.list.positionAt(8), before: true },
          key: "italic",
          value: true,
          creatorID: "alice",
          timestamp: -1,
        },
        {
          start: { pos: alice.list.positionAt(4), before: true },
          end: { pos: alice.list.positionAt(7), before: false },
          key: "url",
          value: "www2",
          creatorID: "alice",
          timestamp: -1,
        },
      ]);
      checkMisc();
    });
  });

  describe("format", () => {
    test("once", () => {
      alice.list.insertAt(0, ..."one two three");

      // Format "two " to bold, with default expansion (after).
      const [newMark, changes] = alice.format(4, 8, "bold", true);
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: 4,
          values: [..."one "],
          format: {},
        },
        {
          startIndex: 4,
          endIndex: 8,
          values: [..."two "],
          format: { bold: true },
        },
        {
          startIndex: 8,
          endIndex: 13,
          values: [..."three"],
          format: {},
        },
      ]);
      assert.deepStrictEqual(newMark, {
        start: { pos: alice.list.positionAt(4), before: true },
        end: { pos: alice.list.positionAt(8), before: true },
        key: "bold",
        value: true,
        creatorID: "alice",
        timestamp: 1,
      });
      assert.deepStrictEqual(changes, [
        {
          start: { pos: alice.list.positionAt(4), before: true },
          end: { pos: alice.list.positionAt(8), before: true },
          key: "bold",
          value: true,
          previousValue: null,
          format: { bold: true },
        },
      ]);
      checkMisc();
    });

    test("partial change", () => {
      alice.list.insertAt(0, ..."one two three");

      // Make "two " bold to start, then format the whole list to bold and
      // check changes.
      alice.format(4, 8, "bold", true);
      const [newMark, changes] = alice.format(
        0,
        alice.list.length,
        "bold",
        true
      );
      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: 13,
          values: [..."one two three"],
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMark, {
        start: { pos: alice.list.positionAt(0), before: true },
        end: Anchors.MAX_ANCHOR,
        key: "bold",
        value: true,
        creatorID: "alice",
        timestamp: 2,
      });
      assert.deepStrictEqual(changes, [
        {
          start: { pos: alice.list.positionAt(0), before: true },
          end: { pos: alice.list.positionAt(4), before: true },
          key: "bold",
          value: true,
          previousValue: null,
          format: { bold: true },
        },
        {
          start: { pos: alice.list.positionAt(8), before: true },
          end: Anchors.MAX_ANCHOR,
          key: "bold",
          value: true,
          previousValue: null,
          format: { bold: true },
        },
      ]);
      checkMisc();
    });

    test("formats and inserts concurrently", () => {
      alice.list.insertAt(0, ..."one three");
      bob.list.load(alice.list.save());

      const [startPos] = alice.list.insertAt(4, ..."two ");
      const [newMark] = bob.format(0, bob.list.length, "bold", true);

      // Sync changes and check results.
      for (const pos of expandPositions(startPos, 4)) {
        bob.list.set(pos, alice.list.get(pos)!);
      }
      alice.formatting.addMark(newMark);

      assert.deepStrictEqual(alice.formattedValues(), [
        {
          startIndex: 0,
          endIndex: 13,
          values: [..."one two three"],
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(bob.formattedValues(), alice.formattedValues());
      checkMisc();
    });
  });
});
