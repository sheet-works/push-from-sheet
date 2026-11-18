'use strict';
// Tests for rowpush.js - works out which sheet rows still need a push, and the words to show.
// Run all test files:  node --test
// Rule: written BEFORE rowpush.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const ROWPUSH = require(process.env.ROWPUSH || './rowpush.js');

const HEAD = ['ID', 'Customer', 'Job Type', 'Address', 'Job Date', 'Price', 'Status', 'Booked By', 'Notified'];
const OLD1 = ['22635dca', 'Sandra Lee', 'Floor Grind', '20 Erina St', '10/29/2026', '450', 'PDF ready', 'a@b.c', 'Old row - not pushed'];
const DONE = ['06450b1e', 'Timing Test 2', 'Wall saw', '5 Mann St', '11/14/2026', '320', 'PDF sent', 'a@b.c', 'Pushed 10:15:02 PM (3 phones)'];
const NEW1 = ['aaa11111', 'Bob Jones', 'Core drilling', '12 Smith St', '17/11/2026', '300', '', 'a@b.c', ''];
const NEW2 = ['bbb22222', 'Kim Tran', 'Wall saw', '9 High St', '18/11/2026', '', '', 'a@b.c'];           // short row: no flag cell at all
const BODY = ['Customer', 'Job Type', 'Address', 'Job Date'];

test('a row with an ID and an empty flag needs a push', () => {
  assert.deepEqual(ROWPUSH.pending(HEAD, [OLD1, DONE, NEW1], 'ID', 'Notified'), [2]);
});

test('a row that already has anything in the flag is left alone', () => {
  assert.deepEqual(ROWPUSH.pending(HEAD, [OLD1, DONE], 'ID', 'Notified'), []);
});

test('a short row with no flag cell still counts as needing a push', () => {
  assert.deepEqual(ROWPUSH.pending(HEAD, [OLD1, NEW2, NEW1], 'ID', 'Notified'), [1, 2]);
});

test('a row with no ID is not a real row yet, so no push', () => {
  const blank = ['', 'Half typed', '', '', '', '', '', '', ''];
  const spaces = ['   ', 'Half typed', '', '', '', '', '', '', ''];
  assert.deepEqual(ROWPUSH.pending(HEAD, [blank, spaces, [], NEW1], 'ID', 'Notified'), [3]);
});

test('a flag of only spaces counts as empty', () => {
  const r = NEW1.slice(); r[8] = '   ';
  assert.deepEqual(ROWPUSH.pending(HEAD, [r], 'ID', 'Notified'), [0]);
});

test('a missing column is refused by name', () => {
  assert.throws(() => ROWPUSH.pending(HEAD, [NEW1], 'ID', 'Pushed'), /No column called "Pushed"/);
  assert.throws(() => ROWPUSH.pending(HEAD, [NEW1], 'Job ID', 'Notified'), /No column called "Job ID"/);
  assert.throws(() => ROWPUSH.words(HEAD, [NEW1], [0], 'New job', ['Customer', 'Suburb']), /No column called "Suburb"/);
});

test('one new row: the words are that row, blanks skipped', () => {
  assert.deepEqual(ROWPUSH.words(HEAD, [OLD1, NEW1], [1], 'New job', BODY),
    { title: 'New job', body: 'Bob Jones, Core drilling, 12 Smith St, 17/11/2026' });
  const noAddress = NEW1.slice(); noAddress[3] = '  ';
  assert.equal(ROWPUSH.words(HEAD, [noAddress], [0], 'New job', BODY).body, 'Bob Jones, Core drilling, 17/11/2026');
});

test('several new rows: one notification, newest row, and it says how many more', () => {
  assert.deepEqual(ROWPUSH.words(HEAD, [NEW1, OLD1, NEW2], [0, 2], 'New job', BODY),
    { title: 'New job (+1 more)', body: 'Kim Tran, Wall saw, 9 High St, 18/11/2026' });
  assert.equal(ROWPUSH.words(HEAD, [NEW1, NEW2, NEW1], [0, 1, 2], 'New job', BODY).title, 'New job (+2 more)');
});

test('a row with nothing to say still gets words', () => {
  const empty = ['ccc33333', '', '', '', '', '', '', '', ''];
  assert.deepEqual(ROWPUSH.words(HEAD, [empty], [0], 'New job', BODY), { title: 'New job', body: 'Open the app to see it' });
});

test('very long words are cut to 180 characters', () => {
  const long = NEW1.slice(); long[3] = 'x'.repeat(400);
  const body = ROWPUSH.words(HEAD, [long], [0], 'New job', BODY).body;
  assert.equal(body.length, 180);
  assert.equal(body.slice(-3), '...');
  assert.equal(body.slice(0, 26), 'Bob Jones, Core drilling, ');
});

test('words with nothing pending is a mistake by the caller', () => {
  assert.throws(() => ROWPUSH.words(HEAD, [NEW1], [], 'New job', BODY), /Nothing to push/);
});

test('the note written back in the row says when and how many phones', () => {
  assert.equal(ROWPUSH.flagText(3, '10:15:02 PM'), 'Pushed 10:15:02 PM (3 phones)');
  assert.equal(ROWPUSH.flagText(1, '10:15:02 PM'), 'Pushed 10:15:02 PM (1 phone)');
  assert.equal(ROWPUSH.flagText(0, '10:15:02 PM'), 'No phones signed up 10:15:02 PM');
});

test('version 1 has no nudge, so there is no nudge note', () => {
  assert.equal(ROWPUSH.nudgeText, undefined);
});

test('the note for rows that were already there is never empty', () => {
  assert.equal(ROWPUSH.OLD, 'Old row - not pushed');
  assert.deepEqual(ROWPUSH.pending(HEAD, [[NEW1[0], '', '', '', '', '', '', '', ROWPUSH.OLD]], 'ID', 'Notified'), []);
});

test('the note written before sending is never empty, so a failed send cannot be sent again and again', () => {
  assert.equal(ROWPUSH.SENDING, 'Sending...');
  assert.deepEqual(ROWPUSH.pending(HEAD, [[NEW1[0], '', '', '', '', '', '', '', ROWPUSH.SENDING]], 'ID', 'Notified'), []);
});

test('no number literals with n on the end (Apps Script will not save them)', () => {
  const src = require('fs').readFileSync(process.env.ROWPUSH || require('path').join(__dirname, 'rowpush.js'), 'utf8');
  assert.equal(/\b\d+n\b/.test(src), false);
});
