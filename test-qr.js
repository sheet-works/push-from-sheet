// test-qr.js - qr.js is our own QR code maker (the pick 18 Nov: our own code, no outside service).
// Checked against an outside library's answers saved in qr-fixtures.json (see make-qr-fixtures.js).
// Run:  node --test test-qr.js
const test = require('node:test');
const assert = require('node:assert');
const QR = require('./qr.js');
const FIX = require('./qr-fixtures.json');
const rowsOf = (grid) => grid.map((r) => r.join(''));

test('every fixture: same size and the same squares as the outside library, for all 8 masks', () => {
  assert.strictEqual(FIX.cases.length, 64);
  assert.deepStrictEqual([...new Set(FIX.cases.map((c) => c.version))], [1, 2, 3, 4, 5, 6], 'every size we make is covered');
  FIX.cases.forEach(function (c) {
    const grid = QR.matrix(c.text, c.mask);
    assert.strictEqual(grid.length, 17 + 4 * c.version, 'size for ' + JSON.stringify(c.text));
    assert.deepStrictEqual(rowsOf(grid), c.rows, JSON.stringify(c.text) + ' mask ' + c.mask);
  });
});

test('left to itself it picks the mask with the lowest penalty score, and that is one of the 8 right answers', () => {
  const texts = [...new Set(FIX.cases.map((c) => c.text))];
  texts.forEach(function (text) {
    const picked = rowsOf(QR.matrix(text));
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => QR.penalty(QR.matrix(text, m)));
    const best = scores.indexOf(Math.min.apply(null, scores));
    assert.deepStrictEqual(picked, FIX.cases.find((c) => c.text === text && c.mask === best).rows, JSON.stringify(text));
  });
});

test('penalty: the four rules, each on a grid small enough to count by hand', () => {
  const grid = (rows) => rows.map((r) => r.split('').map(Number));
  // Rule 4 only: a perfect chequerboard has no runs, no blocks, no finder look-alikes, and is half dark (even size).
  assert.strictEqual(QR.penalty(grid(['1010', '0101', '1010', '0101'])), 0);
  // Rule 1: one row of 6 the same = 3 + 1. Rows 2-4 alternate so nothing else scores... except the dark share.
  // 6x4 grid, row 1 all dark (6), the other rows alternate (3 dark each): 15 of 24 dark = 62.5% -> 2 steps of 5% from 50 -> 20.
  // Columns: no run of 5 (only 4 rows). Blocks: none (rows 2-4 alternate, and row 1 over row 2 never matches twice running).
  assert.strictEqual(QR.penalty(grid(['111111', '010101', '101010', '010101'])), 4 + 20);
  // Rule 1 again, a run of exactly 5 (the shortest that counts) = 3. 5x4 grid: 12 of 20 dark = 60% -> 1 step -> 10.
  assert.strictEqual(QR.penalty(grid(['11111', '01010', '10101', '01010'])), 3 + 10);
  // Rule 2: a 2x2 block of dark in a chequerboard corner: changing (0,1) and (1,0)... simpler: all-light 2x2 = one block, 0% dark.
  // 2x2 all light: 1 block (3). No runs of 5. Dark share 0%: that is in the 9th 5% step away from 50% -> 90.
  assert.strictEqual(QR.penalty(grid(['00', '00'])), 3 + 90);
  // Rule 3: dark-light-dark-dark-dark-light-dark with four light after it, in one row of 11: 40.
  // That row alone: runs: the 4 light at the end is under 5, so rule 1 = 0. One row only: no blocks. 5 dark of 11 = 45.45% -> 0 steps.
  assert.strictEqual(QR.penalty(grid(['10111010000'])), 40);
  assert.strictEqual(QR.penalty(grid(['00001011101'])), 40);
  assert.strictEqual(QR.penalty(grid(['10111010001'])), 0, 'only three light after it: not a look-alike');
});

test('too long for the sizes we make (more than 106 bytes) is refused in plain words', () => {
  assert.throws(() => QR.matrix('x'.repeat(107)), /too long/);
  assert.strictEqual(QR.matrix('x'.repeat(106)).length, 41);
});

test('an empty text is refused', () => {
  assert.throws(() => QR.matrix(''), /nothing/);
});
