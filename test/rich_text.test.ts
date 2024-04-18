import { assert } from "chai";
import { Order, expandPositions } from "list-positions";
import { maybeRandomString } from "maybe-random-string";
import { beforeEach, describe, test } from "mocha";
import seedrandom from "seedrandom";
import { Anchors, FormattedChars, RichText } from "../src";

describe("RichText", () => {
  let prng!: seedrandom.PRNG;
  let alice!: RichText;
  let bob!: RichText;

  function expandRules(key: string, value: any) {
    if (key === "url") {
      // Peritext rule 9: hyperlinks don't expand, but their cancellations do.
      return value === null ? "both" : "none";
    } else return "after";
  }

  beforeEach(() => {
    prng = seedrandom("42");
    alice = new RichText({
      order: new Order({
        replicaID: maybeRandomString({ prng }),
      }),
      replicaID: "alice",
      expandRules,
    });
    bob = new RichText({
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
    for (const richText of [alice, bob]) {
      // At each index, check that getFormatAt matches formattedChars().
      for (const slice of richText.formattedChars()) {
        assert.isAbove(slice.endIndex, slice.startIndex);
        for (let i = slice.startIndex; i < slice.endIndex; i++) {
          assert.deepStrictEqual(richText.getFormatAt(i), slice.format);
        }
      }

      // Check that entries() matches getters.
      let i = 0;
      for (const [pos, value, format] of richText.entries()) {
        assert.deepStrictEqual(pos, richText.text.positionAt(i));
        assert.strictEqual(value, richText.text.getAt(i));
        assert.deepStrictEqual(format, richText.getFormatAt(i));
        i++;
      }
      assert.strictEqual(i, richText.text.length);

      // Test save and load.
      const richText2 = new RichText({ expandRules });
      richText2.load(richText.save());
      assert.deepStrictEqual(
        richText2.formattedChars(),
        richText.formattedChars()
      );

      // Check slice args to formattedChars.
      const formattedChars = richText.formattedChars();
      for (let s = 0; s <= richText.text.length; s++) {
        for (let e = s; e <= richText.text.length; e++) {
          assert.deepStrictEqual(
            richText.formattedChars(s, e),
            restrictFormattedChars(formattedChars, s, e)
          );
        }
      }
    }

    /**
     * Computes the restriction of slices to the given range [startIndex, endIndex).
     */
    function restrictFormattedChars(
      slices: FormattedChars[],
      startIndex: number,
      endIndex: number
    ): FormattedChars[] {
      const restricted: FormattedChars[] = [];
      for (const slice of slices) {
        const newStartIndex = Math.max(startIndex, slice.startIndex);
        const newEndIndex = Math.min(endIndex, slice.endIndex);
        if (newStartIndex < newEndIndex) {
          restricted.push({
            startIndex: newStartIndex,
            endIndex: newEndIndex,
            format: slice.format,
            chars: slice.chars.slice(
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
      const chars = "one two three";
      const [, , newMarks] = alice.insertWithFormat(0, {}, chars);
      assert.deepStrictEqual(alice.formattedChars(), [
        { startIndex: 0, endIndex: chars.length, chars, format: {} },
      ]);
      assert.deepStrictEqual(newMarks, []);
      checkMisc();
    });

    test("new format", () => {
      const chars = "one two three";
      const [startPos, , newMarks] = alice.insertWithFormat(
        0,
        { bold: true },
        chars
      );
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: chars.length,
          chars,
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
      alice.insertWithFormat(0, { bold: true }, "zero ");

      // Append more chars.
      // Since bold expands after, these will already be bold.
      const [, , newMarks] = alice.insertWithFormat(
        alice.text.length,
        { bold: true },
        "one two three"
      );
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: alice.text.length,
          chars: "zero one two three",
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMarks, []);
      checkMisc();
    });

    test("after non-expanding mark", () => {
      alice.insertWithFormat(0, { url: "www1" }, "zero ");

      // Append more chars.
      // Since url does *not* expand after, these need a new mark.
      const chars2 = "one two three";
      const [startPos, , newMarks] = alice.insertWithFormat(
        alice.text.length,
        { url: "www1" },
        chars2
      );
      const poss = expandPositions(startPos, chars2.length);
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: alice.text.length,
          chars: "zero one two three",
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
      alice.insertWithFormat(0, { bold: true }, "one three");

      // Splice in "two " without the bold format.
      const [, , newMarks] = alice.insertWithFormat(4, {}, "two ");
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: 4,
          chars: "one ",
          format: { bold: true },
        },
        {
          startIndex: 4,
          endIndex: 8,
          chars: "two ",
          format: {},
        },
        {
          startIndex: 8,
          endIndex: 13,
          chars: "three",
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMarks, [
        {
          start: { pos: alice.text.positionAt(4), before: true },
          end: { pos: alice.text.positionAt(8), before: true },
          key: "bold",
          value: null,
          creatorID: "alice",
          timestamp: 2,
        },
      ]);
      checkMisc();
    });

    test("multiple changes", () => {
      alice.insertWithFormat(0, { bold: true, url: "www1" }, "one three");

      // Splice in "two " with a different format.
      let [, , newMarks] = alice.insertWithFormat(
        4,
        { italic: true, url: "www2" },
        "two "
      );
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: 4,
          chars: "one ",
          format: { bold: true, url: "www1" },
        },
        {
          startIndex: 4,
          endIndex: 8,
          chars: "two ",
          format: { italic: true, url: "www2" },
        },
        {
          startIndex: 8,
          endIndex: 13,
          chars: "three",
          format: { bold: true, url: "www1" },
        },
      ]);
      // timestamps and array order are arbitrary, so throw them out before checking.
      newMarks = newMarks.map((mark) => ({ ...mark, timestamp: -1 }));
      newMarks.sort((a, b) => (a.key > b.key ? 1 : -1));
      assert.deepStrictEqual(newMarks, [
        {
          start: { pos: alice.text.positionAt(4), before: true },
          end: { pos: alice.text.positionAt(8), before: true },
          key: "bold",
          value: null,
          creatorID: "alice",
          timestamp: -1,
        },
        {
          start: { pos: alice.text.positionAt(4), before: true },
          end: { pos: alice.text.positionAt(8), before: true },
          key: "italic",
          value: true,
          creatorID: "alice",
          timestamp: -1,
        },
        {
          start: { pos: alice.text.positionAt(4), before: true },
          end: { pos: alice.text.positionAt(7), before: false },
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
      alice.text.insertAt(0, "one two three");

      // Format "two " to bold, with default expansion (after).
      const [newMark, changes] = alice.format(4, 8, "bold", true);
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: 4,
          chars: "one ",
          format: {},
        },
        {
          startIndex: 4,
          endIndex: 8,
          chars: "two ",
          format: { bold: true },
        },
        {
          startIndex: 8,
          endIndex: 13,
          chars: "three",
          format: {},
        },
      ]);
      assert.deepStrictEqual(newMark, {
        start: { pos: alice.text.positionAt(4), before: true },
        end: { pos: alice.text.positionAt(8), before: true },
        key: "bold",
        value: true,
        creatorID: "alice",
        timestamp: 1,
      });
      assert.deepStrictEqual(changes, [
        {
          start: { pos: alice.text.positionAt(4), before: true },
          end: { pos: alice.text.positionAt(8), before: true },
          key: "bold",
          value: true,
          previousValue: null,
          format: { bold: true },
        },
      ]);
      checkMisc();
    });

    test("partial change", () => {
      alice.text.insertAt(0, "one two three");

      // Make "two " bold to start, then format the whole list to bold and
      // check changes.
      alice.format(4, 8, "bold", true);
      const [newMark, changes] = alice.format(
        0,
        alice.text.length,
        "bold",
        true
      );
      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: 13,
          chars: "one two three",
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(newMark, {
        start: { pos: alice.text.positionAt(0), before: true },
        end: Anchors.MAX_ANCHOR,
        key: "bold",
        value: true,
        creatorID: "alice",
        timestamp: 2,
      });
      assert.deepStrictEqual(changes, [
        {
          start: { pos: alice.text.positionAt(0), before: true },
          end: { pos: alice.text.positionAt(4), before: true },
          key: "bold",
          value: true,
          previousValue: null,
          format: { bold: true },
        },
        {
          start: { pos: alice.text.positionAt(8), before: true },
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
      alice.text.insertAt(0, "one three");
      bob.text.load(alice.text.save());

      const [startPos] = alice.text.insertAt(4, "two ");
      const [newMark] = bob.format(0, bob.text.length, "bold", true);

      // Sync changes and check results.
      for (const pos of expandPositions(startPos, 4)) {
        bob.text.set(pos, alice.text.get(pos)!);
      }
      alice.formatting.addMark(newMark);

      assert.deepStrictEqual(alice.formattedChars(), [
        {
          startIndex: 0,
          endIndex: 13,
          chars: "one two three",
          format: { bold: true },
        },
      ]);
      assert.deepStrictEqual(bob.formattedChars(), alice.formattedChars());
      checkMisc();
    });

    test("errors", () => {
      alice.text.insertAt(0, "one two three");

      // Out of order, or equal.
      assert.throws(() => alice.format(0, 0, "foo", "bar"));
      assert.throws(() => alice.format(1, 1, "foo", "bar"));
      assert.throws(() => alice.format(1, 0, "foo", "bar"));
      assert.throws(() => alice.format(4, 2, "foo", "bar"));

      // Out of bounds.
      assert.throws(() => alice.format(-1, 1, "foo", "bar"));
      assert.throws(() => alice.format(3, alice.text.length + 1, "foo", "bar"));

      // text.length is okay.
      assert.doesNotThrow(() =>
        alice.format(0, alice.text.length, "foo", "bar")
      );
      assert.doesNotThrow(() =>
        alice.format(3, alice.text.length, "foo", "bar")
      );
    });
  });
});
