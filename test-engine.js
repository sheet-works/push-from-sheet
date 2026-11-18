'use strict';
// Tests for engine.js - decides, for each new row in the owner's tab, what the notification says and which phones get it.
// SPEC_V1.md: a new row with a title and a blank Notified is sent. Push To blank = every let-in phone;
// Push To with names or emails = only those phones. The link column (e.g. the AppSheet record) is what a tap opens.
// Run: node --test test-engine.js   (always name the test files)
// Rule: written BEFORE engine.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const ENGINE = require(process.env.ENGINE || './engine.js');

const HEAD = ['ID', 'Job', 'Customer', 'Address', 'Push To', 'Link', 'Notified'];
const S = { title: 'Job', message: ['Customer', 'Address'], pushTo: 'Push To', link: 'Link', notified: 'Notified' };
const PAGE = 'https://owner-push.web.app/';
const PHONES = [
  { id: 'a'.repeat(32), name: 'Dave', email: 'dave@example.com' },
  { id: 'b'.repeat(32), name: 'Kim Tran', email: '' },
  { id: 'c'.repeat(32), name: '', email: 'Lee@Example.com' }
];
const ALL = PHONES.map(p => p.id);
const row = (o) => HEAD.map(h => (o[h] === undefined ? '' : o[h]));
const plan = (rows, s, phones) => ENGINE.plan(HEAD, rows, s || S, phones || PHONES, PAGE);

test('a new row (title filled, Notified blank) is planned with its words, every phone, and the page as the tap address', () => {
  const p = plan([row({ ID: '1', Job: 'New job', Customer: 'Bob Jones', Address: '12 Smith St' })]);
  assert.deepEqual(p, [{ row: 0, title: 'New job', body: 'Bob Jones, 12 Smith St', navigate: PAGE, phoneIds: ALL, unknown: [] }]);
});

test('a row with something in Notified is never planned again', () => {
  assert.deepEqual(plan([row({ Job: 'New job', Notified: 'Sent 9:00 PM to 3 devices' })]), []);
  assert.deepEqual(plan([row({ Job: 'New job', Notified: '   x ' })]), []);
});

test('a row with no title is not ready yet, so it waits (AppSheet may still be filling it)', () => {
  assert.deepEqual(plan([row({ Customer: 'Bob' }), row({ Job: '   ' })]), []);
});

test('a Notified of only spaces counts as blank', () => {
  assert.equal(plan([row({ Job: 'New job', Notified: '   ' })]).length, 1);
});

test('every new row is planned on its own, oldest first, with its own position', () => {
  const p = plan([row({ Job: 'A', Notified: 'done' }), row({ Job: 'B' }), row({ Job: 'C' })]);
  assert.deepEqual(p.map(x => [x.row, x.title]), [[1, 'B'], [2, 'C']]);
});

test('blank message cells are skipped; a row with no message words says so plainly', () => {
  assert.equal(plan([row({ Job: 'J', Address: '12 Smith St' })])[0].body, '12 Smith St');
  assert.equal(plan([row({ Job: 'J' })])[0].body, '');
});

test('the message may be a single column name', () => {
  assert.equal(plan([row({ Job: 'J', Customer: 'Bob', Address: 'x' })], Object.assign({}, S, { message: 'Customer' }))[0].body, 'Bob');
});

test('long words are cut, never refused: title to 100 characters, message to 500, ending in ...', () => {
  const p = plan([row({ Job: 'T'.repeat(150), Customer: 'C'.repeat(600) })])[0];
  assert.equal(p.title.length, 100);
  assert.ok(p.title.endsWith('...'));
  assert.equal(p.body.length, 500);
  assert.ok(p.body.endsWith('...'));
  const exact = plan([row({ Job: 'T'.repeat(100), Customer: 'C'.repeat(500) })])[0];
  assert.equal(exact.title, 'T'.repeat(100));
  assert.equal(exact.body, 'C'.repeat(500));
});

test('Push To with a name sends only to that phone; names and emails match without caring about capitals or spaces', () => {
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'dave' })])[0].phoneIds, [PHONES[0].id]);
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': '  KIM TRAN ' })])[0].phoneIds, [PHONES[1].id]);
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'lee@example.com' })])[0].phoneIds, [PHONES[2].id]);
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'DAVE@example.COM' })])[0].phoneIds, [PHONES[0].id]);
});

test('Push To can list several people, split by commas, semicolons or new lines; each phone only once', () => {
  const p = plan([row({ Job: 'J', 'Push To': 'Dave, lee@example.com;Kim Tran\ndave@example.com' })])[0];
  assert.deepEqual(p.phoneIds, ALL);
  assert.deepEqual(p.unknown, []);
});

