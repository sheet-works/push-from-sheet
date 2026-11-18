'use strict';
// Tests for setup.js - reads the owner's settings off the Setup tab (look B, the pick 17 Nov) and says plainly what is wrong.
// The Setup tab is label in column B, value in column C (mock-up sheet 1B4ol5o3Um4Vn884O_oMYPZl7wokfbv2puM9o-cgiXcM, tab 'B Setup').
// Settings are found by their LABEL, not their row, so moving a row never breaks it.
// Run: node --test test-setup.js   (always name the test files)
// Rule: written BEFORE setup.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const SETUP = require(process.env.SETUP || './setup.js');

// The mock-up's Setup tab as the script sees it (getDisplayValues): rows of columns A, B, C, D.
function grid(over) {
  const v = Object.assign({
    'Firebase project name': 'demo-push-1a2b', 'App name': 'Demo App', 'Colour': '#1565C0', 'Icon': 'Plain default',
    'Tab with your rows': 'Sheet1', 'Title column': 'Title', 'Message column': 'Message', 'Push To column': 'Push To',
    'Link to open': 'Record link', 'Sign-ups': 'Approve', 'Backup check': '10 minutes'
  }, over || {});
  const row = (label) => ['', label, v[label], 'help text'];
  return [
    [], ['', 'Demo App'], ['', 'Push from sheet  ·  free notifications'], [],
    ['', 'Firebase project', 'Apps Script API', 'Your settings', 'Set up'], [],
    ['', '1   Once per Google account'], row('Firebase project name'), ['', '"Google Apps Script API" switch', 'On', 'Open the switch  ›'], [],
    ['', '2   Your settings'], row('App name'), row('Colour'), row('Icon'), row('Tab with your rows'), row('Title column'),
    row('Message column'), row('Push To column'), row('Link to open'), row('Sign-ups'), row('Backup check'),
    row('Making an AppSheet app?'), row('Links can open'), [],
    ['', '3   Set up'], ['', 'Publish as a web app', '✕  Couldn\'t publish', 'Firebase says...']
  ];
}

test('the mock-up settings read cleanly into what the engine needs', () => {
  const r = SETUP.read(grid());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.settings, {
    firebaseProject: 'demo-push-1a2b', appName: 'Demo App', colour: '#1565C0', icon: '', tab: 'Sheet1',
    title: 'Title', message: ['Message'], pushTo: 'Push To', link: 'Record link', notified: 'Notified', signup: 'approve', backupMinutes: 10,
    appsheetFirst: false, links: 'google', waitSeconds: 30   // 18 Nov evening: the new wait setting, blank = 30 seconds
  });
});

test('settings are found by label wherever the row is, and spaces around labels and values do not matter', () => {
  const g = grid().reverse().map(r => r.map(c => (typeof c === 'string' && c ? '  ' + c + ' ' : c)));
  const r = SETUP.read(g);
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.tab, 'Sheet1');
  assert.equal(r.settings.title, 'Title');
});

test('if a setting row is there twice, the first one counts (the one nearer the top)', () => {
  const g = grid();
  g.push(['', 'Tab with your rows', 'Other tab']);
  assert.equal(SETUP.read(g).settings.tab, 'Sheet1');
});

test('several message columns can be listed, split by commas', () => {
  assert.deepEqual(SETUP.read(grid({ 'Message column': 'Customer, Address ,Job Date' })).settings.message, ['Customer', 'Address', 'Job Date']);
});

