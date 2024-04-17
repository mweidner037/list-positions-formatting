import { assert } from "chai";
import {
  List,
  MAX_POSITION,
  MIN_POSITION,
  Order,
  Position,
  expandPositions,
} from "list-positions";
import { maybeRandomString } from "maybe-random-string";
import { describe, test } from "mocha";
import seedrandom from "seedrandom";
import {
  Anchor,
  Anchors,
  diffFormats,
  sliceFromSpan,
  spanFromSlice,
} from "../src";

describe("helpers", () => {
  let prng!: seedrandom.PRNG;

  beforeEach(() => {
    prng = seedrandom("42");
  });

  describe("spans and slices", () => {
    let list!: List<string>;
    // 10 Positions to use.
    let poss!: Position[];
    // A list with only positions (0, 1, 3, 5, 8, 9) in poss.
    let partList!: List<string>;

    beforeEach(() => {
      list = new List(
        new Order({
          replicaID: maybeRandomString({ prng }),
        })
      );
      const startPos = list.insertAt(0, ..."0123456789")[0];
      poss = expandPositions(startPos, 10);
      partList = new List(list.order);
      for (const i of [0, 1, 3, 5, 8, 9]) {
        partList.set(poss[i], list.getAt(i));
      }
    });

    test("partial inverses", () => {
      // If we convert a slice into a span and back, it stays the same,
      // regardless of expansion.
      for (let i = 0; i < partList.length; i++) {
        for (let j = i + 1; j <= partList.length; j++) {
          for (const expand of ["after", "before", "both", "none"]) {
            const slice = { startIndex: i, endIndex: j };
            const span = spanFromSlice(partList, i, j, expand as any);
            const slice2 = sliceFromSpan(partList, span.start, span.end);
            assert.deepStrictEqual(slice2, slice);
          }
        }
      }
    });

    test("errors", () => {
      assert.throws(() => {
        spanFromSlice(list, 0, 0);
      });
      assert.throws(() => {
        spanFromSlice(list, 1, 1);
      });
      assert.throws(() => {
        spanFromSlice(list, 1, 0);
      });
      assert.throws(() => {
        spanFromSlice(list, list.length, list.length);
      });
      assert.throws(() => {
        spanFromSlice(list, list.length, 0);
      });
    });

    // Convert a partList slice into a span and check what slice
    // it expands to in list.
    describe("expand", () => {
      function checkExpand(
        expand: "after" | "before" | "both" | "none",
        startPart: number,
        endPart: number,
        startList: number,
        endList: number
      ) {
        const { start, end } = spanFromSlice(
          partList,
          startPart,
          endPart,
          expand
        );
        const slice = sliceFromSpan(list, start, end);
        assert.deepStrictEqual(slice, {
          startIndex: startList,
          endIndex: endList,
        });
      }

      test("none", () => {
        const expand = "none";
        checkExpand(expand, 0, 1, 0, 1);
        checkExpand(expand, 0, 2, 0, 2);
        checkExpand(expand, 0, 3, 0, 4);
        checkExpand(expand, 0, 4, 0, 6);
        checkExpand(expand, 0, 5, 0, 9);
        checkExpand(expand, 0, 6, 0, 10);

        checkExpand(expand, 1, 2, 1, 2);
        checkExpand(expand, 1, 3, 1, 4);
        checkExpand(expand, 1, 4, 1, 6);
        checkExpand(expand, 1, 5, 1, 9);
        checkExpand(expand, 1, 6, 1, 10);

        checkExpand(expand, 3, 4, 5, 6);
        checkExpand(expand, 3, 5, 5, 9);
        checkExpand(expand, 3, 6, 5, 10);

        checkExpand(expand, 0, 6, 0, 10);
        checkExpand(expand, 1, 6, 1, 10);
        checkExpand(expand, 2, 6, 3, 10);
        checkExpand(expand, 3, 6, 5, 10);
        checkExpand(expand, 4, 6, 8, 10);
        checkExpand(expand, 5, 6, 9, 10);
      });

      test("after", () => {
        const expand = "after";
        checkExpand(expand, 0, 1, 0, 1);
        checkExpand(expand, 0, 2, 0, 3);
        checkExpand(expand, 0, 3, 0, 5);
        checkExpand(expand, 0, 4, 0, 8);
        checkExpand(expand, 0, 5, 0, 9);
        checkExpand(expand, 0, 6, 0, 10);

        checkExpand(expand, 1, 2, 1, 3);
        checkExpand(expand, 1, 3, 1, 5);
        checkExpand(expand, 1, 4, 1, 8);
        checkExpand(expand, 1, 5, 1, 9);
        checkExpand(expand, 1, 6, 1, 10);

        checkExpand(expand, 3, 4, 5, 8);
        checkExpand(expand, 3, 5, 5, 9);
        checkExpand(expand, 3, 6, 5, 10);

        checkExpand(expand, 0, 6, 0, 10);
        checkExpand(expand, 1, 6, 1, 10);
        checkExpand(expand, 2, 6, 3, 10);
        checkExpand(expand, 3, 6, 5, 10);
        checkExpand(expand, 4, 6, 8, 10);
        checkExpand(expand, 5, 6, 9, 10);
      });

      test("before", () => {
        const expand = "before";
        checkExpand(expand, 0, 1, 0, 1);
        checkExpand(expand, 0, 2, 0, 2);
        checkExpand(expand, 0, 3, 0, 4);
        checkExpand(expand, 0, 4, 0, 6);
        checkExpand(expand, 0, 5, 0, 9);
        checkExpand(expand, 0, 6, 0, 10);

        checkExpand(expand, 1, 2, 1, 2);
        checkExpand(expand, 1, 3, 1, 4);
        checkExpand(expand, 1, 4, 1, 6);
        checkExpand(expand, 1, 5, 1, 9);
        checkExpand(expand, 1, 6, 1, 10);

        checkExpand(expand, 3, 4, 4, 6);
        checkExpand(expand, 3, 5, 4, 9);
        checkExpand(expand, 3, 6, 4, 10);

        checkExpand(expand, 0, 6, 0, 10);
        checkExpand(expand, 1, 6, 1, 10);
        checkExpand(expand, 2, 6, 2, 10);
        checkExpand(expand, 3, 6, 4, 10);
        checkExpand(expand, 4, 6, 6, 10);
        checkExpand(expand, 5, 6, 9, 10);
      });

      test("both", () => {
        const expand = "both";
        checkExpand(expand, 0, 1, 0, 1);
        checkExpand(expand, 0, 2, 0, 3);
        checkExpand(expand, 0, 3, 0, 5);
        checkExpand(expand, 0, 4, 0, 8);
        checkExpand(expand, 0, 5, 0, 9);
        checkExpand(expand, 0, 6, 0, 10);

        checkExpand(expand, 1, 2, 1, 3);
        checkExpand(expand, 1, 3, 1, 5);
        checkExpand(expand, 1, 4, 1, 8);
        checkExpand(expand, 1, 5, 1, 9);
        checkExpand(expand, 1, 6, 1, 10);

        checkExpand(expand, 3, 4, 4, 8);
        checkExpand(expand, 3, 5, 4, 9);
        checkExpand(expand, 3, 6, 4, 10);

        checkExpand(expand, 0, 6, 0, 10);
        checkExpand(expand, 1, 6, 1, 10);
        checkExpand(expand, 2, 6, 2, 10);
        checkExpand(expand, 3, 6, 4, 10);
        checkExpand(expand, 4, 6, 6, 10);
        checkExpand(expand, 5, 6, 9, 10);
      });
    });

    // Convert a list slice into a span and check what slice
    // it "expands" to in partList (really contracting).
    test("contract", () => {
      function checkContract(
        startList: number,
        endList: number,
        startPart: number,
        endPart: number
      ) {
        for (const expand of ["after", "before", "both", "none"]) {
          const { start, end } = spanFromSlice(
            list,
            startList,
            endList,
            expand as any
          );
          const slice = sliceFromSpan(partList, start, end);
          assert.deepStrictEqual(slice, {
            startIndex: startPart,
            endIndex: endPart,
          });
        }
      }

      checkContract(0, 1, 0, 1);
      checkContract(0, 2, 0, 2);
      checkContract(0, 3, 0, 2);
      checkContract(0, 4, 0, 3);
      checkContract(0, 5, 0, 3);
      checkContract(0, 6, 0, 4);
      checkContract(0, 7, 0, 4);
      checkContract(0, 8, 0, 4);
      checkContract(0, 9, 0, 5);
      checkContract(0, 10, 0, 6);

      checkContract(4, 5, 3, 3);
      checkContract(4, 6, 3, 4);
      checkContract(4, 7, 3, 4);
      checkContract(4, 8, 3, 4);
      checkContract(4, 9, 3, 5);
      checkContract(4, 10, 3, 6);

      checkContract(5, 6, 3, 4);
      checkContract(5, 7, 3, 4);
      checkContract(5, 8, 3, 4);
      checkContract(5, 9, 3, 5);
      checkContract(5, 10, 3, 6);
    });
  });

  describe("diffFormats", () => {
    function checkDiff(
      current: Record<string, any>,
      target: Record<string, any>,
      expectedAsObj: Record<string, any>
    ) {
      assert.deepStrictEqual(
        diffFormats(current, target),
        new Map(Object.entries(expectedAsObj))
      );
    }

    test("increase", () => {
      checkDiff({}, { a: 0 }, { a: 0 });
      checkDiff({}, { a: 0, b: 1 }, { a: 0, b: 1 });
      checkDiff({ a: 0 }, { a: 0, b: 1 }, { b: 1 });
      checkDiff({ b: 1 }, { a: 0, b: 1 }, { a: 0 });
    });

    test("decrease", () => {
      checkDiff({ a: 0, b: 1 }, {}, { a: null, b: null });
      checkDiff({ a: 0, b: 1 }, { a: 0 }, { b: null });
      checkDiff({ a: 0, b: 1 }, { b: 1 }, { a: null });
      checkDiff({ a: 0 }, {}, { a: null });
    });

    test("change", () => {
      checkDiff({ a: 0, b: 1 }, { a: 7, b: 1 }, { a: 7 });
      checkDiff({ a: 0, b: 1 }, { a: 0, b: 8 }, { b: 8 });
      checkDiff({ a: 0, b: 1 }, { a: 7, b: 8 }, { a: 7, b: 8 });
    });

    test("mixed", () => {
      checkDiff({ a: 0, b: 1 }, { a: 7 }, { a: 7, b: null });
      checkDiff({ a: 0, b: 1 }, { a: 0, c: 3 }, { b: null, c: 3 });
      checkDiff({ a: 0, b: 1 }, { a: 7, c: 3 }, { a: 7, b: null, c: 3 });
      checkDiff({ a: 0, b: 1 }, { a: 7, b: 1, c: 3 }, { a: 7, c: 3 });
      checkDiff({ a: 0, b: 1 }, { a: 7, b: 8, c: 3 }, { a: 7, b: 8, c: 3 });
    });

    test("ignores null values", () => {
      checkDiff({ a: 0, b: 1, c: null }, { a: 7 }, { a: 7, b: null });
      checkDiff({ a: 0, b: 1, c: null }, { a: 0, c: 3 }, { b: null, c: 3 });
      checkDiff(
        { a: 0, b: 1 },
        { a: 7, c: 3, b: null },
        { a: 7, b: null, c: 3 }
      );
    });
  });

  // Anchors.* tests.
  describe("Anchors utilities", () => {
    describe("compare", () => {
      test("all pairs", () => {
        const list = new List(
          new Order({
            replicaID: maybeRandomString({ prng }),
          })
        );
        list.insertAt(0, ..."0123456789");

        const allAnchors: Anchor[] = [Anchors.MIN_ANCHOR];
        for (const pos of list.positions()) {
          allAnchors.push({ pos, before: true }, { pos, before: false });
        }
        allAnchors.push(Anchors.MAX_ANCHOR);

        for (let i = 0; i < allAnchors.length; i++) {
          for (let j = 0; j < allAnchors.length; j++) {
            const cmp = Anchors.compare(
              list.order,
              allAnchors[i],
              allAnchors[j]
            );
            assert.strictEqual(Math.sign(cmp), Math.sign(i - j));
          }
        }
      });
    });

    test("validate", () => {
      assert.throws(() =>
        Anchors.validate({ pos: MIN_POSITION, before: true })
      );
      assert.throws(() =>
        Anchors.validate({ pos: MAX_POSITION, before: false })
      );

      assert.doesNotThrow(() =>
        Anchors.validate({ pos: MIN_POSITION, before: false })
      );
      assert.doesNotThrow(() =>
        Anchors.validate({ pos: MAX_POSITION, before: true })
      );

      const list = new List(
        new Order({
          replicaID: maybeRandomString({ prng }),
        })
      );
      list.insertAt(0, ..."0123456789");
      for (const pos of list.positions()) {
        assert.doesNotThrow(() => Anchors.validate({ pos, before: true }));
        assert.doesNotThrow(() => Anchors.validate({ pos, before: false }));
      }
    });
  });
});