test('a name in Push To that matches no phone is reported (so the Notified note can say so), the rest still go', () => {
  const p = plan([row({ Job: 'J', 'Push To': 'Dave, Bob, bob@x.com' })])[0];
  assert.deepEqual(p.phoneIds, [PHONES[0].id]);
  assert.deepEqual(p.unknown, ['Bob', 'bob@x.com']);
});

test('names typed on the Phones tab with stray spaces or capitals still match', () => {
  const phones = [{ id: 'f'.repeat(32), name: '  DAVE ', email: ' Dave@Example.com ' }];
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'dave' })], S, phones)[0].phoneIds, ['f'.repeat(32)]);
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'dave@example.com' })], S, phones)[0].phoneIds, ['f'.repeat(32)]);
});

test('one person with two phones (same name) gets both', () => {
  const phones = PHONES.concat([{ id: 'd'.repeat(32), name: 'Dave', email: '' }]);
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'Dave' })], S, phones)[0].phoneIds, [PHONES[0].id, 'd'.repeat(32)]);
});

test('a phone with no name and no email can only be reached by a blank Push To', () => {
  const phones = [{ id: 'e'.repeat(32), name: '', email: '' }];
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': ',' })], S, phones)[0].phoneIds, ['e'.repeat(32)], 'only separators = blank');
  assert.deepEqual(plan([row({ Job: 'J', 'Push To': 'x' })], S, phones)[0].phoneIds, []);
});

test('no phones at all still plans the row (the note will say no phones)', () => {
  assert.deepEqual(plan([row({ Job: 'J' })], S, [])[0].phoneIds, []);
});

test('the tap address comes from the link column only when it is https; anything else opens the page', () => {
  assert.equal(plan([row({ Job: 'J', Link: 'https://www.appsheet.com/start/abc#row=7' })])[0].navigate, 'https://www.appsheet.com/start/abc#row=7');
  for (const bad of ['http://x.com', 'javascript:alert(1)', 'www.x.com', ' ', 'HTTPS://X.COM']) {
    assert.equal(plan([row({ Job: 'J', Link: bad })])[0].navigate, PAGE, bad);
  }
  assert.equal(plan([row({ Job: 'J', Link: '  https://a.com/x  ' })], Object.assign({}, S, { links: 'any' }))[0].navigate, 'https://a.com/x', 'spaces around it are trimmed');
});

test('Push To and link are optional settings', () => {
  const s = { title: 'Job', message: ['Customer'], notified: 'Notified' };
  const p = plan([row({ Job: 'J', 'Push To': 'Dave', Link: 'https://a.com/' })], s)[0];
  assert.deepEqual(p.phoneIds, ALL);
  assert.equal(p.navigate, PAGE);
});

test('a column named in the settings but missing from the tab is refused by name', () => {
  assert.throws(() => plan([row({ Job: 'J' })], Object.assign({}, S, { title: 'Jobb' })), /Jobb/);
  assert.throws(() => plan([row({ Job: 'J' })], Object.assign({}, S, { message: ['Customer', 'Suburb'] })), /Suburb/);
  assert.throws(() => plan([row({ Job: 'J' })], Object.assign({}, S, { pushTo: 'Send To' })), /Send To/);
  assert.throws(() => plan([row({ Job: 'J' })], Object.assign({}, S, { notified: 'Done' })), /Done/);
});

test('header names match after trimming spaces', () => {
  const head = HEAD.map(h => ' ' + h + ' ');
  const p = ENGINE.plan(head, [row({ Job: 'J', Customer: 'Bob' })], S, PHONES, PAGE);
  assert.equal(p[0].body, 'Bob');
});

test('short rows (fewer cells than the header) and numbers in cells are fine', () => {
  const p = ENGINE.plan(HEAD, [['1', 'J', 42]], S, PHONES, PAGE);
  assert.equal(p[0].body, '42');
});

// ---- the note written back into Notified ----
test('the note says when and how many phones took it', () => {
  assert.equal(ENGINE.note({ sent: 3, failed: 0, unknown: [] }, '9:15 PM'), 'Sent 9:15 PM to 3 devices');
  assert.equal(ENGINE.note({ sent: 1, failed: 0, unknown: [] }, '9:15 PM'), 'Sent 9:15 PM to 1 device');
});

test('the note says when nobody could be sent to, and is never empty', () => {
  assert.equal(ENGINE.note({ sent: 0, failed: 0, unknown: [] }, '9:15 PM'), 'Not sent 9:15 PM - no devices to send to');
});

