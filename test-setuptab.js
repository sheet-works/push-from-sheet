'use strict';
// Tests for setuptab.js - decides what goes in each cell of the owner's Setup tab (look B, the pick 17 Nov), and the dropdowns.
// 18 Nov: as little typing as possible - anything the script can fill in or offer as a pick, it does.
// Running it again never wipes what the owner already filled in.
// Run: node --test test-setuptab.js   (always name the test files)
// Rule: written BEFORE setuptab.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const SETUPTAB = require(process.env.SETUPTAB || './setuptab.js');
const SETUP = require(process.env.SETUP || './setup.js');

const BOOK = { name: 'Smith Cutting Jobs', tabs: ['Jobs', 'Customers'],
  headers: { Jobs: ['ID', 'Customer', 'Job Type', 'Address', 'Push To', 'Notified', ''], Customers: ['Name', 'Phone'] } };
const build = (book, current, facts) => SETUPTAB.build(book || BOOK, current || [], facts);
const valueOf = (b, label) => { const r = b.rows.find(x => x[1] === label); return r ? r[2] : undefined; };
const rowOf = (b, label) => b.rows.findIndex(x => x[1] === label) + 1;
const dropOf = (b, label) => b.dropdowns.find(d => d.row === rowOf(b, label));

test('a fresh Setup tab has every setting SETUP.read looks for, each once, label in B and value in C', () => {
  const b = build();
  ['Firebase project address', 'App name', 'Colour', 'Tab with your rows',   // 18 Nov evening: no Icon row any more (its Drive link was never built)
    'Title column', 'Message column', 'Push To column',
   'Link to open', 'Sign-ups', 'Backup check'].forEach(label => {
    assert.equal(b.rows.filter(r => r[1] === label).length, 1, label);
  });
  b.rows.forEach((r, i) => assert.equal(r.length, 5, 'row ' + (i + 1) + ' is columns A to E'));
});

test('filled in with no typing, the defaults: app name = the sheet name, plain icon, Approve, backup 10 minutes, the colour', () => {
  const b = build();
  assert.equal(valueOf(b, 'App name'), 'Smith Cutting Jobs');
  assert.equal(valueOf(b, 'Colour'), 'Blue');
  assert.equal(valueOf(b, 'Sign-ups'), 'Approve');
  assert.equal(valueOf(b, 'Backup check'), '10 minutes');
  assert.equal(b.rows[1][1], '=C' + rowOf(b, 'App name'), 'the heading shows the App name cell, so it follows as the owner types (18 Nov)');
});

test('a sheet name longer than an app name may be is cut to 30 characters', () => {
  const b = build(Object.assign({}, BOOK, { name: 'A'.repeat(40) }));
  assert.equal(valueOf(b, 'App name'), 'A'.repeat(30));
});

test('the tab with the rows is picked for the owner when there is only one tab besides Setup and Phones', () => {
  assert.equal(valueOf(build({ name: 'X', tabs: ['Jobs', 'Setup', 'Phones'], headers: { Jobs: ['A'] } }), 'Tab with your rows'), 'Jobs');
  assert.equal(valueOf(build(), 'Tab with your rows'), '', 'two tabs: the owner picks');
});

test('the tab dropdown lists the owner\'s tabs, never Setup or Phones, and must be picked from the list', () => {
  const b = build({ name: 'X', tabs: ['Setup', 'Jobs', 'Phones', 'Quotes'], headers: {} });
  assert.deepEqual(dropOf(b, 'Tab with your rows'), { row: rowOf(b, 'Tab with your rows'), list: ['Jobs', 'Quotes'], strict: true });
});

test('column dropdowns list the chosen tab\'s headers, without blanks and without Notified (the script\'s own)', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs']]);
  const cols = ['ID', 'Customer', 'Job Type', 'Address', 'Push To'];
  assert.deepEqual(dropOf(b, 'Title column'), { row: rowOf(b, 'Title column'), list: cols, strict: true, fromHeader: 'Jobs' });
  assert.deepEqual(dropOf(b, 'Push To column'), { row: rowOf(b, 'Push To column'), list: cols, strict: true, fromHeader: 'Jobs' });
  assert.deepEqual(dropOf(b, 'Link to open'), { row: rowOf(b, 'Link to open'), list: cols, strict: true, fromHeader: 'Jobs' });
});

test('Message column is a strict single pick now (18 Nov evening: more columns go in Message column 2 and 3)', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs']]);
  assert.deepEqual(dropOf(b, 'Message column'), { row: rowOf(b, 'Message column'), list: ['ID', 'Customer', 'Job Type', 'Address', 'Push To'], strict: true, fromHeader: 'Jobs' });
});

test('with no tab chosen yet there are no column dropdowns (nothing to list)', () => {
  const b = build();
  ['Title column', 'Message column', 'Push To column', 'Link to open'].forEach(l => assert.equal(dropOf(b, l), undefined, l));
});

test('Push To column is picked for the owner when the tab has a column called Push To', () => {
  assert.equal(valueOf(build(BOOK, [['', 'Tab with your rows', 'Jobs']]), 'Push To column'), 'Push To');
  assert.equal(valueOf(build(Object.assign({}, BOOK, { headers: { Jobs: ['push to'] } }), [['', 'Tab with your rows', 'Jobs']]), 'Push To column'), 'push to');
  assert.equal(valueOf(build(Object.assign({}, BOOK, { headers: { Jobs: ['ID'] } }), [['', 'Tab with your rows', 'Jobs']]), 'Push To column'), '');
});

test('Sign-ups and Backup check have strict dropdowns with every choice SETUP.read takes', () => {
  const b = build();
  assert.deepEqual(dropOf(b, 'Sign-ups'), { row: rowOf(b, 'Sign-ups'), list: ['Approve', 'Open'], strict: true });
  assert.deepEqual(dropOf(b, 'Backup check'), { row: rowOf(b, 'Backup check'), list: ['Off', '5 minutes', '10 minutes', '15 minutes', '30 minutes'], strict: true });
  dropOf(b, 'Backup check').list.forEach(v => assert.deepEqual(SETUP.read(b.rows.map(r => r[1] === 'Backup check' ? ['', r[1], v] : r)).problems.filter(p => p.indexOf('Backup') >= 0), [], v));
});

