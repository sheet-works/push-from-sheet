'use strict';
// Tests for phonetab.js - keeps the owner's Phones tab and the script's stored phones in step (SPEC_V1, look B).
// The owner types Name, ticks/unticks Let in, and deletes rows. The script fills everything else.
// Columns: Name, Email, Device, Let in, Signed up, Last seen, Last message, Status, ID (ID column hidden).
// Run: node --test test-phonetab.js   (always name the test files)
// Rule: written BEFORE phonetab.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const TAB = require(process.env.PHONETAB || './phonetab.js');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32);
const fmt = (ms) => (ms ? 'T' + ms : '');
const rec = (id, o) => Object.assign({ id: id, approved: true, listed: true, added: 100, lastSeen: 200, lastSend: 300, email: '', device: '', keys: true }, o || {});
// A tab row as the script would read it back (getValues: ticks come back as true/false).
const row = (id, name, letIn, o) => {
  o = o || {};
  return [name || '', o.email || '', o.device || '', letIn, 'x', 'x', 'x', o.status || 'x', id];
};
const sync = (records, rows, max) => TAB.sync(records, rows, max || 5, fmt);

test('the header is the look B one plus the hidden ID column', () => {
  assert.deepEqual(TAB.HEADER, ['Name', 'Email', 'Device', 'Let in', 'Signed up', 'Last seen', 'Last message', 'Status', 'ID']);
});

test('a new sign-up is added at the bottom with its details, unticked and waiting, and marked as listed', () => {
  const r = sync([rec(A, { approved: false, listed: false, email: 'sam@example.com', device: 'iPhone, Home Screen' })], []);
  assert.deepEqual(r.rows, [['AAAA', 'sam@example.com', 'iPhone, Home Screen', false, 'T100', 'T200', 'T300', 'Waiting for your tick', A]]);   // named as its page names it (cold test 2)
  assert.deepEqual(r.changes, [{ id: A, listed: true }]);
});

test('a new sign-up that came in already let in (open sign-ups) is added ticked and On', () => {
  const r = sync([rec(A, { listed: false })], []);
  assert.equal(r.rows[0][3], true);
  assert.equal(r.rows[0][7], 'On');
});

test('the owner\'s name and the existing order are kept; the script refreshes the rest', () => {
  const r = sync([rec(A, { lastSend: 999, email: 'sam@x.com' }), rec(B)], [row(B, 'Kim', true), row(A, 'Sam', true)]);
  assert.deepEqual(r.rows.map(x => [x[8], x[0]]), [[B, 'Kim'], [A, 'Sam']]);
  assert.equal(r.rows[1][6], 'T999');
  assert.equal(r.rows[1][1], 'sam@x.com');
  assert.deepEqual(r.changes, []);
});

test('ticking Let in lets a waiting phone in', () => {
  const r = sync([rec(A, { approved: false })], [row(A, 'Sam', true)]);
  assert.deepEqual(r.changes, [{ id: A, approved: true }]);
  assert.equal(r.rows[0][7], 'On');
});

test('unticking Let in stops a phone; it shows Stopped, not Waiting', () => {
  const r = sync([rec(A)], [row(A, 'Sam', false)]);
  assert.deepEqual(r.changes, [{ id: A, approved: false, stopped: true }]);
  assert.equal(r.rows[0][7], 'Stopped - tick Let in to start it again');
});

test('a stopped phone stays Stopped on later syncs, and ticking it again starts it', () => {
  assert.equal(sync([rec(A, { approved: false, stopped: true })], [row(A, 'Sam', false)]).rows[0][7], 'Stopped - tick Let in to start it again');
  const r = sync([rec(A, { approved: false, stopped: true })], [row(A, 'Sam', true)]);
  assert.deepEqual(r.changes, [{ id: A, approved: true, stopped: false }]);
  assert.equal(r.rows[0][7], 'On');
});

test('ticks read back as text (TRUE / FALSE) work the same as true / false', () => {
  assert.deepEqual(sync([rec(A, { approved: false })], [row(A, 'Sam', 'TRUE')]).changes, [{ id: A, approved: true }]);
  assert.deepEqual(sync([rec(A)], [row(A, 'Sam', 'FALSE')]).changes, [{ id: A, approved: false, stopped: true }]);
  assert.deepEqual(sync([rec(A)], [row(A, 'Sam', '')]).changes, [{ id: A, approved: false, stopped: true }]);
});

test('ticking more phones than allowed: the extra ones stay out, unticked, marked Full', () => {
  const recs = [rec(A), rec(B), rec(C, { approved: false })];
  const r = sync(recs, [row(A, 'a', true), row(B, 'b', true), row(C, 'c', true)], 2);
  assert.deepEqual(r.changes, []);
  assert.equal(r.rows[2][3], false);
  assert.equal(r.rows[2][7], 'Full - untick another device first (most is 2)');
});

test('deleting a phone\'s row removes the phone', () => {
  const r = sync([rec(A), rec(B)], [row(B, 'Kim', true)]);
  assert.deepEqual(r.changes, [{ id: A, remove: true }]);
  assert.deepEqual(r.rows.map(x => x[8]), [B]);
});

test('a phone that has never been on the tab is added, not removed', () => {
  const r = sync([rec(A, { listed: false, approved: false })], [row(B, 'Kim', true)]);
  assert.ok(!r.changes.some(c => c.remove));
  assert.deepEqual(r.rows.map(x => x[8]), [B, A]);
});