test('the note owns up to failures and to names that matched no phone', () => {
  assert.equal(ENGINE.note({ sent: 2, failed: 1, unknown: [] }, '9:15 PM'), 'Sent 9:15 PM to 2 devices, 1 failed');
  assert.equal(ENGINE.note({ sent: 1, failed: 0, unknown: ['Bob', 'Sam'] }, '9:15 PM'), 'Sent 9:15 PM to 1 device - no device for Bob, Sam');
  assert.equal(ENGINE.note({ sent: 0, failed: 0, unknown: ['Bob'] }, '9:15 PM'), 'Not sent 9:15 PM - no device for Bob');
  assert.equal(ENGINE.note({ sent: 0, failed: 2, unknown: [] }, '9:15 PM'), 'Not sent 9:15 PM - 2 failed');
  assert.equal(ENGINE.note({ sent: 0, failed: 1, unknown: ['Bob'] }, '9:15 PM'), 'Not sent 9:15 PM - 1 failed - no device for Bob');
});

test('the note written before sending is never empty, so a failed run is never sent again and again', () => {
  assert.equal(ENGINE.SENDING, 'Sending...');
  assert.equal(ENGINE.OLD, 'Old row - not sent');
});

test('no big-number literals in engine.js (Apps Script refuses to save them)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.ENGINE || './engine.js'), 'utf8');
  assert.deepEqual(src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [], []);
});

// ---- ruling 17 Nov 11:05pm: more than 10 new rows in one run (an import) = none sent, each marked ----
const manyRows = (n) => Array.from({ length: n }, (_, i) => row({ Job: 'J' + i }));

test('up to 10 new rows in one run are all sent', () => {
  const b = ENGINE.batch(plan(manyRows(10)));
  assert.equal(b.send.length, 10);
  assert.deepEqual(b.skip, []);
});

test('11 or more new rows in one run: none are sent, every one is marked so the owner can see why', () => {
  const b = ENGINE.batch(plan(manyRows(11)));
  assert.deepEqual(b.send, []);
  assert.deepEqual(b.skip, Array.from({ length: 11 }, (_, i) => i));
  assert.equal(ENGINE.TOO_MANY, 'Not sent - too many new rows at once');
  assert.equal(ENGINE.MAX_AT_ONCE, 10);
});

test('nothing new = nothing to send or skip', () => {
  assert.deepEqual(ENGINE.batch([]), { send: [], skip: [] });
});

// ---- the 10-minute backup check (go-ahead, 18 Nov 11:34am): missed rows are caught, stuck rows get ONE second try ----
const STUCK = [row({ Job: 'New job', Customer: 'Bob', Notified: 'Sending...' })];
const backup = (rows) => ENGINE.plan(HEAD, rows, S, PHONES, PAGE, true);

test('a row stuck on Sending... is left alone by a normal run (its run may still be going)', () => {
  assert.deepEqual(plan(STUCK), []);
  assert.deepEqual(ENGINE.plan(HEAD, STUCK, S, PHONES, PAGE, false), []);
});

test('the backup check plans a stuck row again and marks the plan as a second try', () => {
  assert.deepEqual(backup(STUCK), [{ row: 0, title: 'New job', body: 'Bob', navigate: PAGE, phoneIds: ALL, unknown: [], retry: true }]);
  assert.equal(backup([row({ Job: 'New job', Notified: '  Sending...  ' })]).length, 1);
});

test('the backup check plans ordinary new rows too, with no second-try mark', () => {
  const p = backup([row({ Job: 'Missed', Customer: 'Kim' }), row({ Job: 'New job', Notified: 'Sending...' })]);
  assert.deepEqual(p.map(x => [x.row, x.retry]), [[0, undefined], [1, true]]);
  assert.equal('retry' in p[0], false);
});

test('only the exact Sending... mark is tried again: finished rows and second tries never are', () => {
  ['Sent 9:00 PM to 3 devices', 'Sending again...', 'Old row - not sent', 'Not sent - too many new rows at once', 'Failed twice - may not have been sent', 'Sending', 'sending...']
    .forEach(n => assert.deepEqual(backup([row({ Job: 'New job', Notified: n })]), [], n));
});

test('a stuck row whose title has been cleared is not sent', () => {
  assert.deepEqual(backup([row({ Customer: 'Bob', Notified: 'Sending...' })]), []);
});