test('running it again keeps everything the owner filled in, wherever their rows were', () => {
  const current = [[], ['', 'Old heading'], ['', 'Sign-ups', 'Open'], ['', 'App name', 'Smith Jobs'], ['', 'Firebase project address', 'smith-cutting-push'],
    ['', 'Colour', '#AA0000'], ['', 'Icon', 'https://drive.google.com/file/d/abcdefghijklmnopqrstuvwxyz/view'], ['', 'Tab with your rows', 'Jobs'],
    ['', 'Title column', 'Job Type'], ['', 'Message column', 'Customer, Address'], ['', 'Push To column', ''], ['', 'Link to open', 'ID'], ['', 'Backup check', 'Off']];
  const b = build(BOOK, current);
  assert.equal(valueOf(b, 'Sign-ups'), 'Open');
  assert.equal(valueOf(b, 'App name'), 'Smith Jobs');
  assert.equal(valueOf(b, 'Firebase project address'), 'smith-cutting-push');
  assert.equal(valueOf(b, 'Colour'), '#AA0000');
  assert.equal(valueOf(b, 'Title column'), 'Job Type');
  assert.equal(valueOf(b, 'Message column'), 'Customer'); assert.equal(valueOf(b, 'Message column 2 (optional)'), 'Address');   // the old comma list is spread
  assert.equal(valueOf(b, 'Link to open'), 'ID');
  assert.equal(valueOf(b, 'Backup check'), 'Off');
  assert.equal(valueOf(b, 'Push To column'), 'Push To', 'a blank Push To is filled when the tab has a Push To column (live 12:46: the blank from a first draw with no tab stuck)');
  assert.equal(b.rows[1][1], '=C' + rowOf(b, 'App name'), 'the heading follows the app name (it shows that cell)');
});

test('the old label Firebase project ID is carried into the new name row', () => {
  assert.equal(valueOf(build(BOOK, [['', 'Firebase project ID', 'demo-push-1a2b']]), 'Firebase project address'), 'demo-push-1a2b');
});

test('a fresh tab, once the owner has typed a project name and picked tab, title and message, reads with no problems', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs']]);
  const filled = b.rows.map(r => {
    const v = { 'Firebase project address': 'Smith Cutting Push', 'Title column': 'Job Type', 'Message column': 'Customer, Address' }[r[1]];
    return v === undefined ? r : ['', r[1], v, r[3], r[4]];
  });
  const r = SETUP.read(filled);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.settings, { firebaseProject: 'smith-cutting-push', appName: 'Smith Cutting Jobs', colour: '#1565C0', icon: '', tab: 'Jobs',
    title: 'Job Type', message: ['Customer', 'Address'], pushTo: 'Push To', link: '', notified: 'Notified', signup: 'approve', backupMinutes: 10, appsheetFirst: false, links: 'google', waitSeconds: 30 });
});

// Changed 18 Nov 8:20pm (the cold test): matching the name to the ID can't be relied on - Google adds letters when the
// plain ID is taken - so the row now asks for the page address (see the test at the bottom). A unique name still helps.
test('the Set up steps start as Not yet, and the setting that needs Set up again says so', () => {
  const b = build();
  const names = require('./steps.js').names();
  assert.equal(names.length, 7);
  names.forEach(step => assert.equal(valueOf(b, step), '–  Not yet', step));
  assert.deepEqual(b.kinds.map((k, i) => k === 'step' ? b.rows[i][1] : null).filter(Boolean), names, 'the step rows are the list in steps.js, in its order (one truth)');
  assert.match(b.rows[rowOf(b, 'Backup check') - 1][3], /Set up again/);
});

test('links the owner clicks: Firebase, the script terms, the Apps Script switch', () => {
  const b = build(), at = (l) => ({ row: rowOf(b, l), col: 4, text: b.rows[rowOf(b, l) - 1][3] });
  assert.deepEqual(b.links, [
    Object.assign(at('Firebase project address'), { url: 'https://console.firebase.google.com/' }),
    Object.assign(at('Apps Script terms'), { url: 'https://console.developers.google.com/terms/script' }),
    Object.assign(at('"Google Apps Script API" switch'), { url: 'https://script.google.com/home/usersettings' })
  ]);
});

// ---- piece 2: each row says what kind it is, so the drawing can give it look B's style ----
test('every row has a kind, in look B order: band, title, subtitle, band, status heads, statuses, then sections', () => {
  const b = build();
  assert.equal(b.kinds.length, b.rows.length);
  assert.deepEqual(b.kinds.slice(0, 8), ['band', 'title', 'subtitle', 'band', 'statushead', 'status', 'gap', 'section']);
  const allowed = ['band', 'title', 'subtitle', 'statushead', 'status', 'gap', 'section', 'setting', 'step', 'phonepage', 'note'];
  b.kinds.forEach((k, i) => assert.ok(allowed.includes(k), 'row ' + (i + 1) + ': ' + k));
});

test('kinds match the rows: settings are settings, steps are steps, section titles are sections, notes are notes', () => {
  const b = build(), kindOf = (label) => b.kinds[rowOf(b, label) - 1];
  ['Firebase project address', '"Google Apps Script API" switch', 'App name', 'Tab with your rows', 'Backup check'].forEach(l => assert.equal(kindOf(l), 'setting', l));
  ['Switch on services', 'Page link and QR code'].forEach(l => assert.equal(kindOf(l), 'step', l));
  ['1   Once per Google account', '2   Your settings', 'Good to know'].forEach(l => assert.equal(kindOf(l), 'section', l));
  assert.equal(kindOf('Sign-up page'), 'phonepage');
  assert.equal(b.kinds[b.kinds.length - 1], 'note');
  b.rows.forEach((r, i) => { if (b.kinds[i] === 'gap' || b.kinds[i] === 'band') assert.deepEqual(r, ['', '', '', '', ''], 'row ' + (i + 1)); });
  assert.equal(b.kinds.filter(k => k === 'setting').length, 17, '14 settings + Firebase project, the terms and the switch');
  assert.equal(b.kinds.filter(k => k === 'step').length, 7);
  assert.equal(b.kinds.filter(k => k === 'note').length, 7);   // 18 Nov evening: account warning, Allow help, 5 good-to-know lines
});