test('Push To and the link are optional: blank means not used', () => {
  const r = SETUP.read(grid({ 'Push To column': '', 'Link to open': '  ' }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.pushTo, '');
  assert.equal(r.settings.link, '');
});

test('each missing must-have setting is named in plain words', () => {
  const r = SETUP.read(grid({ 'App name': '', 'Tab with your rows': ' ', 'Title column': '', 'Message column': ' , ', 'Firebase project name': '' }));
  assert.deepEqual(r.problems, [
    'Firebase project address is empty - open your project in Firebase, copy the address from the address bar and paste it here (step 1).',
    'App name is empty.',
    'Tab with your rows is empty.',
    'Title column is empty.',
    'Message column is empty.'
  ]);
});

test('a setting whose row has been deleted is reported the same way as an empty one', () => {
  const g = grid().filter(r => r[1] !== 'Title column');
  assert.deepEqual(SETUP.read(g).problems, ['Title column is empty.']);
});

test('a Firebase project ID in the wrong shape is reported (6 to 30 small letters, digits or dashes, starting with a letter)', () => {
  for (const bad of ['1demo-push', '1 Demo Push', 'demo', 'demo1', 'a'.repeat(31), 'demo-push-', 'demo_push']) {
    assert.deepEqual(SETUP.read(grid({ 'Firebase project name': bad })).problems, ['Firebase project address "' + bad + '" is not the address of a Firebase project - open your project in Firebase, copy the address from the address bar and paste it here (step 1).'], bad);
  }
  for (const good of ['demo-push-1a2b', 'abcdef', 'a'.repeat(30), 'push-from-sheet-2026']) {
    assert.deepEqual(SETUP.read(grid({ 'Firebase project name': good })).problems, [], good);
  }
});

test('the app name is kept short enough for a phone (30 characters)', () => {
  assert.deepEqual(SETUP.read(grid({ 'App name': 'x'.repeat(30) })).problems, []);
  assert.deepEqual(SETUP.read(grid({ 'App name': 'x'.repeat(31) })).problems, ['App name is too long - 30 characters at most.']);
});

test('the colour: a plain colour name from the list (any case), or a code like #1565C0; anything else is reported and Blue used', () => {
  assert.equal(SETUP.read(grid({ 'Colour': '#a1b2c3' })).settings.colour, '#A1B2C3');
  assert.equal(SETUP.read(grid({ 'Colour': 'Green' })).settings.colour, '#2E7D32');
  assert.equal(SETUP.read(grid({ 'Colour': ' navy ' })).settings.colour, '#1A237E');
  assert.deepEqual(SETUP.read(grid({ 'Colour': 'Teal' })).problems, []);
  for (const bad of ['sky blue', '1565C0', '#1565C', '#1565C0F', '#GGGGGG']) {
    const r = SETUP.read(grid({ 'Colour': bad }));
    assert.equal(r.settings.colour, '#1565C0', bad);
    assert.deepEqual(r.problems, ['Colour "' + bad + '" is not one of the colours in the list or a code like #1565C0 - using Blue.'], bad);
  }
  assert.equal(SETUP.read(grid({ 'Colour': '' })).settings.colour, '#1565C0', 'blank = Blue, no problem');
  assert.deepEqual(SETUP.read(grid({ 'Colour': '' })).problems, []);
});

test('the colour list (18 Nov: plain names): ten names, each a real colour code, Blue first and the default', () => {
  assert.deepEqual(Object.keys(SETUP.COLOURS), ['Blue', 'Navy', 'Green', 'Teal', 'Red', 'Orange', 'Purple', 'Pink', 'Grey', 'Black']);
  Object.keys(SETUP.COLOURS).forEach((n) => assert.match(SETUP.COLOURS[n], /^#[0-9A-F]{6}$/, n));
  assert.equal(SETUP.COLOURS.Blue, SETUP.DEFAULT_COLOUR);
  assert.equal(SETUP.DEFAULT_COLOUR_NAME, 'Blue');
});

test('Making an AppSheet app? Yes or No (blank = No); anything else is reported and No used', () => {
  const ask = (v) => SETUP.read(grid({ 'Making an AppSheet app?': v }));
  assert.equal(ask('Yes').settings.appsheetFirst, true);
  assert.equal(ask('yes').settings.appsheetFirst, true);
  assert.equal(ask('No').settings.appsheetFirst, false);
  assert.equal(ask('').settings.appsheetFirst, false);
  assert.deepEqual(ask('maybe').problems, ['Making an AppSheet app? "maybe" should be Yes or No - using No.']);
});

test('Links can open: AppSheet and Google only (the default) or Any website; anything else is reported and the safe one used', () => {
  const ask = (v) => SETUP.read(grid({ 'Links can open': v }));
  assert.equal(ask('').settings.links, 'google');
  assert.equal(ask('AppSheet and Google only').settings.links, 'google');
  assert.equal(ask('Any website').settings.links, 'any');
  assert.equal(ask('any website').settings.links, 'any');
  assert.deepEqual(ask('all').problems, ['Links can open "all" should be AppSheet and Google only, or Any website - using AppSheet and Google only.']);
  assert.equal(ask('all').settings.links, 'google');
});

test('the icon is the plain default, or a Drive file (from a share link or the bare file id)', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
  assert.equal(SETUP.read(grid({ 'Icon': 'Plain default' })).settings.icon, '');
  assert.equal(SETUP.read(grid({ 'Icon': '' })).settings.icon, '');
  assert.equal(SETUP.read(grid({ 'Icon': 'https://drive.google.com/file/d/' + ID + '/view?usp=sharing' })).settings.icon, ID);
  assert.equal(SETUP.read(grid({ 'Icon': 'https://drive.google.com/open?id=' + ID })).settings.icon, ID);
  assert.equal(SETUP.read(grid({ 'Icon': ID })).settings.icon, ID);
  const r = SETUP.read(grid({ 'Icon': 'my logo.png' }));
  assert.equal(r.settings.icon, '');
  assert.deepEqual(r.problems, ['Icon "my logo.png" is not a Drive link - using the plain default.']);
});

test('sign-ups: Open lets anyone with the link in; Approve or blank means the owner ticks each phone', () => {
  assert.equal(SETUP.read(grid({ 'Sign-ups': 'Open' })).settings.signup, 'open');
  assert.equal(SETUP.read(grid({ 'Sign-ups': ' open ' })).settings.signup, 'open');
  assert.equal(SETUP.read(grid({ 'Sign-ups': 'Approve' })).settings.signup, 'approve');
  assert.equal(SETUP.read(grid({ 'Sign-ups': '' })).settings.signup, 'approve');
  assert.deepEqual(SETUP.read(grid({ 'Sign-ups': '' })).problems, []);
});

test('a sign-up setting that is neither Open nor Approve is reported, and never opens it up', () => {
  for (const bad of ['Opne', 'yes', 'anyone']) {
    const r = SETUP.read(grid({ 'Sign-ups': bad }));
    assert.equal(r.settings.signup, 'approve', bad);
    assert.deepEqual(r.problems, ['Sign-ups "' + bad + '" should be Open or Approve - using Approve.'], bad);
  }
});

test('the Notified column name is fixed (the script adds it if missing)', () => {
  assert.equal(SETUP.read(grid()).settings.notified, 'Notified');
  assert.equal(SETUP.NOTIFIED, 'Notified');
});

test('a column used twice for different jobs is reported', () => {
  assert.deepEqual(SETUP.read(grid({ 'Push To column': 'Title' })).problems, ['The Title column and the Push To column are the same column ("Title").']);
  assert.deepEqual(SETUP.read(grid({ 'Message column': 'Message, Notified' })).problems, ['"Notified" is kept for the script - pick another Message column.']);
});

test('an empty or odd sheet gives problems, never a crash', () => {
  for (const g of [[], [[]], [['x']], [[null, null, null]], [['', 'App name']], [null, undefined]]) {
    const r = SETUP.read(g);
    assert.ok(r.problems.length >= 5, JSON.stringify(g));
  }
});

test('no big-number literals in setup.js (Apps Script refuses to save them)', () => {
  const src = require('node:fs').readFileSync(require.resolve(process.env.SETUP || './setup.js'), 'utf8');
  assert.deepEqual(src.match(/\b(0x[0-9A-Fa-f]+|\d+)n\b/g) || [], []);
});

// ---- 18 Nov: fewer ways to get step 1 wrong - the owner may paste the page address from Firebase instead of hunting for the ID ----
test('the Firebase project cell also takes the address of the project page, and the ID is read out of it', () => {
  ['https://console.firebase.google.com/project/demo-push-1a2b/overview',
   'https://console.firebase.google.com/u/0/project/demo-push-1a2b/settings/general',
   'console.firebase.google.com/u/1/project/demo-push-1a2b',
   'https://console.firebase.google.com/project/demo-push-1a2b/hosting/sites?hl=en#top',
   'https://console.cloud.google.com/home/dashboard?project=demo-push-1a2b',
   'https://console.cloud.google.com/apis/library?authuser=0&project=demo-push-1a2b&supportedpurview=project',
   'https://console.firebase.google.com/project/demo-push-1a2b?hl=en',
   'https://console.cloud.google.com/welcome?project=demo-push-1a2b#top',
   '  https://console.firebase.google.com/project/demo-push-1a2b/overview  '].forEach(link => {
    const r = SETUP.read(grid({ 'Firebase project name': link }));
    assert.deepEqual(r.problems, [], link);
    assert.equal(r.settings.firebaseProject, 'demo-push-1a2b', link);
  });
});

test('an address with a wrong-looking ID in it, or with no project in it, is reported in plain words', () => {
  assert.deepEqual(SETUP.read(grid({ 'Firebase project name': 'https://console.firebase.google.com/project/My_Project/overview' })).problems,
    ['Firebase project address "https://console.firebase.google.com/project/My_Project/overview" is not the address of a Firebase project - open your project in Firebase, copy the address from the address bar and paste it here (step 1).']);
  assert.deepEqual(SETUP.read(grid({ 'Firebase project name': 'https://console.firebase.google.com/' })).problems,
    ['Firebase project address "https://console.firebase.google.com/" is not the address of a Firebase project - open your project in Firebase, copy the address from the address bar and paste it here (step 1).']);
});

test('a plain ID that happens to contain the word project is still just an ID', () => {
  const r = SETUP.read(grid({ 'Firebase project name': 'my-project-9x' }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.firebaseProject, 'my-project-9x');
});

// ---- 18 Nov 12:10pm: the backup check is a setting. Google's timers only come in 5, 10, 15 or 30 minutes (1 would eat the daily allowance) ----
const backupOf = (text) => SETUP.read(grid({ 'Backup check': text }));

test('Backup check: the owner picks 5, 10, 15 or 30 minutes, written with or without the word', () => {
  [['5 minutes', 5], ['5', 5], ['5 min', 5], ['5 mins', 5], [' 15 Minutes ', 15], ['30 minutes', 30], ['10', 10], ['10minutes', 10], ['30 minute', 30]].forEach(([text, want]) => {
    const r = backupOf(text);
    assert.deepEqual(r.problems, [], text);
    assert.equal(r.settings.backupMinutes, want, text);
  });
  assert.deepEqual(SETUP.BACKUP_CHOICES, [5, 10, 15, 30]);
});

test('Backup check: Off turns it off', () => {
  ['Off', 'off', ' OFF '].forEach(text => {
    const r = backupOf(text);
    assert.deepEqual(r.problems, [], text);
    assert.equal(r.settings.backupMinutes, 0, text);
  });
});

test('Backup check: left blank, or a Setup tab with no such row, means every 10 minutes', () => {
  assert.equal(backupOf('').settings.backupMinutes, 10);
  assert.deepEqual(backupOf('').problems, []);
  const r = SETUP.read(grid().filter(row => row[1] !== 'Backup check'));
  assert.equal(r.settings.backupMinutes, 10);
  assert.deepEqual(r.problems, []);
});

test('Backup check: anything else is reported in plain words and 10 minutes is used', () => {
  ['7', '1', '1 minute', '60', '0', '-5', '10.5', '105', '510', 'every 10', 'ten', '10 hours', 'minutes', 'offf', '5 x'].forEach(bad => {
    const r = backupOf(bad);
    assert.equal(r.settings.backupMinutes, 10, bad);
    assert.deepEqual(r.problems, ['Backup check "' + bad + '" should be Off, 5, 10, 15 or 30 minutes - using 10.'], bad);
  });
});

// ---- ruling 18 Nov 12:29pm: the owner types the NAME he gave his project; nobody in the middle ----
test('the name the owner typed is tidied into the ID Google makes from it: small letters, spaces become dashes', () => {
  [['Smith Cutting Push', 'smith-cutting-push'], ['Demo-Push', 'demo-push'], ['demo push', 'demo-push'], ['demo   push  one', 'demo-push-one'],
   ['DEMO-PUSH-1A2B', 'demo-push-1a2b'], ['demo-push-1a2b', 'demo-push-1a2b']].forEach(([typed, want]) => {
    const r = SETUP.read(grid({ 'Firebase project name': typed }));
    assert.deepEqual(r.problems, [], typed);
    assert.equal(r.settings.firebaseProject, want, typed);
  });
});

test('a name that cannot be an ID is reported with the words the owner typed, not the tidied ones', () => {
  assert.deepEqual(SETUP.read(grid({ 'Firebase project name': "Sam's Push" })).problems,
    ['Firebase project address "Sam\'s Push" is not the address of a Firebase project - open your project in Firebase, copy the address from the address bar and paste it here (step 1).']);
});

test('an ID taken out of a pasted address is used exactly as it is, never tidied', () => {
  assert.equal(SETUP.read(grid({ 'Firebase project name': 'https://console.firebase.google.com/project/My-Project/overview' })).problems.length, 1);
});

test('the old label "Firebase project ID" is still read, and the name row wins when both are there', () => {
  const old = grid().map(r => r.map(c => (c === 'Firebase project name' ? 'Firebase project ID' : c)));
  assert.equal(SETUP.read(old).settings.firebaseProject, 'demo-push-1a2b');
  assert.deepEqual(SETUP.read(old).problems, []);
  const both = old.concat([['', 'Firebase project name', 'the-new-one', '']]);
  assert.equal(SETUP.read(both).settings.firebaseProject, 'the-new-one');
  const blankName = old.concat([['', 'Firebase project name', '', '']]);
  assert.equal(SETUP.read(blankName).settings.firebaseProject, 'demo-push-1a2b');
});

// ---- 18 Nov evening, after the cold test as a stranger (jobtester) ----
test('message: up to three single-column picks (Message column, 2 and 3), joined in order; an old comma list in one cell still reads', () => {
  const g = (rows) => SETUP.read([['', 'Firebase project name', 'smith-push'], ['', 'App name', 'Smith'], ['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Title']].concat(rows));
  assert.deepEqual(g([['', 'Message column', 'Details'], ['', 'Message column 2 (optional)', 'Address'], ['', 'Message column 3 (optional)', 'Time']]).settings.message, ['Details', 'Address', 'Time']);
  assert.deepEqual(g([['', 'Message column', 'Details'], ['', 'Message column 2 (optional)', ''], ['', 'Message column 3 (optional)', 'Time']]).settings.message, ['Details', 'Time']);
  assert.deepEqual(g([['', 'Message column', 'Details, Address']]).settings.message, ['Details', 'Address']);
  assert.deepEqual(SETUP.MESSAGE_LABELS, ['Message column', 'Message column 2 (optional)', 'Message column 3 (optional)']);
  const dup = g([['', 'Message column', 'Details'], ['', 'Message column 2 (optional)', 'Details']]);
  assert.ok(dup.problems.some(p => /same column/.test(p)), 'the same column twice is still caught');
});

test('Wait before sending: Off, 30 seconds or 1 minute; blank follows the AppSheet answer (Yes = Off, No = 30 seconds) - 18 Nov', () => {
  const g = (rows) => SETUP.read([['', 'Firebase project name', 'smith-push'], ['', 'App name', 'Smith'], ['', 'Tab with your rows', 'Jobs'], ['', 'Title column', 'Title'], ['', 'Message column', 'Details']].concat(rows));
  assert.equal(g([['', 'Wait before sending', 'Off']]).settings.waitSeconds, 0);
  assert.equal(g([['', 'Wait before sending', '30 seconds']]).settings.waitSeconds, 30);
  assert.equal(g([['', 'Wait before sending', '1 minute']]).settings.waitSeconds, 60);
  assert.equal(g([]).settings.waitSeconds, 30, 'blank and not an AppSheet app: wait');
  assert.equal(g([['', SETUP.APPSHEET_LABEL, 'Yes']]).settings.waitSeconds, 0, 'blank and an AppSheet app: at once');
  assert.equal(g([['', SETUP.APPSHEET_LABEL, 'Yes'], ['', 'Wait before sending', '1 minute']]).settings.waitSeconds, 60, 'the owner\'s own pick wins');
  const bad = g([['', 'Wait before sending', 'ages']]);
  assert.equal(bad.settings.waitSeconds, 30);
  assert.ok(bad.problems.some(p => p === 'Wait before sending "ages" should be Off, 30 seconds or 1 minute - using 30 seconds.'));
  assert.deepEqual(SETUP.WAIT_CHOICES, ['Off', '30 seconds', '1 minute']);
  assert.equal(SETUP.waitDefault(true), 'Off'); assert.equal(SETUP.waitDefault(false), '30 seconds');
});

// 18 Nov 6:50pm: the long label was cut off in its column on the Setup tab - shortened.
test('the AppSheet question is short enough to fit its column', () => {
  assert.equal(SETUP.APPSHEET_LABEL, 'Making an AppSheet app?');
});

// ---- 18 Nov 9:15pm: one way only for the Firebase project - copy the address bar, paste it in ----
test('the project row is called Firebase project address, one truth in setup.js; the old labels are still read', () => {
  assert.equal(SETUP.PROJECT_LABEL, 'Firebase project address');
  assert.deepEqual(SETUP.OLD_PROJECT_LABELS, ['Firebase project name', 'Firebase project ID']);
  const link = 'https://console.firebase.google.com/project/pushtester22-2093f/overview';
  ['Firebase project address', 'Firebase project name', 'Firebase project ID'].forEach(label => {
    const r = SETUP.read([['', label, link]]);
    assert.equal(r.settings.firebaseProject, 'pushtester22-2093f', label);
  });
});

test('an empty project address says to paste the address, never to type a name', () => {
  const p = SETUP.read([]).problems.find(x => x.indexOf('Firebase project') === 0);
  assert.equal(p, 'Firebase project address is empty - open your project in Firebase, copy the address from the address bar and paste it here (step 1).');
  assert.doesNotMatch(p, /type/i);
});

test('something pasted that is not a Firebase address that fits says to paste the address again', () => {
  const p = SETUP.read([['', 'Firebase project address', 'Hello there!']]).problems.find(x => x.indexOf('Firebase project') === 0);
  assert.equal(p, 'Firebase project address "Hello there!" is not the address of a Firebase project - open your project in Firebase, copy the address from the address bar and paste it here (step 1).');
});

test('with both the new and an old project row filled, the new one wins (a redraw moves the value across)', () => {
  const r = SETUP.read([['', 'Firebase project name', 'old-project'], ['', 'Firebase project address', 'https://console.firebase.google.com/project/new-project-1a2b/overview']]);
  assert.equal(r.settings.firebaseProject, 'new-project-1a2b');
});