test('rows stuck on their second try are listed, so they can be marked as failed twice', () => {
  const rows = [row({ Job: 'A' }), row({ Job: 'B', Notified: 'Sending again...' }), row({ Job: 'C', Notified: 'Sending...' }), row({ Job: 'D', Notified: ' Sending again... ' })];
  assert.deepEqual(ENGINE.failedTwice(HEAD, rows, S), [1, 3]);
  assert.deepEqual(ENGINE.failedTwice(HEAD, [], S), []);
  assert.equal(ENGINE.AGAIN, 'Sending again...');
  assert.equal(ENGINE.GAVE_UP, 'Failed twice - may not have been sent');
  assert.throws(() => ENGINE.failedTwice(HEAD, rows, { notified: 'Nope' }), /No column called "Nope"/);
});

test('stuck rows are only tried again once every run that marked rows started 10 or more minutes ago', () => {
  const now = 1794961800000, MIN = 60000;
  assert.equal(ENGINE.STUCK_MINUTES, 10);
  assert.equal(ENGINE.quiet([], now), true);
  assert.equal(ENGINE.quiet([now - 10 * MIN], now), true);
  assert.equal(ENGINE.quiet([now - 10 * MIN + 1], now), false);
  assert.equal(ENGINE.quiet([now - 60 * MIN, now - 1000], now), false);
  assert.equal(ENGINE.quiet([now - 1000, now - 60 * MIN], now), false);
  assert.equal(ENGINE.quiet([String(now - 1000)], now), false, 'times read back from storage are text');
  assert.equal(ENGINE.quiet([String(now - 11 * MIN)], now), true);
  assert.equal(ENGINE.quiet(['rubbish', undefined], now), true, 'a broken record must not block second tries for ever');
});