test('a blank Push To is filled in on a later draw once a tab with a Push To column is chosen; a column the owner picked is kept', () => {
  const first = build(BOOK, []);
  assert.equal(valueOf(first, 'Push To column'), '');
  const typed = first.rows.map(r => r[1] === 'Tab with your rows' ? ['', r[1], 'Jobs', r[3], r[4]] : r);
  assert.equal(valueOf(build(BOOK, typed), 'Push To column'), 'Push To');
  assert.equal(valueOf(build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Push To column', 'Customer']]), 'Push To column'), 'Customer');
});

test('a setting the owner blanked on purpose stays blank on a redraw (only Push To is ever filled back in)', () => {
  const b = build(BOOK, [['', 'Sign-ups', ''], ['', 'Backup check', ''], ['', 'App name', ''], ['', 'Colour', '']]);
  ['Sign-ups', 'Backup check', 'App name', 'Colour'].forEach(l => assert.equal(valueOf(b, l), '', l));
});

// ---- 18 Nov 12:59pm: notifications for everything - phones AND computers; the list tab is 'Devices' ----
test('the words say phones and computers, never phones alone', () => {
  const b = build();
  assert.equal(b.rows[2][1], 'Push from sheet  ·  free push notifications to phones and computers');
  const words = b.rows.map(r => r.join(' ')).join(' ');
  assert.doesNotMatch(words.replace(/phones and computers/g, '').replace(/iPhone/g, ''), /phone/i);
});

test('neither Devices nor the old Phones tab is ever offered as the tab with the rows', () => {
  const b = build({ name: 'X', tabs: ['Setup', 'Devices', 'Phones', 'Jobs'], headers: {} });
  assert.deepEqual(dropOf(b, 'Tab with your rows').list, ['Jobs']);
  assert.equal(valueOf(b, 'Tab with your rows'), 'Jobs');
});

test('the version shown on the Setup tab is the one in setup.js', () => {
  assert.equal(build().rows[build().rows.length - 1][1], 'Free, as is, MIT licence  ·  github.com/sheet-works/push-from-sheet  ·  version ' + SETUP.VERSION);
});

// ---- 18 Nov: Set up must never draw over a tab called Setup that is not ours (the demo has one from other work) ----
test('a Setup tab is ours only when it says Push from sheet on its subtitle row; an empty or new tab is fine to use', () => {
  assert.equal(SETUPTAB.isOurs(build().rows), true);
  assert.equal(SETUPTAB.isOurs([]), true, 'empty tab');
  assert.equal(SETUPTAB.isOurs([[''], ['']]), true, 'only blank cells');
  assert.equal(SETUPTAB.isOurs([['Key', 'Topic'], ['setup', 'my-topic']]), false, 'the demo\'s own Setup tab');
  assert.equal(SETUPTAB.isOurs([[], ['', 'My App'], ['', 'Something else']]), false);
  assert.equal(SETUPTAB.isOurs([[], ['', 'My App'], ['', 'Push from sheet  ·  anything']]), true);
});

// ---- 18 Nov: the ticks (look B mock-up rows 6 and 24-29): green done, amber needs you, red failed, grey not yet ----
const STEPS = require('./steps.js').names();
const filled = (b) => b.rows.map(r => {
  const v = { 'Firebase project address': 'Smith Cutting Push', 'Title column': 'Job Type', 'Message column': 'Customer, Address' }[r[1]];
  return v === undefined ? r : ['', r[1], v, r[3], r[4]];
});
const tick = (b, row, col) => b.tones.find(t => t.row === row && t.col === col);

test('nothing done yet: every tick grey Not yet, settings amber with how many are missing', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs']]);
  assert.deepEqual(b.rows[5].slice(1), ['!  Needs your project address', '–  Not checked', '!  3 to fill in', '–  Not yet']);
  assert.deepEqual([2, 3, 4, 5].map(c => tick(b, 6, c).tone), ['amber', 'grey', 'amber', 'grey']);
  STEPS.forEach(s => { assert.equal(valueOf(b, s), '–  Not yet'); assert.equal(tick(b, rowOf(b, s), 3).tone, 'grey', s); });
});

test('one thing missing says 1 to fill in; the Firebase tick asks for the name when that is what is missing', () => {
  const b = build(BOOK, filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']])).map(r => r[1] === 'Firebase project address' ? ['', r[1], '', r[3], r[4]] : r));
  assert.equal(b.rows[5][3], '!  1 to fill in');
  assert.equal(b.rows[5][1], '!  Needs your project address');
  assert.equal(tick(b, 6, 2).tone, 'amber');
});

test('all settings filled in: green Filled in', () => {
  const b = build(BOOK, filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']])));
  assert.equal(b.rows[5][3], '✓  Filled in');
  assert.equal(tick(b, 6, 4).tone, 'green');
});

test('the Apps Script switch: on is green, off is amber with what to do, unknown is grey', () => {
  const base = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']]));
  let b = build(BOOK, base, { apiSwitch: true });
  assert.equal(b.rows[5][2], '✓  On'); assert.equal(valueOf(b, '"Google Apps Script API" switch'), '✓  On'); assert.equal(tick(b, 6, 3).tone, 'green');
  b = build(BOOK, base, { apiSwitch: false });
  assert.equal(b.rows[5][2], '!  Switch it on'); assert.equal(valueOf(b, '"Google Apps Script API" switch'), '!  Off'); assert.equal(tick(b, 6, 3).tone, 'amber');
  assert.equal(tick(b, rowOf(b, '"Google Apps Script API" switch'), 3).tone, 'amber');
});

test('steps that worked are green Done; a step that failed is red with Google\'s words beside it in red', () => {
  const base = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']]));
  const b = build(BOOK, base, { apiSwitch: true, steps: { 'Switch on services': { ok: true },
    'Publish as a web app': { error: "Firebase says its terms haven't been accepted. Open Firebase, accept, then run Set up again." } } });
  assert.equal(valueOf(b, 'Switch on services'), '✓  Done');
  assert.equal(tick(b, rowOf(b, 'Switch on services'), 3).tone, 'green');
  assert.equal(valueOf(b, 'Publish as a web app'), '✕  Failed');
  assert.equal(b.rows[rowOf(b, 'Publish as a web app') - 1][3], "Firebase says its terms haven't been accepted. Open Firebase, accept, then run Set up again.");
  assert.equal(tick(b, rowOf(b, 'Publish as a web app'), 3).tone, 'red');
  assert.equal(tick(b, rowOf(b, 'Publish as a web app'), 4).tone, 'red', 'the reason is red too');
  assert.equal(valueOf(b, 'Make the keys'), '–  Not yet');
  assert.equal(b.rows[5][4], '✕  Step 2 failed');
  assert.equal(tick(b, 6, 5).tone, 'red');
  assert.equal(b.rows[5][1], '✓  Done', 'services switched on = the Firebase project works');
  assert.equal(tick(b, 6, 2).tone, 'green');
});

test('Set up part way with no failure says run it again; all seven done is green Done', () => {
  const base = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']]));
  let b = build(BOOK, base, { steps: { 'Switch on services': { ok: true } } });
  assert.equal(b.rows[5][4], '!  Run Set up again'); assert.equal(tick(b, 6, 5).tone, 'amber');
  const all = {}; STEPS.forEach(s => { all[s] = { ok: true }; });
  b = build(BOOK, base, { steps: all });
  assert.equal(b.rows[5][4], '✓  Done'); assert.equal(tick(b, 6, 5).tone, 'green');
});

test('the tick words are never taken from the old tab: a redraw always works them out fresh', () => {
  const stale = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']])).map(r => r[1] === 'Switch on services' ? ['', r[1], '✓  Done', '', ''] : r);
  assert.equal(valueOf(build(BOOK, stale), 'Switch on services'), '–  Not yet');
});

test('tones are only green, amber, red, grey or need (the empty project box), and each points at a real cell', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs']], { apiSwitch: false, steps: { 'Switch on services': { error: 'x' } } });
  b.tones.forEach(t => {
    assert.ok(['green', 'amber', 'red', 'grey', 'need'].includes(t.tone), t.tone);
    assert.ok(t.row >= 1 && t.row <= b.rows.length && t.col >= 2 && t.col <= 5, JSON.stringify(t));
  });
});

test('two failed steps: the heading names the first one', () => {
  const base = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']]));
  const b = build(BOOK, base, { steps: { 'Make the page site': { error: 'a' }, 'Turn on the watcher': { error: 'b' } } });
  assert.equal(b.rows[5][4], '✕  Step 4 failed');
});

test('the Firebase tick: name filled in but nothing run yet is grey Not yet, not Done', () => {
  const b = build(BOOK, filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']])));
  assert.equal(b.rows[5][1], '–  Not yet');
  assert.equal(tick(b, 6, 2).tone, 'grey');
});

// ---- 18 Nov: the sign-up page row ----
test('the sign-up page row: before Set up it says where the address will appear; after, it shows the address as a link', () => {
  const base = filled(build(BOOK, [['', 'Tab with your rows', 'Jobs']]));
  let b = build(BOOK, base);
  assert.equal(valueOf(b, 'Sign-up page'), 'Appears here after Set up');
  assert.equal(b.links.filter(l => l.row === rowOf(b, 'Sign-up page')).length, 0);
  b = build(BOOK, base, { steps: {}, page: 'https://smith-cutting-a1b2c3.web.app/' });
  assert.equal(valueOf(b, 'Sign-up page'), 'https://smith-cutting-a1b2c3.web.app/');
  assert.deepEqual(b.links.filter(l => l.row === rowOf(b, 'Sign-up page')), [{ row: rowOf(b, 'Sign-up page'), col: 3, url: 'https://smith-cutting-a1b2c3.web.app/', text: 'https://smith-cutting-a1b2c3.web.app/' }]);
  assert.equal(b.page.row, rowOf(b, 'Sign-up page'), 'tells the drawing which row the QR picture sits on');
  assert.equal(build(BOOK, base).page, undefined);
});

// ---- 18 Nov, go-ahead (3:55pm): colour names, AppSheet first, links, live heading and colour, stale columns, LIVE, renamed tab ----
test('Colour: Blue by default, a dropdown of the plain colour names, and a code can still be typed', () => {
  const b = build();
  assert.equal(valueOf(b, 'Colour'), 'Blue');
  assert.deepEqual(dropOf(b, 'Colour'), { row: rowOf(b, 'Colour'), list: Object.keys(SETUP.COLOURS), strict: false });
  assert.match(b.rows[rowOf(b, 'Colour') - 1][3], /Pick a colour, or type a code like #1565C0/);
  assert.equal(b.colourRow, rowOf(b, 'Colour'), 'the drawing is told where the colour is, so the colours follow it');
});

test('a Setup tab drawn before the names keeps the owner\'s code', () => {
  assert.equal(valueOf(build(BOOK, [['', 'Colour', '#2E7D32']]), 'Colour'), '#2E7D32');
});

test('Making an AppSheet app? No by default, a Yes/No dropdown, and help that says what Yes does', () => {
  const b = build(), L = SETUP.APPSHEET_LABEL;
  assert.equal(valueOf(b, L), 'No');
  assert.deepEqual(dropOf(b, L), { row: rowOf(b, L), list: ['No', 'Yes'], strict: true });
  assert.match(b.rows[rowOf(b, L) - 1][3], /Yes: your tab is moved first/);
  assert.ok(rowOf(b, L) === rowOf(b, 'Tab with your rows') + 1, 'right under the tab it moves');
});

test('Links can open: the safe choice by default, both choices in a dropdown, help that says when Any website is fine', () => {
  const b = build(), L = SETUP.LINKS_LABEL;
  assert.equal(valueOf(b, L), SETUP.LINKS_GOOGLE);
  assert.deepEqual(dropOf(b, L), { row: rowOf(b, L), list: [SETUP.LINKS_GOOGLE, SETUP.LINKS_ANY], strict: true });
  assert.match(b.rows[rowOf(b, L) - 1][3], /only your own staff/);
  assert.ok(rowOf(b, L) === rowOf(b, 'Link to open') + 1, 'right under Link to open');
});

test('every new setting reads cleanly through SETUP.read straight off a fresh tab', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Firebase project address', 'smith-push'], ['', 'Title column', 'Job Type'], ['', 'Message column', 'Address']]);
  const r = SETUP.read(b.rows.map((row, i) => i === 1 ? ['', 'Smith Cutting Jobs'] : row));
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.colour, '#1565C0');
  assert.equal(r.settings.appsheetFirst, false);
  assert.equal(r.settings.links, 'google');
});

test('a picked column that is no longer a heading on the tab is flagged amber, with what to do', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Old Title'], ['', 'Message column', 'Address, Gone']]);
  const t = rowOf(b, 'Title column'), m = rowOf(b, 'Message column 2 (optional)');   // 18 Nov evening: 'Gone' is spread into the second pick
  assert.equal(valueOf(b, 'Title column'), 'Old Title', 'the owner\'s pick is kept, not wiped');
  assert.equal(b.rows[t - 1][3], '"Old Title" is not a heading on Jobs any more - pick again');
  assert.ok(b.tones.some(x => x.row === t && x.col === 3 && x.tone === 'amber'));
  assert.equal(b.rows[m - 1][3], '"Gone" is not a heading on Jobs any more - pick again');
  const fine = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Job Type']]);
  assert.ok(!fine.tones.some(x => x.row === rowOf(fine, 'Title column') && x.col === 3), 'a good pick is not toned');
});

test('LIVE: shown in the heading only when every Set up step is done', () => {
  const all = {}; require('./steps.js').names().forEach(n => { all[n] = { ok: true }; });
  let b = build(BOOK, [], { steps: all, page: 'https://x.web.app/' });
  assert.equal(b.rows[1][4], '●  LIVE');
  assert.ok(b.tones.some(x => x.row === 2 && x.col === 5 && x.tone === 'live'));
  b = build(BOOK, [], { steps: { 'Switch on services': { ok: true } } });
  assert.equal(b.rows[1][4], '');
  assert.ok(!b.tones.some(x => x.tone === 'live'));
});

test('Good to know says who should be able to add rows', () => {
  const notes = build().rows.filter((r, i, all) => build().kinds[i] === 'note').map(r => r[1]);
  assert.ok(notes.includes('Anyone who can add a row to your tab can send a notification. Only let people you trust add rows.'), JSON.stringify(notes));
});

// The tab is remembered by Google's own ID for it, so renaming it never loses it (18 Nov).
test('followTab: the named tab is found and its ID kept; a renamed tab is found by its ID and the new name given back', () => {
  const tabs = [{ name: 'Setup', id: 1 }, { name: 'Bookings', id: 7 }, { name: 'Devices', id: 2 }];
  assert.deepEqual(SETUPTAB.followTab('Bookings', null, tabs), { name: 'Bookings', id: 7, renamed: false });
  assert.deepEqual(SETUPTAB.followTab('Jobs', 7, tabs), { name: 'Bookings', id: 7, renamed: true });
  assert.deepEqual(SETUPTAB.followTab('Jobs', 9, tabs), { name: 'Jobs', id: null, renamed: false }, 'gone for good: nothing to follow');
  assert.deepEqual(SETUPTAB.followTab('Bookings', 3, tabs), { name: 'Bookings', id: 7, renamed: false }, 'the owner picked another tab: the pick wins');
});

test('tab list: the owner\'s tabs in sheet order, never the script\'s own', () => {
  assert.deepEqual(SETUPTAB.ownerTabs(['Setup', 'Jobs', 'Devices', 'Quotes', 'Phones']), ['Jobs', 'Quotes']);
});

test('a picked column that is gone is also a thing still to fill in, so Set up stops before the steps (18 Nov: it ran on and failed at step 6)', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Old Title'], ['', 'Message column', 'Address']]);
  assert.deepEqual(b.stale, ['Title column: "Old Title" is not a heading on Jobs any more - pick again.']);
  const fine = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Job Type']]);
  assert.deepEqual(fine.stale, []);
});

