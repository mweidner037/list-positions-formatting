import { assert } from "chai";
import { BunchIDs, List, Order, Position } from "list-positions";
import { describe, test } from "mocha";
import seedrandom from "seedrandom";
import {
  Anchors,
  FormattedSpan,
  TimestampFormatting,
  TimestampMark,
} from "../src";

describe("TimestampFormatting", () => {
  let rng!: seedrandom.prng;
  beforeEach(() => {
    rng = seedrandom("42");
  });

  describe("single instance", () => {
    let list!: List<string>;
    let formatting!: TimestampFormatting;
    // 10 Positions to use.
    let poss!: Position[];

    beforeEach(() => {
      list = new List(
        new Order({
          newBunchID: BunchIDs.usingReplicaID(BunchIDs.newReplicaID({ rng })),
        })
      );
      const startPos = list.insertAt(0, ..."0123456789")[0];
      poss = Order.startPosToArray(startPos, 10);
      formatting = new TimestampFormatting(list.order, {
        replicaID: BunchIDs.newReplicaID({ rng }),
      });
    });

    function checkMisc() {
      // At each Position, check that getFormat matches formattedSpans().
      // Also sanity check all getters.
      let i = 0;
      for (const span of formatting.formattedSpans()) {
        while (i < poss.length) {
          const pos = poss[i];
          // Break the inner loop if pos is not in this span.
          const cmp = formatting.order.compare(pos, span.end.pos);
          if (cmp > 0 || (cmp === 0 && span.end.before)) {
            break;
          }

          // Check getFormat matches span.
          assert.deepStrictEqual(formatting.getFormat(pos), span.format);

          // Sanity check all getters.
          for (const [key, marks] of formatting.getAllMarks(pos)) {
            assert.isDefined(marks, key);
            assert.isNotEmpty(marks, key);
          }
          for (const [key, mark] of formatting.getActiveMarks(pos)) {
            assert.isDefined(mark, key);
          }
          for (const [key, value] of Object.entries(
            formatting.getFormat(pos)
          )) {
            assert.isNotNull(value, key);
          }

          i++;
        }
      }

      // Test save and load.
      const order2 = new Order();
      order2.load(formatting.order.save());
      const formatting2 = new TimestampFormatting(order2);
      formatting2.load(formatting.save());
      assert.deepStrictEqual(
        formatting2.formattedSpans(),
        formatting.formattedSpans()
      );
    }

    test("empty formatting", () => {
      assert.deepStrictEqual(formatting.formattedSpans(), [
        {
          start: Anchors.MIN_ANCHOR,
          end: Anchors.MAX_ANCHOR,
          format: {},
        },
      ]);
      checkMisc();
    });

    test("one mark", () => {
      // Add one mark and check changes & formattedSpans.
      let t = 1;
      for (const start of [
        Anchors.MIN_ANCHOR,
        { pos: poss[0], before: true },
        { pos: poss[0], before: false },
        { pos: poss[3], before: true },
        { pos: poss[3], before: false },
      ]) {
        for (const end of [
          Anchors.MAX_ANCHOR,
          { pos: poss[9], before: false },
          { pos: poss[9], before: true },
          { pos: poss[6], before: false },
          { pos: poss[6], before: true },
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
              start: Anchors.MIN_ANCHOR,
              end: start,
              format: {},
            });
          }
          spans.push({ start, end, format: { italic: true } });
          if (!Order.equalsPosition(end.pos, Order.MAX_POSITION)) {
            spans.push({
              start: end,
              end: Anchors.MAX_ANCHOR,
              format: {},
            });
          }
          assert.deepStrictEqual(formatting.formattedSpans(), spans);
          checkMisc();

          t++;
        }
      }
    });

    describe("one key", () => {
      test("combined marks", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();

              const mark1 = formatting.newMark(
                Anchors.MIN_ANCHOR,
                { pos: poss[6], before: before1 },
                "italic",
                true
              );
              formatting.addMark(mark1);
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "italic",
                true
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[9], before: before3 },
                  format: { italic: true },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  key: "italic",
                  value: true,
                  previousValue: null,
                  format: { italic: true },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      test("conflicting marks", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                Anchors.MIN_ANCHOR,
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              formatting.addMark(mark1);
              // This wins over mark1.
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "url",
                "www2"
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: { url: "www1" },
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[9], before: before3 },
                  format: { url: "www2" },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  key: "url",
                  value: "www2",
                  previousValue: "www1",
                  format: { url: "www2" },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  key: "url",
                  value: "www2",
                  previousValue: null,
                  format: { url: "www2" },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      test("null mark", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                Anchors.MIN_ANCHOR,
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              formatting.addMark(mark1);
              // This wins over mark1, clearing it.
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "url",
                null
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: { url: "www1" },
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  key: "url",
                  value: null,
                  previousValue: "www1",
                  format: {},
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      // Test spans that touch the same anchors.
      test("same start anchor", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              formatting.addMark(mark1);
              // This wins over mark1.
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "url",
                "www2"
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: {},
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[9], before: before3 },
                  format: { url: "www2" },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  key: "url",
                  value: "www2",
                  previousValue: "www1",
                  format: { url: "www2" },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  key: "url",
                  value: "www2",
                  previousValue: null,
                  format: { url: "www2" },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      test("same end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              Anchors.MIN_ANCHOR,
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            // This wins over mark1.
            const mark2 = formatting.newMark(
              { pos: poss[3], before: before2 },
              { pos: poss[6], before: before1 },
              "url",
              "www2"
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: before2 },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[3], before: before2 },
                end: { pos: poss[6], before: before1 },
                format: { url: "www2" },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: before2 },
                end: { pos: poss[6], before: before1 },
                key: "url",
                value: "www2",
                previousValue: "www1",
                format: { url: "www2" },
              },
            ]);
            checkMisc();
          }
        }
      });

      // One mark's end is the next's start.
      test("same start/end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              Anchors.MIN_ANCHOR,
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            const mark2 = formatting.newMark(
              { pos: poss[6], before: before1 },
              { pos: poss[9], before: before3 },
              "url",
              "www2"
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[6], before: before1 },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                format: { url: "www2" },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "url",
                value: "www2",
                previousValue: null,
                format: { url: "www2" },
              },
            ]);
            checkMisc();
          }
        }
      });

      // Spans that touch same pos but different anchors.
      test("same start pos 1", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              { pos: poss[3], before: false },
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            // This wins over mark1.
            const mark2 = formatting.newMark(
              { pos: poss[3], before: true },
              { pos: poss[9], before: before3 },
              "url",
              "www2"
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: true },
                format: {},
              },
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[9], before: before3 },
                format: { url: "www2" },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[3], before: false },
                key: "url",
                value: "www2",
                previousValue: null,
                format: { url: "www2" },
              },
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                key: "url",
                value: "www2",
                previousValue: "www1",
                format: { url: "www2" },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "url",
                value: "www2",
                previousValue: null,
                format: { url: "www2" },
              },
            ]);
            checkMisc();
          }
        }
      });

      test("same start pos 2", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              // Booleans are flipped relative to "same start pos 1".
              { pos: poss[3], before: true },
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            // This wins over mark1.
            const mark2 = formatting.newMark(
              { pos: poss[3], before: false },
              { pos: poss[9], before: before3 },
              "url",
              "www2"
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: true },
                format: {},
              },
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[3], before: false },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[9], before: before3 },
                format: { url: "www2" },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                key: "url",
                value: "www2",
                previousValue: "www1",
                format: { url: "www2" },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "url",
                value: "www2",
                previousValue: null,
                format: { url: "www2" },
              },
            ]);
            checkMisc();
          }
        }
      });

      test("same end pos 1", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            { pos: poss[6], before: false },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          // This wins over mark1.
          const mark2 = formatting.newMark(
            { pos: poss[3], before: before2 },
            { pos: poss[6], before: true },
            "url",
            "www2"
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: before2 },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              format: { url: "www2" },
            },
            {
              start: { pos: poss[6], before: true },
              end: { pos: poss[6], before: false },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[6], before: false },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              key: "url",
              value: "www2",
              previousValue: "www1",
              format: { url: "www2" },
            },
          ]);
          checkMisc();
        }
      });

      test("same end pos 2", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            // Booleans are flipped relative to "same end pos 1".
            { pos: poss[6], before: true },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          // This wins over mark1.
          const mark2 = formatting.newMark(
            { pos: poss[3], before: before2 },
            { pos: poss[6], before: false },
            "url",
            "www2"
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: before2 },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: false },
              format: { url: "www2" },
            },
            {
              start: { pos: poss[6], before: false },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              key: "url",
              value: "www2",
              previousValue: "www1",
              format: { url: "www2" },
            },
            {
              start: { pos: poss[6], before: true },
              end: { pos: poss[6], before: false },
              key: "url",
              value: "www2",
              previousValue: null,
              format: { url: "www2" },
            },
          ]);
          checkMisc();
        }
      });

      test("same start/end pos 1", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            { pos: poss[3], before: true },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          // This wins over mark1.
          const mark2 = formatting.newMark(
            { pos: poss[3], before: false },
            { pos: poss[9], before: before3 },
            "url",
            "www2"
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: true },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[3], before: false },
              format: {},
            },
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              format: { url: "www2" },
            },
            {
              start: { pos: poss[9], before: before3 },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              key: "url",
              value: "www2",
              previousValue: null,
              format: { url: "www2" },
            },
          ]);
          checkMisc();
        }
      });

      test("same start/end pos 2", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            // Booleans are flipped relative to "same start/end pos 1".
            { pos: poss[3], before: false },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          // This wins over mark1.
          const mark2 = formatting.newMark(
            { pos: poss[3], before: true },
            { pos: poss[9], before: before3 },
            "url",
            "www2"
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: true },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[9], before: before3 },
              format: { url: "www2" },
            },
            {
              start: { pos: poss[9], before: before3 },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[3], before: false },
              key: "url",
              value: "www2",
              previousValue: "www1",
              format: { url: "www2" },
            },
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              key: "url",
              value: "www2",
              previousValue: null,
              format: { url: "www2" },
            },
          ]);
          checkMisc();
        }
      });

      // Same as "conflicting marks", but we add the marks in
      // the wrong order.
      test("out-of-order marks", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                Anchors.MIN_ANCHOR,
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              // This wins over mark1 but is added first.
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "url",
                "www2"
              );

              formatting.addMark(mark2);
              const changes = formatting.addMark(mark1);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: { url: "www1" },
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[9], before: before3 },
                  format: { url: "www2" },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  key: "url",
                  value: "www1",
                  previousValue: null,
                  format: { url: "www1" },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      test("add and delete", () => {
        const mark1 = formatting.newMark(
          Anchors.MIN_ANCHOR,
          { pos: poss[6], before: true },
          "url",
          "www1"
        );
        const mark2 = formatting.newMark(
          { pos: poss[3], before: true },
          { pos: poss[9], before: false },
          "url",
          "www2"
        );
        const mark3 = formatting.newMark(
          { pos: poss[3], before: true },
          { pos: poss[9], before: false },
          "url",
          "www1"
        );

        formatting.addMark(mark1);
        formatting.addMark(mark2);
        formatting.addMark(mark3);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[9], before: false },
            format: { url: "www1" },
          },
          {
            start: { pos: poss[9], before: false },
            end: Anchors.MAX_ANCHOR,
            format: {},
          },
        ]);
        checkMisc();

        const changes1 = formatting.deleteMark(mark3);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[3], before: true },
            format: { url: "www1" },
          },
          {
            start: { pos: poss[3], before: true },
            end: { pos: poss[9], before: false },
            format: { url: "www2" },
          },
          {
            start: { pos: poss[9], before: false },
            end: Anchors.MAX_ANCHOR,
            format: {},
          },
        ]);
        assert.deepStrictEqual(changes1, [
          {
            start: { pos: poss[3], before: true },
            end: { pos: poss[9], before: false },
            key: "url",
            value: "www2",
            previousValue: "www1",
            format: { url: "www2" },
          },
        ]);
        checkMisc();

        const changes2 = formatting.deleteMark(mark1);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[3], before: true },
            format: {},
          },
          {
            start: { pos: poss[3], before: true },
            end: { pos: poss[9], before: false },
            format: { url: "www2" },
          },
          {
            start: { pos: poss[9], before: false },
            end: Anchors.MAX_ANCHOR,
            format: {},
          },
        ]);
        assert.deepStrictEqual(changes2, [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[3], before: true },
            key: "url",
            value: null,
            previousValue: "www1",
            format: {},
          },
        ]);
        checkMisc();

        const changes3 = formatting.addMark(mark3);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[3], before: true },
            format: {},
          },
          {
            start: { pos: poss[3], before: true },
            end: { pos: poss[9], before: false },
            format: { url: "www1" },
          },
          {
            start: { pos: poss[9], before: false },
            end: Anchors.MAX_ANCHOR,
            format: {},
          },
        ]);
        assert.deepStrictEqual(changes3, [
          {
            start: { pos: poss[3], before: true },
            end: { pos: poss[9], before: false },
            key: "url",
            value: "www1",
            previousValue: "www2",
            format: { url: "www1" },
          },
        ]);
        checkMisc();

        // Test redundant add/delete.
        const formatBefore = formatting.formattedSpans();
        assert.deepStrictEqual(formatting.addMark(mark2), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        assert.deepStrictEqual(formatting.addMark(mark3), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        assert.deepStrictEqual(formatting.deleteMark(mark1), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        checkMisc();
      });

      // Test binary search by adding many marks in random order.
      test("many out-of-order marks", () => {
        const marks: TimestampMark[] = [];
        for (let i = 0; i < 100; i++) {
          marks.push(
            formatting.newMark(
              { pos: poss[1], before: true },
              { pos: poss[5], before: true },
              "url",
              "www" + i
            )
          );
        }

        // Add the marks in random order, sometimes redundantly.
        let greatestIndex = -1;
        const allMarks = new Set<TimestampMark>();
        for (let i = 0; i < 200; i++) {
          const index = Math.floor(rng() * marks.length);
          allMarks.add(marks[index]);
          const changes = formatting.addMark(marks[index]);
          if (index > greatestIndex) {
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[1], before: true },
                end: { pos: poss[5], before: true },
                key: "url",
                value: "www" + index,
                previousValue:
                  greatestIndex === -1 ? null : "www" + greatestIndex,
                format: { url: "www" + index },
              },
            ]);
            greatestIndex = index;
          } else {
            assert.deepStrictEqual(changes, []);
          }
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[1], before: true },
              format: {},
            },
            {
              start: { pos: poss[1], before: true },
              end: { pos: poss[5], before: true },
              format: { url: "www" + greatestIndex },
            },
            {
              start: { pos: poss[5], before: true },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
        }

        // Check that all marks are in order.
        let allMarksSorted = [...allMarks];
        allMarksSorted.sort((a, b) => a.timestamp - b.timestamp);
        assert.deepStrictEqual([...formatting.marks()], allMarksSorted);
        assert.deepStrictEqual(
          formatting.getAllMarks(poss[3]).get("url"),
          allMarksSorted
        );

        // Delete some of the marks at random.
        for (let i = 0; i < 50; i++) {
          const index = Math.floor(rng() * marks.length);
          allMarks.delete(marks[index]);
          formatting.deleteMark(marks[index]);
        }

        // Check that all marks are still in order.
        allMarksSorted = [...allMarks];
        allMarksSorted.sort((a, b) => a.timestamp - b.timestamp);
        assert.deepStrictEqual([...formatting.marks()], allMarksSorted);
        assert.deepStrictEqual(
          formatting.getAllMarks(poss[3]).get("url"),
          allMarksSorted
        );

        // Check resulting formatting.
        const winner = allMarksSorted.at(-1)!;
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: Anchors.MIN_ANCHOR,
            end: { pos: poss[1], before: true },
            format: {},
          },
          {
            start: { pos: poss[1], before: true },
            end: { pos: poss[5], before: true },
            format: { url: winner.value },
          },
          {
            start: { pos: poss[5], before: true },
            end: Anchors.MAX_ANCHOR,
            format: {},
          },
        ]);
      });
    });

    describe("multiple keys", () => {
      test("overlapping", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                Anchors.MIN_ANCHOR,
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              formatting.addMark(mark1);
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "bold",
                true
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: { url: "www1" },
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  format: { url: "www1", bold: true },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  format: { bold: true },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  key: "bold",
                  value: true,
                  previousValue: null,
                  format: { url: "www1", bold: true },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  key: "bold",
                  value: true,
                  previousValue: null,
                  format: { bold: true },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      // Test spans that touch the same anchors.
      test("same start anchor", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            for (const before3 of [true, false]) {
              formatting.clear();
              const mark1 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[6], before: before1 },
                "url",
                "www1"
              );
              formatting.addMark(mark1);
              const mark2 = formatting.newMark(
                { pos: poss[3], before: before2 },
                { pos: poss[9], before: before3 },
                "bold",
                true
              );

              const changes = formatting.addMark(mark2);
              assert.deepStrictEqual(formatting.formattedSpans(), [
                {
                  start: Anchors.MIN_ANCHOR,
                  end: { pos: poss[3], before: before2 },
                  format: {},
                },
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  format: { url: "www1", bold: true },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  format: { bold: true },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: Anchors.MAX_ANCHOR,
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: poss[3], before: before2 },
                  end: { pos: poss[6], before: before1 },
                  key: "bold",
                  value: true,
                  previousValue: null,
                  format: { url: "www1", bold: true },
                },
                {
                  start: { pos: poss[6], before: before1 },
                  end: { pos: poss[9], before: before3 },
                  key: "bold",
                  value: true,
                  previousValue: null,
                  format: { bold: true },
                },
              ]);
              checkMisc();
            }
          }
        }
      });

      test("same end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              Anchors.MIN_ANCHOR,
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            const mark2 = formatting.newMark(
              { pos: poss[3], before: before2 },
              { pos: poss[6], before: before1 },
              "bold",
              true
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: before2 },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[3], before: before2 },
                end: { pos: poss[6], before: before1 },
                format: { url: "www1", bold: true },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: before2 },
                end: { pos: poss[6], before: before1 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { url: "www1", bold: true },
              },
            ]);
            checkMisc();
          }
        }
      });

      // One mark's end is the other's start.
      test("same start/end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              Anchors.MIN_ANCHOR,
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            const mark2 = formatting.newMark(
              { pos: poss[6], before: before1 },
              { pos: poss[9], before: before3 },
              "bold",
              true
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[6], before: before1 },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                format: { bold: true },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { bold: true },
              },
            ]);
            checkMisc();
          }
        }
      });

      // Spans that touch same pos but different anchors.
      test("same start pos 1", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              { pos: poss[3], before: false },
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            const mark2 = formatting.newMark(
              { pos: poss[3], before: true },
              { pos: poss[9], before: before3 },
              "bold",
              true
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: true },
                format: {},
              },
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[3], before: false },
                format: { bold: true },
              },
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                format: { url: "www1", bold: true },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                format: { bold: true },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[3], before: false },
                key: "bold",
                value: true,
                previousValue: null,
                format: { bold: true },
              },
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { url: "www1", bold: true },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { bold: true },
              },
            ]);
            checkMisc();
          }
        }
      });

      test("same start pos 2", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              // Booleans are flipped relative to "same start pos 1".
              { pos: poss[3], before: true },
              { pos: poss[6], before: before1 },
              "url",
              "www1"
            );
            formatting.addMark(mark1);
            const mark2 = formatting.newMark(
              { pos: poss[3], before: false },
              { pos: poss[9], before: before3 },
              "bold",
              true
            );

            const changes = formatting.addMark(mark2);
            assert.deepStrictEqual(formatting.formattedSpans(), [
              {
                start: Anchors.MIN_ANCHOR,
                end: { pos: poss[3], before: true },
                format: {},
              },
              {
                start: { pos: poss[3], before: true },
                end: { pos: poss[3], before: false },
                format: { url: "www1" },
              },
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                format: { url: "www1", bold: true },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                format: { bold: true },
              },
              {
                start: { pos: poss[9], before: before3 },
                end: Anchors.MAX_ANCHOR,
                format: {},
              },
            ]);
            assert.deepStrictEqual(changes, [
              {
                start: { pos: poss[3], before: false },
                end: { pos: poss[6], before: before1 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { url: "www1", bold: true },
              },
              {
                start: { pos: poss[6], before: before1 },
                end: { pos: poss[9], before: before3 },
                key: "bold",
                value: true,
                previousValue: null,
                format: { bold: true },
              },
            ]);
            checkMisc();
          }
        }
      });

      test("same end pos 1", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            { pos: poss[6], before: false },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          const mark2 = formatting.newMark(
            { pos: poss[3], before: before2 },
            { pos: poss[6], before: true },
            "bold",
            true
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: before2 },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              format: { url: "www1", bold: true },
            },
            {
              start: { pos: poss[6], before: true },
              end: { pos: poss[6], before: false },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[6], before: false },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              key: "bold",
              value: true,
              previousValue: null,
              format: { url: "www1", bold: true },
            },
          ]);
          checkMisc();
        }
      });

      test("same end pos 2", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            // Booleans are flipped relative to "same end pos 1".
            { pos: poss[6], before: true },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          const mark2 = formatting.newMark(
            { pos: poss[3], before: before2 },
            { pos: poss[6], before: false },
            "bold",
            true
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: before2 },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              format: { url: "www1", bold: true },
            },
            {
              start: { pos: poss[6], before: true },
              end: { pos: poss[6], before: false },
              format: { bold: true },
            },
            {
              start: { pos: poss[6], before: false },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: before2 },
              end: { pos: poss[6], before: true },
              key: "bold",
              value: true,
              previousValue: null,
              format: { url: "www1", bold: true },
            },
            {
              start: { pos: poss[6], before: true },
              end: { pos: poss[6], before: false },
              key: "bold",
              value: true,
              previousValue: null,
              format: { bold: true },
            },
          ]);
          checkMisc();
        }
      });

      test("same start/end pos 1", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            { pos: poss[3], before: true },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          const mark2 = formatting.newMark(
            { pos: poss[3], before: false },
            { pos: poss[9], before: before3 },
            "bold",
            true
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: true },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[3], before: false },
              format: {},
            },
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              format: { bold: true },
            },
            {
              start: { pos: poss[9], before: before3 },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              key: "bold",
              value: true,
              previousValue: null,
              format: { bold: true },
            },
          ]);
          checkMisc();
        }
      });

      test("same start/end pos 2", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            Anchors.MIN_ANCHOR,
            // Booleans are flipped relative to "same start/end pos 1".
            { pos: poss[3], before: false },
            "url",
            "www1"
          );
          formatting.addMark(mark1);
          const mark2 = formatting.newMark(
            { pos: poss[3], before: true },
            { pos: poss[9], before: before3 },
            "bold",
            true
          );

          const changes = formatting.addMark(mark2);
          assert.deepStrictEqual(formatting.formattedSpans(), [
            {
              start: Anchors.MIN_ANCHOR,
              end: { pos: poss[3], before: true },
              format: { url: "www1" },
            },
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[3], before: false },
              format: { url: "www1", bold: true },
            },
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              format: { bold: true },
            },
            {
              start: { pos: poss[9], before: before3 },
              end: Anchors.MAX_ANCHOR,
              format: {},
            },
          ]);
          assert.deepStrictEqual(changes, [
            {
              start: { pos: poss[3], before: true },
              end: { pos: poss[3], before: false },
              key: "bold",
              value: true,
              previousValue: null,
              format: { url: "www1", bold: true },
            },
            {
              start: { pos: poss[3], before: false },
              end: { pos: poss[9], before: before3 },
              key: "bold",
              value: true,
              previousValue: null,
              format: { bold: true },
            },
          ]);
          checkMisc();
        }
      });
    });

    test("errors", () => {
      // Out-of-order mark endpoints.
      assert.throws(() => {
        formatting.addMark(
          formatting.newMark(
            Anchors.MAX_ANCHOR,
            Anchors.MIN_ANCHOR,
            "italic",
            true
          )
        );
      });
      assert.throws(() => {
        formatting.addMark(
          formatting.newMark(
            { pos: poss[3], before: true },
            Anchors.MIN_ANCHOR,
            "italic",
            true
          )
        );
      });
      assert.throws(() => {
        formatting.addMark(
          formatting.newMark(
            { pos: poss[3], before: true },
            { pos: poss[2], before: false },
            "italic",
            true
          )
        );
      });
      assert.throws(() => {
        formatting.addMark(
          formatting.newMark(
            { pos: poss[3], before: false },
            { pos: poss[3], before: false },
            "italic",
            true
          )
        );
      });
      assert.throws(() => {
        formatting.addMark(
          formatting.newMark(
            { pos: poss[3], before: false },
            { pos: poss[3], before: true },
            "italic",
            true
          )
        );
      });

      assert.doesNotThrow(() => {
        formatting.addMark(
          formatting.newMark(
            { pos: poss[3], before: true },
            { pos: poss[3], before: false },
            "italic",
            true
          )
        );
      });

      // Min/max format data.
      assert.throws(() => {
        formatting.getFormat(Order.MIN_POSITION);
      });
      assert.throws(() => {
        formatting.getFormat(Order.MAX_POSITION);
      });
      assert.doesNotThrow(() => {
        formatting.getFormat(poss[0]);
      });
      assert.doesNotThrow(() => {
        formatting.getFormat(poss.at(-1)!);
      });
    });

    test("empty load", () => {
      formatting.load([]);
      assert.strictEqual(
        formatting.newMark(
          { pos: poss[1], before: true },
          { pos: poss[9], before: true },
          "url",
          "www1"
        ).timestamp,
        1
      );
    });
  });

  describe("two instances", () => {
    let aliceList!: List<string>;
    let alice!: TimestampFormatting;
    let bobList!: List<string>;
    let bob!: TimestampFormatting;
    // 10 Positions to use.
    let poss!: Position[];

    beforeEach(() => {
      aliceList = new List(
        new Order({
          newBunchID: BunchIDs.usingReplicaID(BunchIDs.newReplicaID({ rng })),
        })
      );
      const startPos = aliceList.insertAt(0, ..."0123456789")[0];
      poss = Order.startPosToArray(startPos, 10);

      bobList = new List(
        new Order({
          newBunchID: BunchIDs.usingReplicaID(BunchIDs.newReplicaID({ rng })),
        })
      );
      bobList.order.load(aliceList.order.save());
      bobList.load(aliceList.save());

      alice = new TimestampFormatting(aliceList.order, {
        replicaID: "alice",
      });
      bob = new TimestampFormatting(bobList.order, {
        replicaID: "bob",
      });
    });

    test("concurrent marks 1", () => {
      const aMark = alice.newMark(
        { pos: poss[1], before: true },
        { pos: poss[9], before: true },
        "url",
        "www1"
      );
      alice.addMark(aMark);
      const bMark = bob.newMark(
        { pos: poss[3], before: true },
        { pos: poss[5], before: true },
        "url",
        "www2"
      );
      bob.addMark(bMark);

      // Simulate collaboration.
      // Since "bob" > "alice", bMark wins.
      const aChanges = alice.addMark(bMark);
      assert.deepStrictEqual(aChanges, [
        {
          start: { pos: poss[3], before: true },
          end: { pos: poss[5], before: true },
          key: "url",
          value: "www2",
          previousValue: "www1",
          format: { url: "www2" },
        },
      ]);
      assert.deepStrictEqual(alice.formattedSpans(), [
        {
          start: Anchors.MIN_ANCHOR,
          end: { pos: poss[1], before: true },
          format: {},
        },
        {
          start: { pos: poss[1], before: true },
          end: { pos: poss[3], before: true },
          format: { url: "www1" },
        },
        {
          start: { pos: poss[3], before: true },
          end: { pos: poss[5], before: true },
          format: { url: "www2" },
        },
        {
          start: { pos: poss[5], before: true },
          end: { pos: poss[9], before: true },
          format: { url: "www1" },
        },
        {
          start: { pos: poss[9], before: true },
          end: Anchors.MAX_ANCHOR,
          format: {},
        },
      ]);

      const bChanges = bob.addMark(aMark);
      assert.deepStrictEqual(bChanges, [
        {
          start: { pos: poss[1], before: true },
          end: { pos: poss[3], before: true },
          key: "url",
          value: "www1",
          previousValue: null,
          format: { url: "www1" },
        },
        {
          start: { pos: poss[5], before: true },
          end: { pos: poss[9], before: true },
          key: "url",
          value: "www1",
          previousValue: null,
          format: { url: "www1" },
        },
      ]);
      assert.deepStrictEqual(bob.formattedSpans(), alice.formattedSpans());
    });

    test("concurrent marks 2", () => {
      // Ranges are swapped relative to "concurrent marks 1".
      const aMark = alice.newMark(
        { pos: poss[3], before: true },
        { pos: poss[5], before: true },
        "url",
        "www1"
      );
      alice.addMark(aMark);
      const bMark = bob.newMark(
        { pos: poss[1], before: true },
        { pos: poss[9], before: true },
        "url",
        "www2"
      );
      bob.addMark(bMark);

      // Simulate collaboration.
      // Since "bob" > "alice", bMark wins.
      const aChanges = alice.addMark(bMark);
      assert.deepStrictEqual(aChanges, [
        {
          start: { pos: poss[1], before: true },
          end: { pos: poss[3], before: true },
          key: "url",
          value: "www2",
          previousValue: null,
          format: { url: "www2" },
        },
        {
          start: { pos: poss[3], before: true },
          end: { pos: poss[5], before: true },
          key: "url",
          value: "www2",
          previousValue: "www1",
          format: { url: "www2" },
        },
        {
          start: { pos: poss[5], before: true },
          end: { pos: poss[9], before: true },
          key: "url",
          value: "www2",
          previousValue: null,
          format: { url: "www2" },
        },
      ]);
      assert.deepStrictEqual(alice.formattedSpans(), [
        {
          start: Anchors.MIN_ANCHOR,
          end: { pos: poss[1], before: true },
          format: {},
        },
        {
          start: { pos: poss[1], before: true },
          end: { pos: poss[9], before: true },
          format: { url: "www2" },
        },
        {
          start: { pos: poss[9], before: true },
          end: Anchors.MAX_ANCHOR,
          format: {},
        },
      ]);

      const bChanges = bob.addMark(aMark);
      assert.deepStrictEqual(bChanges, []);
      assert.deepStrictEqual(bob.formattedSpans(), alice.formattedSpans());
    });

    test("Lamport timestamp updates", () => {
      const start = { pos: poss[1], before: true };
      const end = { pos: poss[9], before: true };
      const mark: TimestampMark = {
        start,
        end,
        key: "url",
        value: "www1",
        creatorID: alice.replicaID,
        timestamp: 10,
      };
      alice.addMark(mark);
      assert.strictEqual(
        alice.newMark(start, end, "url", "www1").timestamp,
        11
      );
      bob.addMark(mark);
      assert.strictEqual(bob.newMark(start, end, "url", "www1").timestamp, 11);

      const mark2: TimestampMark = {
        start,
        end,
        key: "url",
        value: "www1",
        creatorID: alice.replicaID,
        timestamp: 20,
      };
      alice.addMark(mark2);

      bob.load(alice.save());
      assert.strictEqual(bob.newMark(start, end, "url", "www1").timestamp, 21);
    });
  });
});
