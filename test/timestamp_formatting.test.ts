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
    let poss!: Position[];

    beforeEach(() => {
      list = new List();
      const startPos = list.insertAt(0, ..."0123456789")[0];
      poss = Order.startPosToArray(startPos, 10);
      formatting = new TimestampFormatting(list.order, {
        replicaID: BunchIDs.newReplicaID({ rng }),
      });
    });

    function checkGetters() {
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
    }
    test("one mark", () => {
      // Add one mark and check changes & formattedSpans.
      let t = 1;
      for (const start of [
        { pos: Order.MIN_POSITION, before: false },
        { pos: poss[0], before: true },
        { pos: poss[0], before: false },
        { pos: poss[3], before: true },
        { pos: poss[3], before: false },
      ]) {
        for (const end of [
          { pos: Order.MAX_POSITION, before: true },
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
          checkGetters();

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
                { pos: Order.MIN_POSITION, before: false },
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
                  start: { pos: Order.MIN_POSITION, before: false },
                  end: { pos: poss[9], before: before3 },
                  format: { italic: true },
                },
                {
                  start: { pos: poss[9], before: before3 },
                  end: { pos: Order.MAX_POSITION, before: true },
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
              checkGetters();
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
                { pos: Order.MIN_POSITION, before: false },
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
                  start: { pos: Order.MIN_POSITION, before: false },
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
                  end: { pos: Order.MAX_POSITION, before: true },
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
              checkGetters();
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
                  start: { pos: Order.MIN_POSITION, before: false },
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
                  end: { pos: Order.MAX_POSITION, before: true },
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
              checkGetters();
            }
          }
        }
      });

      test("same end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before2 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              { pos: Order.MIN_POSITION, before: false },
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
                start: { pos: Order.MIN_POSITION, before: false },
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
                end: { pos: Order.MAX_POSITION, before: true },
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
            checkGetters();
          }
        }
      });

      // One mark's end is the next's start.
      test("same start/end anchor", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              { pos: Order.MIN_POSITION, before: false },
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
                start: { pos: Order.MIN_POSITION, before: false },
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
                end: { pos: Order.MAX_POSITION, before: true },
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
            checkGetters();
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
                start: { pos: Order.MIN_POSITION, before: false },
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
                end: { pos: Order.MAX_POSITION, before: true },
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
            checkGetters();
          }
        }
      });

      test("same start pos 2", () => {
        for (const before1 of [true, false]) {
          for (const before3 of [true, false]) {
            formatting.clear();
            const mark1 = formatting.newMark(
              // Booleans are flipped relative to "same start pos 2".
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
                start: { pos: Order.MIN_POSITION, before: false },
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
                end: { pos: Order.MAX_POSITION, before: true },
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
            checkGetters();
          }
        }
      });

      test("same end pos 1", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            { pos: Order.MIN_POSITION, before: false },
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
              start: { pos: Order.MIN_POSITION, before: false },
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
              end: { pos: Order.MAX_POSITION, before: true },
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
          checkGetters();
        }
      });

      test("same end pos 2", () => {
        for (const before2 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            { pos: Order.MIN_POSITION, before: false },
            // Booleans are flipped relative to "same start pos 1".
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
              start: { pos: Order.MIN_POSITION, before: false },
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
              end: { pos: Order.MAX_POSITION, before: true },
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
          checkGetters();
        }
      });

      test("same start/end pos 1", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            { pos: Order.MIN_POSITION, before: false },
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
              start: { pos: Order.MIN_POSITION, before: false },
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
              end: { pos: Order.MAX_POSITION, before: true },
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
          checkGetters();
        }
      });

      test("same start/end pos 2", () => {
        for (const before3 of [true, false]) {
          formatting.clear();
          const mark1 = formatting.newMark(
            { pos: Order.MIN_POSITION, before: false },
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
              start: { pos: Order.MIN_POSITION, before: false },
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
              end: { pos: Order.MAX_POSITION, before: true },
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
          checkGetters();
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
                { pos: Order.MIN_POSITION, before: false },
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
                  start: { pos: Order.MIN_POSITION, before: false },
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
                  end: { pos: Order.MAX_POSITION, before: true },
                  format: {},
                },
              ]);
              assert.deepStrictEqual(changes, [
                {
                  start: { pos: Order.MIN_POSITION, before: false },
                  end: { pos: poss[3], before: before2 },
                  key: "url",
                  value: "www1",
                  previousValue: null,
                  format: { url: "www1" },
                },
              ]);
              checkGetters();
            }
          }
        }
      });

      test("add and delete", () => {
        const mark1 = formatting.newMark(
          { pos: Order.MIN_POSITION, before: false },
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
            start: { pos: Order.MIN_POSITION, before: false },
            end: { pos: poss[9], before: false },
            format: { url: "www1" },
          },
          {
            start: { pos: poss[9], before: false },
            end: { pos: Order.MAX_POSITION, before: true },
            format: {},
          },
        ]);
        checkGetters();

        const changes1 = formatting.deleteMark(mark3);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: { pos: Order.MIN_POSITION, before: false },
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
            end: { pos: Order.MAX_POSITION, before: true },
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
        checkGetters();

        const changes2 = formatting.deleteMark(mark1);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: { pos: Order.MIN_POSITION, before: false },
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
            end: { pos: Order.MAX_POSITION, before: true },
            format: {},
          },
        ]);
        assert.deepStrictEqual(changes2, [
          {
            start: { pos: Order.MIN_POSITION, before: false },
            end: { pos: poss[3], before: true },
            key: "url",
            value: null,
            previousValue: "www1",
            format: {},
          },
        ]);
        checkGetters();

        const changes3 = formatting.addMark(mark3);
        assert.deepStrictEqual(formatting.formattedSpans(), [
          {
            start: { pos: Order.MIN_POSITION, before: false },
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
            end: { pos: Order.MAX_POSITION, before: true },
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
        checkGetters();

        // Test redundant add/delete.
        const formatBefore = formatting.formattedSpans();
        assert.deepStrictEqual(formatting.addMark(mark2), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        assert.deepStrictEqual(formatting.addMark(mark3), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        assert.deepStrictEqual(formatting.deleteMark(mark1), []);
        assert.deepStrictEqual(formatting.formattedSpans(), formatBefore);
        checkGetters();
      });
    });
  });
});