test('share panel: none before there is a page; after, it sits right of the card in column G with the QR between title and link (18 Nov)', () => {
  assert.equal(build(BOOK, []).share, null);
  const b = build(BOOK, [], { page: 'https://x.web.app/' });
  const s = b.share;
  assert.equal(s.col, 7, 'column G: F is the gap after the card (A-E)');
  const title = s.cells.find(c => c.kind === 'sharetitle'), link = s.cells.find(c => c.kind === 'sharelink');
  assert.equal(title.text, 'Share the sign-up page');
  assert.equal(link.text, 'https://x.web.app/'); assert.equal(link.url, 'https://x.web.app/');
  assert.ok(title.row < s.qr.row && s.qr.row < link.row, 'title, then the QR, then the link');
  assert.equal(s.qr.col, 7);
  assert.ok(s.cells.every(c => c.row >= s.top && c.row <= s.bottom), 'every panel cell is inside the panel box');
  assert.ok(s.cells.some(c => c.kind === 'sharehelp' && /Share the sign-up page/.test(c.text)), 'says where the Share box is in the menu');
});

test('share panel size lives in one place: column wide enough for the link on one line, QR as big as rows 4-9 allow (18 Nov: widen it)', () => {
  const s = build(BOOK, [], { page: 'https://push-from-sheet-967121.web.app/' }).share;
  assert.ok(s.width >= 280, 'a full web.app link fits on one line');
  assert.equal(s.qr.size, 150);
  assert.equal(s.qr.row, 4, 'starts under the help line so it can be bigger');
  assert.ok(s.width >= s.qr.size + 40, 'room round the QR');
});