test('a row whose phone is gone from the store (its push service said gone) stays, marked Gone, unticked', () => {
  const r = sync([], [row(A, 'Old tablet', true)]);
  assert.deepEqual(r.rows, [['Old tablet', '', '', false, 'x', 'x', 'x', 'Gone (its push service says so) - delete this row', A]]);
  assert.deepEqual(r.changes, []);
});

test('a phone stored without keys (from before version 1) says so', () => {
  const r = sync([rec(A, { keys: false })], [row(A, 'Sam', true)]);
  assert.equal(r.rows[0][7], 'Needs to open the page again');
});

test('rows the owner typed with no ID, and blank rows, are left as they are at the bottom', () => {
  const r = sync([rec(A)], [row(A, 'Sam', true), ['Note to self', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '']]);
  assert.deepEqual(r.rows.map(x => x[0]), ['Sam', 'Note to self']);
});

test('a phone listed twice (a copied row) is only kept once', () => {
  const r = sync([rec(A)], [row(A, 'Sam', true), row(A, 'Sam copy', true)]);
  assert.deepEqual(r.rows.map(x => x[0]), ['Sam']);
});

test('the phones the engine may send to: ticked, On, with the owner\'s name and the email', () => {
  const r = sync([rec(A, { email: 'sam@x.com' }), rec(B, { approved: false }), rec(C, { keys: false })], [row(A, 'Sam', true), row(B, 'Kim', false), row(C, 'Lee', true)]);
  assert.deepEqual(r.phones, [{ id: A, name: 'Sam', email: 'sam@x.com' }]);
});

test('the owner\'s ticks come first in the changes, then new sign-ups and removals', () => {
  const r = sync([rec(A, { approved: false }), rec(B, { listed: false, approved: false }), rec(C)], [row(A, 'Sam', true)]);
  assert.deepEqual(r.changes, [{ id: A, approved: true }, { id: B, listed: true }, { id: C, remove: true }]);
});

test('counts for the tab heading: on, waiting, gone', () => {
  const r = sync([rec(A), rec(B, { approved: false, listed: false })], [row(A, 'Sam', true), row(D, 'Old', true)]);
  assert.deepEqual(r.counts, { on: 1, waiting: 1, gone: 1 });
});

test('names are trimmed; dates go through the formatter (blank when never)', () => {
  const r = sync([rec(A, { lastSend: 0 })], [row(A, '  Sam  ', true)]);
  assert.equal(r.rows[0][0], 'Sam');
  assert.equal(r.rows[0][6], '');
});

test('no big-number literals in phonetab.js (Apps Script refuses to save them)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.PHONETAB || './phonetab.js'), 'utf8');
  assert.deepEqual(src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [], []);
});

// ---- 18 Nov: the tab's frame in look B (mock-up 'B Phones'): band with the title, the counts, a line of help, the header ----
test('the frame: title row, counts row, help row, then the header on row 6; phone rows start on row 7 in column B', () => {
  const f = TAB.frame('Demo App', { on: 3, waiting: 1, gone: 1 });
  assert.equal(f.headerRow, 6);
  assert.equal(f.firstDataRow, 7);
  assert.equal(f.firstCol, 2);
  assert.equal(f.rows.length, 6);
  f.rows.forEach((r, i) => assert.equal(r.length, 10, 'row ' + (i + 1) + ' is columns A to J'));
  assert.equal(f.rows[1][1], 'Demo App  ·  Devices');
  assert.equal(TAB.TAB_NAME, 'Devices');
  assert.deepEqual([f.rows[2][1], f.rows[2][3], f.rows[2][5]], ['3 on', '1 waiting', '1 gone']);
  assert.match(f.rows[4][1], /Tick to let a device in/);
  assert.match(f.rows[4][1], /don't prove who it is/);
  assert.deepEqual(f.rows[5], [''].concat(TAB.HEADER));
  assert.deepEqual(f.rows[0], Array(10).fill(''));
  assert.deepEqual(f.rows[3], Array(10).fill(''));
});

test('the frame with nothing yet: zero counts, still every row', () => {
  const f = TAB.frame('X', { on: 0, waiting: 0, gone: 0 });
  assert.deepEqual([f.rows[2][1], f.rows[2][3], f.rows[2][5]], ['0 on', '0 waiting', '0 gone']);
});

test('the status words the drawing colours: On, Waiting..., Gone... (they must start that way)', () => {
  assert.deepEqual(TAB.STATUS_START, { on: 'On', waiting: 'Waiting', gone: 'Gone' });
  const r = TAB.sync([{ id: 'a'.repeat(32), approved: true, stopped: false, listed: false, added: 1, lastSeen: 1, lastSend: 0, email: '', device: '', keys: true },
    { id: 'b'.repeat(32), approved: false, stopped: false, listed: false, added: 1, lastSeen: 1, lastSend: 0, email: '', device: '', keys: true }], [], 20, () => '');
  const statuses = r.rows.map(x => x[7]);
  assert.ok(statuses.includes('On'));
  assert.ok(statuses.some(s => s.indexOf('Waiting') === 0));
});

test('a new sign-up gets the name its page shows (first 4 of its ID in capitals), so the owner can tell phones apart (cold test 2: page said 5BD4, Name was blank)', () => {
  const id = '5bd4' + 'e'.repeat(28);
  const r = sync([rec(id, { approved: false, listed: false })], []);
  assert.equal(r.rows[0][0], '5BD4');
  assert.equal(TAB.shortName(id), '5BD4');
});

test('a name the owner typed is never replaced by the short name', () => {
  const r = sync([rec(A)], [row(A, 'Sam', true)]);
  assert.equal(r.rows[0][0], 'Sam');
});
