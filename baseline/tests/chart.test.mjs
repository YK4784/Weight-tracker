import assert from "node:assert/strict";
import test from "node:test";
import { separateLabel, yDomain } from "../dist/chart.mjs";

const points = [{ average: 70, weight: 70.5 }, { average: 69.8, weight: null }, { average: 69.6, weight: 69.2 }];

test("the y-axis range takes in the goal so its line stays on screen", () => {
  const plain = yDomain(points);
  assert.ok(plain.bottom > 65 && plain.top < 75);
  const below = yDomain(points, 65);
  assert.ok(below.bottom < 65 && below.top > 70.5);
  const above = yDomain(points, 75);
  assert.ok(above.bottom < 69.2 && above.top > 75);
  assert.deepEqual(yDomain(points, 70), plain, "a goal inside the data's range changes nothing");
  assert.deepEqual(yDomain(points, null), plain);
});

test("the goal label keeps clear of the average's label", () => {
  assert.equal(separateLabel(100, 140, 17, 0, 300), 100, "already clear");
  assert.equal(separateLabel(130, 140, 17, 0, 300), 123, "stays above");
  assert.equal(separateLabel(145, 140, 17, 0, 300), 157, "stays below");
  assert.equal(separateLabel(140, 140, 17, 0, 300), 157, "level goes below");
  assert.equal(separateLabel(292, 290, 17, 0, 300), 273, "no room below");
  assert.equal(separateLabel(8, 10, 17, 0, 300), 27, "no room above");
});