test('App name suggestion drops "Copy of " and the help line says to change it (18 Nov)', () => {
  assert.equal(valueOf(build({ name: 'Copy of Push from sheet', tabs: ['Jobs'], headers: { Jobs: ['Title'] } }), 'App name'), 'Push from sheet');
  assert.equal(valueOf(build({ name: 'copy of Smith Jobs', tabs: [], headers: {} }), 'App name'), 'Smith Jobs');
  assert.equal(valueOf(build({ name: 'Copy of', tabs: [], headers: {} }), 'App name'), 'Copy of', 'nothing left after: keep the name');
  const b = build();
  assert.match(b.rows[rowOf(b, 'App name') - 1][3], /starts as the sheet's name/i);
  assert.match(b.rows[rowOf(b, 'App name') - 1][3], /your business/i);
});

test('forCopy: a copy of a set-up sheet keeps the owner\'s picks but not the Firebase project, and draws as not set up (18 Nov)', () => {
  const all = {}; require('./steps.js').names().forEach(n => { all[n] = { ok: true }; });
  const live = build(BOOK, [['', 'Firebase project address', 'their-push'], ['', 'App name', 'Smith Push'], ['', 'Tab with your rows', 'Jobs']],
    { apiSwitch: true, steps: all, page: 'https://their-push.web.app/' });
  assert.equal(live.rows[1][4], '●  LIVE');
  const copied = SETUPTAB.forCopy(live.rows);
  const fresh = build(BOOK, copied, {});
  assert.equal(valueOf(fresh, 'Firebase project address'), '', 'the original owner\'s project is not theirs');
  assert.equal(valueOf(fresh, 'App name'), 'Smith Push', 'their other picks stay');
  assert.equal(valueOf(fresh, 'Tab with your rows'), 'Jobs');
  assert.notEqual(fresh.rows[1][4], '●  LIVE');
  assert.equal(fresh.share, null, 'no link or QR');
  assert.ok(!fresh.page);
  assert.ok(!JSON.stringify(fresh.rows).includes('their-push.web.app'));
  assert.deepEqual(SETUPTAB.forCopy(live.rows)[0], live.rows[0], 'other rows untouched');
});

// ---- 18 Nov evening: the cold-test rewrite ("maybe need clearer instructions", no extra steps) ----
const helpOf = (b, label) => b.rows[rowOf(b, label) - 1][3];
const linkOf = (b, label) => b.links.find(k => k.row === rowOf(b, label));

test('section 1 is everything Google wants once, in order: account warning, Firebase project, script terms, the switch', () => {
  const b = build();
  const warn = b.rows.findIndex(r => /more than one Google account/i.test(r[1])) + 1;
  const order = [warn, rowOf(b, 'Firebase project address'), rowOf(b, 'Apps Script terms'), rowOf(b, '"Google Apps Script API" switch')];
  assert.ok(order.every(n => n > 0), 'all four rows are there: ' + order);
  assert.deepEqual(order, order.slice().sort((x, y) => x - y));
  assert.ok(order[3] < rowOf(b, 'App name'), 'all before the settings');
  assert.match(helpOf(b, 'Firebase project address'), /^Open Firebase ›/);
  assert.match(helpOf(b, 'Firebase project address'), /Developer Program, Gemini and Analytics/, 'says which Google extras to leave off');
  assert.match(helpOf(b, 'Apps Script terms'), /^Open the terms ›/);
  assert.match(helpOf(b, 'Apps Script terms'), /click Accept/i);   // cold test 2: a new account gets a button
  assert.equal(linkOf(b, 'Apps Script terms').url, 'https://console.developers.google.com/terms/script');
  assert.equal(valueOf(b, 'Apps Script terms'), 'Open once');
});

test('links open in the sheet owner\'s Google account when the owner is known, and plain when not (the cold test opened them as the wrong account)', () => {
  const plain = build();
  assert.equal(linkOf(plain, 'Firebase project address').url, 'https://console.firebase.google.com/');
  const b = build(Object.assign({ owner: 'smith.cutting@gmail.com' }, BOOK));
  assert.equal(linkOf(b, 'Firebase project address').url, 'https://console.firebase.google.com/?authuser=smith.cutting%40gmail.com');
  assert.equal(linkOf(b, 'Apps Script terms').url, 'https://console.developers.google.com/terms/script?authuser=smith.cutting%40gmail.com');
  assert.equal(linkOf(b, '"Google Apps Script API" switch').url, 'https://script.google.com/home/usersettings?authuser=smith.cutting%40gmail.com');
});

test('Apps Script terms tick: Done once the services step is through; amber with what to do when Google refused over terms', () => {
  let b = build(BOOK, [], { steps: { 'Switch on services': { ok: true } } });
  assert.equal(valueOf(b, 'Apps Script terms'), '✓  Done');
  b = build(BOOK, [], { steps: { 'Switch on services': { error: 'Google needs you to accept its terms once. Open https://console.developers.google.com/terms/script (opening the page is enough), then run Set up again.' } } });
  assert.equal(valueOf(b, 'Apps Script terms'), '!  Open the terms');
  assert.ok(b.tones.some(x => x.row === rowOf(b, 'Apps Script terms') && x.col === 3 && x.tone === 'amber'));
});

test('a failed step\'s reason: any address in it is a real link, in the owner\'s account', () => {
  const why = 'The "Google Apps Script API" switch is off. Open https://script.google.com/home/usersettings and turn it On, wait a minute, then run Set up again.';
  const b = build(Object.assign({ owner: 'a@b.com' }, BOOK), [], { steps: { 'Switch on services': { ok: true }, 'Publish as a web app': { error: why } } });
  const row = rowOf(b, 'Publish as a web app'), k = b.links.find(x => x.row === row && x.col === 4);
  assert.ok(k, 'the reason cell has a link');
  assert.equal(why.slice(k.start, k.end), 'https://script.google.com/home/usersettings');
  assert.equal(k.url, 'https://script.google.com/home/usersettings?authuser=a%40b.com');
  assert.equal(k.text, why);
  const stop = 'Enable it at https://console.developers.google.com/apis/library. Then run Set up again.';
  const b2 = build(BOOK, [], { steps: { 'Switch on services': { error: stop } } }), k2 = b2.links.find(x => x.row === rowOf(b2, 'Switch on services') && x.col === 4);
  assert.equal(stop.slice(k2.start, k2.end), 'https://console.developers.google.com/apis/library', 'the full stop after an address is not part of the link');
  assert.equal(valueOf(b2, 'Apps Script terms'), 'Open once', 'a first-step failure that is not about terms leaves the terms row alone');
  const none = build(BOOK, [], { steps: { 'Switch on services': { error: 'Google said no (500)' } } });
  assert.ok(!none.links.some(x => x.row === rowOf(none, 'Switch on services')), 'no address, no link');
});

test('the message is three single dropdowns; an old comma list is spread across them; no Icon row (its Drive link was never built)', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Message column', 'Customer, Address, Job Type, ID']]);
  assert.equal(valueOf(b, 'Message column'), 'Customer');
  assert.equal(valueOf(b, 'Message column 2 (optional)'), 'Address');
  assert.equal(valueOf(b, 'Message column 3 (optional)'), 'Job Type, ID', 'a fourth is kept, not dropped');
  SETUP.MESSAGE_LABELS.forEach(l => { const d = dropOf(b, l); assert.ok(d && d.fromHeader === 'Jobs' && d.strict === true, l + ' is a strict heading dropdown'); });
  assert.deepEqual(SETUP.read(b.rows).settings.message, ['Customer', 'Address', 'Job Type', 'ID']);
  assert.equal(rowOf(b, 'Icon'), 0);
  const stale = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Job Type'], ['', 'Message column', 'Address'], ['', 'Message column 2 (optional)', 'Gone']]);
  assert.deepEqual(stale.stale, ['Message column 2 (optional): "Gone" is not a heading on Jobs any more - pick again.']);
});