test('second tries are always sent and do not count toward the 10-row limit', () => {
  const again = (i) => ({ row: i, title: 'R' + i, body: '', navigate: PAGE, phoneIds: ALL, unknown: [], retry: true });
  const fresh = (i) => ({ row: i, title: 'N' + i, body: '', navigate: PAGE, phoneIds: ALL, unknown: [] });
  const ten = Array.from({ length: 10 }, (_, i) => again(i));
  let b = ENGINE.batch(ten.concat(Array.from({ length: 10 }, (_, i) => fresh(10 + i))));
  assert.equal(b.send.length, 20);
  assert.deepEqual(b.skip, []);
  b = ENGINE.batch([fresh(0), again(1)].concat(Array.from({ length: 10 }, (_, i) => fresh(2 + i))));
  assert.deepEqual(b.send.map(p => p.row), [1]);
  assert.deepEqual(b.skip, [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('the note owns up to a second try, because the phone may have buzzed twice', () => {
  assert.equal(ENGINE.note({ sent: 2, failed: 0, unknown: [], retry: true }, '9:15 PM'), 'Sent 9:15 PM to 2 devices (second try)');
  assert.equal(ENGINE.note({ sent: 1, failed: 1, unknown: ['Bob'], retry: true }, '9:15 PM'), 'Sent 9:15 PM to 1 device, 1 failed - no device for Bob (second try)');
  assert.equal(ENGINE.note({ sent: 0, failed: 0, unknown: [], retry: true }, '9:15 PM'), 'Not sent 9:15 PM - no devices to send to (second try)');
  assert.equal(ENGINE.note({ sent: 2, failed: 0, unknown: [], retry: false }, '9:15 PM'), 'Sent 9:15 PM to 2 devices');
});

// ---- 18 Nov (go-ahead): what a tap may open. Default: AppSheet and Google links only (record links, Maps, Drive);
// 'any' = any https site. A link that is not allowed is skipped - the tap opens the app - and the Notified note says why. ----
test('links: AppSheet and Google addresses are kept by default; other sites and non-https are skipped with a reason', () => {
  const one = (link, links) => plan([row({ Job: 'J', Link: link })], Object.assign({}, S, { links: links }))[0];
  ['https://www.appsheet.com/start/abc#control=Jobs_Detail&row=7', 'https://appsheet.com/x', 'https://www.google.com/maps/dir/?api=1&destination=12+Smith+St',
   'https://maps.app.goo.gl/AbC', 'https://drive.google.com/file/d/xyz/view', 'https://docs.google.com/document/d/1'].forEach((l) => {
    const p = one(l);
    assert.equal(p.navigate, l, l);
    assert.equal(p.linkSkipped, undefined, l);
  });
  ['https://evil.example.com/login', 'https://google.com.evil.example/x', 'https://notappsheet.com/', 'https://appsheet.com.attacker.io/'].forEach((l) => {
    const p = one(l);
    assert.equal(p.navigate, PAGE, l);
    assert.equal(p.linkSkipped, 'only AppSheet and Google links', l);
  });
  assert.equal(one('https://evil.example.com/login', 'any').navigate, 'https://evil.example.com/login', 'Any website lets it through');
  for (const l of ['http://www.appsheet.com/x', 'www.google.com', 'tel:0400000000', 'javascript:alert(1)']) {
    const p = one(l, 'any');
    assert.equal(p.navigate, PAGE, l);
    assert.equal(p.linkSkipped, 'links must start with https://', l);
  }
  const blank = one('');
  assert.equal(blank.navigate, PAGE);
  assert.equal(blank.linkSkipped, undefined, 'no link = nothing to say');
});

test('the Notified note says when a link was skipped', () => {
  assert.equal(ENGINE.note({ sent: 2, failed: 0, unknown: [], linkSkipped: 'only AppSheet and Google links' }, '9:15 PM'),
    'Sent 9:15 PM to 2 devices - link skipped (only AppSheet and Google links)');
  assert.equal(ENGINE.note({ sent: 1, failed: 0, unknown: [] }, '9:15 PM'), 'Sent 9:15 PM to 1 device');
});

// ---- 18 Nov evening, the cold test: a row typed by hand was sent as soon as Title was filled ("test55" with no details).
// His ruling (A): mark it Sending soon..., and send once the row has sat unchanged for the wait.
const W_HEADER = ['Title', 'Details', 'Address', 'Push To', 'Notified'];
const W_SET = { title: 'Title', message: ['Details', 'Address'], pushTo: 'Push To', notified: 'Notified' };

test('wait: pending() lists the rows waiting to go (a title, and Notified blank or Sending soon...), each with its words', () => {
  const rows = [['Old', 'x', 'y', '', 'Sent 1:00 PM to 1 device'], ['New', 'd', '', '', ''], ['', 'no title', '', '', ''], ['Half', '', '', '', ENGINE.SOON], ['Stuck', '', '', '', ENGINE.SENDING]];
  const p = ENGINE.pending(W_HEADER, rows, W_SET);
  assert.deepEqual(Object.keys(p), ['1', '3']);
  assert.notEqual(p[1], p[3]);
});

test('wait: settled() gives only the rows that are still waiting and have not changed at all since the first look', () => {
  const before = ENGINE.pending(W_HEADER, [['Job A', '', '', '', ''], ['Job B', 'd', 'a', '', ''], ['Job C', '', '', '', '']], W_SET);
  const later = [['Job A', 'now with details', '', '', ENGINE.SOON], ['Job B', 'd', 'a', '', ENGINE.SOON], ['Job C', '', '', '', 'Sent 2:00 PM to 1 device']];
  assert.deepEqual(ENGINE.settled(before, ENGINE.pending(W_HEADER, later, W_SET)), [1], 'A changed, C was sent by someone else');
  // a row inserted above moves everything down: nothing matches, so nothing is sent on a guess
  const moved = [['Inserted', '', '', '', '']].concat(later);
  assert.deepEqual(ENGINE.settled(before, ENGINE.pending(W_HEADER, moved, W_SET)), []);
  // the Notified note going from blank to Sending soon... is the script's own doing and is not a change
  assert.deepEqual(ENGINE.settled(ENGINE.pending(W_HEADER, [['Job A', '', '', '', '']], W_SET), ENGINE.pending(W_HEADER, [['Job A', '', '', '', ENGINE.SOON]], W_SET)), [0]);
  // a change in ANY cell of the row counts, even one that is not in the message
  const h2 = W_HEADER.concat(['Extra']);
  assert.deepEqual(ENGINE.settled(ENGINE.pending(h2, [['Job A', '', '', '', '', '']], W_SET), ENGINE.pending(h2, [['Job A', '', '', '', '', 'typed']], W_SET)), []);
});

test('wait: plan() treats Sending soon... as a new row, so a waiting row is sent (and an old row with it is marked at turn-on)', () => {
  const plans = ENGINE.plan(W_HEADER, [['Job A', 'd', '', '', ENGINE.SOON], ['Job B', '', '', '', 'Sent 2:00 PM to 1 device']], W_SET, [{ id: 'a'.repeat(32), name: '', email: '' }], 'https://page/');
  assert.deepEqual(plans.map(p => p.row), [0]);
  assert.equal(ENGINE.SOON, 'Sending soon...');
});

test('wait: ready() keeps second tries and the settled rows, and holds back the rest', () => {
  const plans = [{ row: 0 }, { row: 1 }, { row: 2, retry: true }];
  assert.deepEqual(ENGINE.ready(plans, [1]).map(p => p.row), [1, 2]);
  assert.deepEqual(ENGINE.ready(plans, null).map(p => p.row), [0, 1, 2], 'no wait: everything goes');
});