test('Wait before sending: a dropdown that starts from the AppSheet answer and then keeps the owner\'s pick', () => {
  assert.equal(valueOf(build(), 'Wait before sending'), '30 seconds');
  assert.equal(valueOf(build(BOOK, [['', SETUP.APPSHEET_LABEL, 'Yes']]), 'Wait before sending'), 'Off');
  assert.equal(valueOf(build(BOOK, [['', SETUP.APPSHEET_LABEL, 'Yes'], ['', 'Wait before sending', '1 minute']]), 'Wait before sending'), '1 minute');
  const d = dropOf(build(), 'Wait before sending');
  assert.deepEqual(d.list, SETUP.WAIT_CHOICES); assert.equal(d.strict, true);
});

test('the words a stranger needs are on the tab: the Allow warning, Select all, what a link does', () => {
  const b = build(), all = b.rows.map(r => r.join(' ')).join('\n');
  assert.match(all, /hasn't verified this app/); assert.match(all, /Advanced/); assert.match(all, /Select all/);
  assert.match(helpOf(b, 'Link to open'), /Tapping the notification opens that row's link/);
  assert.doesNotMatch(all, /Drive link/);
});

test('share panel sits beside section 1 now that it has two more rows; still nothing overlaps the QR', () => {
  const b = build(BOOK, [], { page: 'https://x.web.app/' }), s = b.share;
  const link = s.cells.find(c => c.kind === 'sharelink');
  assert.ok(s.qr.row + 6 < link.row, 'seven rows for the QR');
  assert.ok(s.bottom <= rowOf(b, '"Google Apps Script API" switch'), 'the panel ends with section 1');
});

// ---- 18 Nov: "Wait before sending" starts from the AppSheet answer (AppSheet fills a row in one go and would not
// need the wait). The Setup tab is already drawn before the owner answers, so the answer moves the wait when the owner
// changes it - unless the owner has picked a wait of their own. ----
const editGrid = (appsheet, wait) => [[], ['', 'x'], ['', SETUP.APPSHEET_LABEL, appsheet], ['', 'App name', 'Smith'], ['', SETUP.WAIT_LABEL, wait]];
test('answering Yes to AppSheet turns the wait Off; back to No makes it 30 seconds again', () => {
  assert.deepEqual(SETUPTAB.afterEdit(editGrid('Yes', '30 seconds'), 3, 3), { row: 5, col: 3, value: 'Off' });
  assert.deepEqual(SETUPTAB.afterEdit(editGrid('No', 'Off'), 3, 3), { row: 5, col: 3, value: '30 seconds' });
});
test('a wait the owner picked themselves is left alone, and so is one that already fits', () => {
  assert.equal(SETUPTAB.afterEdit(editGrid('Yes', '1 minute'), 3, 3), null);
  assert.equal(SETUPTAB.afterEdit(editGrid('No', '1 minute'), 3, 3), null);
  assert.equal(SETUPTAB.afterEdit(editGrid('Yes', 'Off'), 3, 3), null);
  assert.equal(SETUPTAB.afterEdit(editGrid('No', '30 seconds'), 3, 3), null);
});
test('editing any other cell changes nothing, and a tab with no wait row is left alone', () => {
  assert.equal(SETUPTAB.afterEdit(editGrid('Yes', '30 seconds'), 4, 3), null);   // the App name cell
  assert.equal(SETUPTAB.afterEdit(editGrid('Yes', '30 seconds'), 3, 2), null);   // the label, not the answer
  const other = editGrid('No', '30 seconds'); other[3] = ['', 'Some other question', 'Yes'];
  assert.equal(SETUPTAB.afterEdit(other, 4, 3), null);                           // a Yes typed on another row
  assert.equal(SETUPTAB.afterEdit(editGrid('Yes', '30 seconds').slice(0, 4), 3, 3), null);
  assert.equal(SETUPTAB.afterEdit(editGrid('maybe', '30 seconds'), 3, 3), null);
  assert.equal(SETUPTAB.afterEdit(editGrid('maybe', 'Off'), 3, 3), null);        // not Yes or No: nothing follows it
});

test('an address that already has a question mark gets the owner added with &, so the address still works', () => {
  const why = 'Google said: enable it by visiting https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=123 then retry.';
  const b = build(Object.assign({ owner: 'a@b.com' }, BOOK), [], { steps: { 'Switch on services': { error: why } } });
  const k = b.links.find(x => x.row === rowOf(b, 'Switch on services') && x.col === 4);
  assert.equal(k.url, 'https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=123&authuser=a%40b.com');
});

// the cold test, 18 Nov 8:06pm: Google named the project pushtester22-2093f (the plain ID was taken), so the name did
// not find it. A sheet's script cannot list the account's projects (tested live: Firebase Management API is off in
// Apps Script's own hidden project). So the help says to paste the project page's address - read exactly as it is.
test('the Firebase help says to paste the project page address, which always holds the exact ID', () => {
  const b = build(), help = b.rows[rowOf(b, 'Firebase project address') - 1][3];
  assert.match(help, /^Open Firebase ›  Make a project/);
  assert.match(help, /copy the address from the address bar and paste it here\.$/);
  assert.ok(help.indexOf('type the ID') < 0, 'no longer asks for the ID to be typed');
});

// ---- cold test 2 fixes, 18 Nov 9pm ----
const LINK = 'https://console.firebase.google.com/project/pushtester22-2093f/overview';
test('the project row is Firebase project address, with one plain instruction: copy the address bar, paste it here (18 Nov 9:15pm)', () => {
  const b = build();
  assert.equal(valueOf(b, 'Firebase project address'), '');
  assert.equal(rowOf(b, 'Firebase project name'), 0, 'no row with the old label');
  assert.equal(b.rows[rowOf(b, 'Firebase project address') - 1][3],
    'Open Firebase ›  Make a project (any name). Switch off the Developer Program, Gemini and Analytics - not needed. Open the project, copy the address from the address bar and paste it here.');
});

test('an old Setup tab with Firebase project name or ID keeps what was in it, now under the new label', () => {
  ['Firebase project name', 'Firebase project ID'].forEach(old => {
    assert.equal(valueOf(build(BOOK, [['', old, LINK]]), 'Firebase project address'), LINK, old);
  });
});

test('forCopy blanks the project address too', () => {
  const b = build(BOOK, SETUPTAB.forCopy([['', 'Firebase project address', LINK]]));
  assert.equal(valueOf(b, 'Firebase project address'), '');
});

test('the empty project box stands out (tone need); once filled it is a plain box again', () => {
  const r = rowOf(build(), 'Firebase project address');
  assert.ok(build().tones.some(t => t.row === r && t.col === 3 && t.tone === 'need'));
  assert.ok(!build(BOOK, [['', 'Firebase project address', LINK]]).tones.some(t => t.tone === 'need'));
});

test('the terms help says to click Accept if Google shows it (cold test 2: a new account gets a button)', () => {
  const b = build();
  assert.equal(b.rows[rowOf(b, 'Apps Script terms') - 1][3], 'Open the terms ›  Click Accept if Google shows the button. Once per Google account.');
});

test('a status box that asks you to do something is itself the link (cold test 2: the owner clicked the yellow box)', () => {
  const termsFail = { steps: { 'Switch on services': { error: 'Google needs you to accept its terms once.' } }, apiSwitch: false };
  const b = build(BOOK, [['', 'Firebase project address', LINK]], termsFail);
  const terms = rowOf(b, 'Apps Script terms'), sw = rowOf(b, '"Google Apps Script API" switch');
  assert.ok(b.links.some(l => l.row === terms && l.col === 3 && /terms\/script/.test(l.url)), 'terms box links to the terms');
  assert.ok(b.links.some(l => l.row === sw && l.col === 3 && /usersettings/.test(l.url)), 'switch box links to the switch');
  const fine = build(BOOK, [['', 'Firebase project address', LINK]], { steps: { 'Switch on services': { ok: true } }, apiSwitch: true });
  assert.ok(!fine.links.some(l => l.col === 3 && (l.row === terms || l.row === sw)), 'no link once done');
});

test('the boxes Set up fills in are locked with a warning, so typing there is caught: status row, terms, switch, every step', () => {
  const b = build();
  const cell = (r, c) => b.locked.some(l => r >= l.row && r < l.row + l.rows && c >= l.col && c < l.col + l.cols);
  [2, 3, 4, 5].forEach(c => assert.ok(cell(6, c), 'status row col ' + c));
  assert.ok(cell(rowOf(b, 'Apps Script terms'), 3));
  assert.ok(cell(rowOf(b, '"Google Apps Script API" switch'), 3));
  SETUP && require('./steps.js').names().forEach(s => assert.ok(cell(rowOf(b, s), 3), s));
  assert.ok(!cell(rowOf(b, 'Firebase project address'), 3), 'the box the owner fills is never locked');
  assert.ok(!cell(rowOf(b, 'App name'), 3));
});

test('typedDuring: the settings the owner changed between Set up reading the tab and drawing it (cold test 2: typing was lost)', () => {
  const before = [['', 'Firebase project address', ''], ['', 'App name', 'Smith']];
  const now = [['', 'Firebase project address', LINK], ['', 'App name', 'Smith']];
  assert.deepEqual(SETUPTAB.typedDuring(before, now), ['Firebase project address']);
  assert.deepEqual(SETUPTAB.typedDuring(before, before), []);
  assert.deepEqual(SETUPTAB.typedDuring([], []), []);
});

test('forCopy only empties the project value: the row keeps its label and the rest of the grid is untouched', () => {
  const grid = [['', 'Firebase project address', LINK, 'help', ''], ['', 'App name', 'Smith', '', '']];
  assert.deepEqual(SETUPTAB.forCopy(grid), [['', 'Firebase project address', '', 'help', ''], ['', 'App name', 'Smith', '', '']]);
});

test('locks come in as few ranges as possible: the status row, terms and switch together, all the steps together (each lock is slow to make)', () => {
  const b = build();
  assert.equal(b.locked.length, 3, JSON.stringify(b.locked));
});

test('a pick with nothing to offer makes no dropdown at all (an empty list would refuse every value)', () => {
  const b = build({ name: 'Smith', tabs: [], headers: {} });
  assert.ok(b.dropdowns.every(d => d.list.length > 0), JSON.stringify(b.dropdowns.filter(d => !d.list.length)));
});

test('an old comma list spread into the third message row is checked name by name: only the missing one is flagged', () => {
  const b = build(BOOK, [['', 'Tab with your rows', 'Jobs'], ['', 'Message column', 'Customer, Address, Job Type, Gone']]);
  const r = b.rows.find(x => x[1] === 'Message column 3 (optional)');
  assert.equal(r[2], 'Job Type, Gone');
  assert.equal(r[3], '"Gone" is not a heading on Jobs any more - pick again');
});

test('the footer points straight at the repo, where the README is', () => {
  assert.ok(build().rows.some(r => /github\.com\/sheet-works\/push-from-sheet/.test(r[1])));
});

// 19 Nov (real AppSheet dev test): Yes typed in a brand-new copy while its first-open redraw ran - only one onEdit of
// three edits ran, so Wait stayed 30 seconds. Set up now applies the same rule as onEdit before it reads the settings.
test('waitFollows: AppSheet Yes with Wait still at 30 seconds becomes Off, at Set up', () => {
  const rows = [[], ['', SETUP.APPSHEET_LABEL, 'Yes'], ['', SETUP.WAIT_LABEL, '30 seconds']];
  const out = SETUPTAB.waitFollows(rows);
  assert.equal(out[2][2], 'Off');
  assert.equal(rows[2][2], '30 seconds', 'the rows given are not changed');
});
test('waitFollows: a wait the owner picked (1 minute) is left; No leaves 30 seconds; no AppSheet row leaves it', () => {
  assert.equal(SETUPTAB.waitFollows([['', SETUP.APPSHEET_LABEL, 'Yes'], ['', SETUP.WAIT_LABEL, '1 minute']])[1][2], '1 minute');
  assert.equal(SETUPTAB.waitFollows([['', SETUP.APPSHEET_LABEL, 'No'], ['', SETUP.WAIT_LABEL, '30 seconds']])[1][2], '30 seconds');
  assert.equal(SETUPTAB.waitFollows([['', SETUP.WAIT_LABEL, '30 seconds']])[0][2], '30 seconds');
  assert.equal(SETUPTAB.waitFollows([['', SETUP.APPSHEET_LABEL, 'No'], ['', SETUP.WAIT_LABEL, 'Off']])[1][2], 'Off', 'an Off the owner chose with No stays Off');
  assert.deepEqual(SETUPTAB.waitFollows([]), []);
});

// 19 Nov (fresh copy of the public master): the Firebase address pasted straight after the copy opened was wiped by
// the copy's first-open redraw. The master never holds a project, so in a copy of the master whatever is in the box was
// typed by the new owner and stays. A copy of somebody's own set-up sheet still loses the old project.
test('forCopy from the master keeps a project the new owner already typed; from a set-up sheet it is still cleared', () => {
  const grid = [['', 'Firebase project address', LINK], ['', 'App name', 'Smith']];
  assert.equal(SETUPTAB.forCopy(grid, true)[0][2], LINK, 'copy of the master: kept');
  assert.equal(SETUPTAB.forCopy(grid, false)[0][2], '', 'copy of a set-up sheet: cleared');
  assert.equal(SETUPTAB.forCopy(grid)[0][2], '', 'not said: cleared (the safe way)');
  assert.equal(SETUPTAB.forCopy(grid, true)[1][2], 'Smith');
});
