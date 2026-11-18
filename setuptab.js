// setuptab.js - decides what goes in each cell of the owner's Setup tab (look B, the pick 17 Nov 2026) and its dropdowns.
// 18 Nov: as little typing as possible. The script fills in what it can (app name = the sheet's name, the tab when
// there is only one, a Push To column if there is one) and offers the rest as picks. Running it again keeps everything
// the owner already filled in, wherever those rows were. SETUP.read (setup.js) reads the result back by label.
// It never touches Apps Script: the caller hands in the sheet's name, tab names, header rows and the tab as it is now.
// Runs in Apps Script and in Node (for the tests).

// setup.js and steps.js must come before this file in the paste file (build.py), so SETUP and STEPS are there in Apps Script.
var SETUPTAB = (function (SETUP, STEPS) {
  'use strict';

  // One truth, one place: the reading rules, Notified, the app-name limit and the backup choices all come from setup.js,
  // and the Set up steps (their names and order) from steps.js.
  var STEP_NAMES = STEPS.names();
  var NOT_YET = '–  Not yet';
  var TERMS_LABEL = 'Apps Script terms', TERMS_URL = 'https://console.developers.google.com/terms/script';
  var ADDRESS = new RegExp('https://[^\\s,)"]*[^\\s,)".]');   // an address inside a sentence, without the full stop after it
  var OWN_TABS = ['Setup', 'Devices', 'Phones'];   // the script's own tabs (Phones = the old name): never offered as the tab with the rows
  var pairs = SETUP.pairs;

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  function minutes(n) { return n ? n + ' minutes' : 'Off'; }

  // book = { name, tabs: [names], headers: { tab: [header cells] } }. current = the Setup tab's displayed values now ([] if new).
  // Gives { rows: [[A, B, C, D, E]], kinds: [one per row, for the drawing], dropdowns: [{ row, list, strict }], links: [{ row, col, url, text }] }. Rows count from 1.
  function build(book, current, facts) {
    var had = pairs(current);
    var keep = function (label, fallback) { return (label in had) ? had[label] : fallback; };
    var ownerTabs = ownerTabsOf(book.tabs || []);

    var project = [SETUP.PROJECT_LABEL].concat(SETUP.OLD_PROJECT_LABELS).reduceRight(function (v, l) { return keep(l, v); }, '');
    // The suggestion is the sheet's name without Google's "Copy of " in front (18 Nov).
    var sheetName = text(book.name).replace(/^copy of\s+(?=\S)/i, '');
    var appName = keep('App name', sheetName.slice(0, SETUP.MAX_APP_NAME));
    var tab = keep('Tab with your rows', ownerTabs.length === 1 ? ownerTabs[0] : '');
    var cols = ((book.headers || {})[tab] || []).map(text).filter(function (h) { return h !== '' && h !== SETUP.NOTIFIED; });
    var pushToGuess = cols.filter(function (h) { return h.toLowerCase() === 'push to'; })[0] || '';

    var rows = [], kinds = [], dropdowns = [], links = [];
    var add = function (kind, b, c, d) { rows.push(['', b || '', c === undefined ? '' : c, d || '', '']); kinds.push(kind); return rows.length; };
    var pick = function (row, list, strict) { if (list.length) dropdowns.push({ row: row, list: list, strict: strict }); };
    // Column dropdowns read the tab's heading row itself (18 Nov), so a renamed heading shows at once.
    var pickCol = function (row, strict) { if (cols.length) dropdowns.push({ row: row, list: cols, strict: strict, fromHeader: tab }); return row; };
    // the cold test as a stranger, 18 Nov: with two Google accounts signed in, a plain link opens in the FIRST one.
    // When the sheet's owner is known, every Google link names that account.
    var owner = text(book.owner);
    var asOwner = function (url) { return owner ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'authuser=' + encodeURIComponent(owner) : url; };
    // 18 Nov 9:15pm: one way only, no confusion - copy the address bar, paste it in.
    var firebaseHelp = 'Open Firebase ›  Make a project (any name). Switch off the Developer Program, Gemini and Analytics - not needed. Open the project, copy the address from the address bar and paste it here.';
    var termsHelp = 'Open the terms ›  Click Accept if Google shows the button. Once per Google account.';   // cold test 2: a new account gets a button
    var switchHelp = 'Open the switch ›  Turn it On.';
    // The message: up to three single picks. An old comma list in one cell is spread across them (a fourth stays in the third).
    var said = SETUP.MESSAGE_LABELS.map(function (l) { return keep(l, ''); }).join(',').split(',').map(text).filter(function (m) { return m !== ''; });
    var messages = [said[0] || '', said[1] || '', said.slice(2).join(', ')];

    add('band'); add('title', appName); add('subtitle', 'Push from sheet  ·  free push notifications to phones and computers'); add('band');
    rows.push(['', 'Firebase project', 'Apps Script API', 'Your settings', 'Set up']); kinds.push('statushead');
    rows.push(['', NOT_YET, NOT_YET, NOT_YET, NOT_YET]); kinds.push('status');
    add('gap');
    add('section', '1   Once per Google account');
    add('note', 'Signed in to more than one Google account? Check the picture at the top right of each page you open is this sheet\'s owner.');
    var r = add('setting', SETUP.PROJECT_LABEL, project, firebaseHelp), projectRow = r;
    links.push({ row: r, col: 4, url: asOwner('https://console.firebase.google.com/'), text: firebaseHelp });
    r = add('setting', TERMS_LABEL, 'Open once', termsHelp); var termsRow = r;
    links.push({ row: r, col: 4, url: asOwner(TERMS_URL), text: termsHelp });
    r = add('setting', '"Google Apps Script API" switch', 'Not checked', switchHelp); var switchRow = r;
    links.push({ row: r, col: 4, url: asOwner('https://script.google.com/home/usersettings'), text: switchHelp });
    add('gap');
    add('section', '2   Your settings');
    var appNameRow = add('setting', 'App name', appName, 'The name on phones and computers, ' + SETUP.MAX_APP_NAME + ' characters at most. Starts as the sheet\'s name - change it to your business name');
    var colourRow = add('setting', 'Colour', keep('Colour', SETUP.DEFAULT_COLOUR_NAME), 'Pick a colour, or type a code like ' + SETUP.DEFAULT_COLOUR);
    pick(colourRow, Object.keys(SETUP.COLOURS), false);
    pick(add('setting', 'Tab with your rows', tab, 'The tab your rows are added to, by hand or by your app'), ownerTabs, true);
    var appsheet = keep(SETUP.APPSHEET_LABEL, 'No');
    pick(add('setting', SETUP.APPSHEET_LABEL, appsheet, 'Yes: your tab is moved first at Set up, because AppSheet builds a new app from the first tab'), ['No', 'Yes'], true);
    var titleRow = pickCol(add('setting', 'Title column', keep('Title column', ''), 'The bold first line of the notification'), true);
    var messageHelp = ['The line under the title', 'Optional. Added after it, with a comma', 'Optional. Added after that'];
    var messageRows = SETUP.MESSAGE_LABELS.map(function (l, i) { return pickCol(add('setting', l, messages[i], messageHelp[i]), true); });
    // A blank Push To is filled whenever the tab has a Push To column: blank cells in that column still mean every phone,
    // so filling it never changes who gets what (live 12:46: a blank left by a first draw with no tab stuck).
    var pushToRow = pickCol(add('setting', 'Push To column', keep('Push To column', '') || pushToGuess, 'Optional. A column of names or emails from the Devices tab. A blank cell sends to every device you let in'), true);
    var linkRow = pickCol(add('setting', 'Link to open', keep('Link to open', ''), 'Optional. A column of web links, one per row. Tapping the notification opens that row\'s link, like its AppSheet record. Blank opens the sign-up page'), true);
    pick(add('setting', SETUP.LINKS_LABEL, keep(SETUP.LINKS_LABEL, SETUP.LINKS_GOOGLE), 'AppSheet and Google only is the safe one. Any website only if only your own staff can add rows'), [SETUP.LINKS_GOOGLE, SETUP.LINKS_ANY], true);
    // 18 Nov: starts from the AppSheet answer (AppSheet adds a whole row in one go), then it is the owner's pick.
    pick(add('setting', SETUP.WAIT_LABEL, keep(SETUP.WAIT_LABEL, SETUP.waitDefault(appsheet.toLowerCase() === 'yes')), 'Time to finish typing a row before it is sent. Off sends at once - best when AppSheet adds the rows'), SETUP.WAIT_CHOICES, true);
    pick(add('setting', 'Sign-ups', keep('Sign-ups', 'Approve'), 'Approve: a new device waits for your tick on the Devices tab. Open: anyone with the link gets in'), ['Approve', 'Open'], true);
    pick(add('setting', 'Backup check', keep('Backup check', minutes(SETUP.BACKUP_DEFAULT)), 'Sends any row Google missed. After changing it, run Set up again'),
      [minutes(0)].concat(SETUP.BACKUP_CHOICES.map(minutes)), true);
    add('gap');
    add('section', '3   Set up        Menu: Push from sheet  ›  Set up');
    add('note', 'Google asks you to allow it. "Google hasn\'t verified this app" is normal - it is your own copy, and the developer it names is you. Click Advanced › Go to Push from sheet, tick Select all, then Continue.');
    STEP_NAMES.forEach(function (step) { add('step', step); });   // ticks() below writes each step's words
    add('gap');
    // After Set up the page's address is here as a link, and the drawing puts its QR code on this row.
    var pageUrl = text((facts || {}).page), pageRow = add('phonepage', 'Sign-up page', pageUrl || 'Appears here after Set up');
    if (pageUrl) links.push({ row: pageRow, col: 3, url: pageUrl, text: pageUrl });
    add('gap');
    add('section', 'Good to know');
    add('note', 'Daily allowance is Google\'s, shared by all your scripts. The backup check uses about 11 minutes a day at 10 minutes.');
    add('note', 'iPhone: add the page to the Home Screen first, then turn on.');
    add('note', 'Anyone who can add a row to your tab can send a notification. Only let people you trust add rows.');
    add('note', 'To stop for good: Push from sheet › Turn off, then bin the sheet.');
    add('note', 'Free, as is, MIT licence  ·  ' + SETUP.REPO + '  ·  version ' + SETUP.VERSION);
    rows[1][1] = '=C' + appNameRow;   // the heading shows the App name cell, so it follows as the owner types (18 Nov)
    var tones = ticks(rows, facts || {});
    // The empty project box stands out until it is filled (cold test 2: the owner typed into the yellow status box instead).
    if (text(project) === '') tones.push({ row: projectRow, col: 3, tone: 'need' });
    // A status box that asks you to do something is itself the link (cold test 2: the owner clicked the yellow box).
    if (text(rows[termsRow - 1][2]).charAt(0) === '!') links.push({ row: termsRow, col: 3, url: asOwner(TERMS_URL), text: rows[termsRow - 1][2] });
    if (text(rows[switchRow - 1][2]).charAt(0) === '!') links.push({ row: switchRow, col: 3, url: asOwner('https://script.google.com/home/usersettings'), text: rows[switchRow - 1][2] });
    // The boxes Set up fills in are locked with a warning (the drawing protects them), so typing there is caught.
    // As few ranges as possible: each lock is a slow call to Google (18 Nov: 10 locks took seconds).
    var locked = [{ row: 6, col: 2, rows: 1, cols: 4 }];
    if (switchRow === termsRow + 1) locked.push({ row: termsRow, col: 3, rows: 2, cols: 1 });
    else locked.push({ row: termsRow, col: 3, rows: 1, cols: 1 }, { row: switchRow, col: 3, rows: 1, cols: 1 });
    kinds.forEach(function (k, i) {
      if (k !== 'step') return;
      var last = locked[locked.length - 1];
      if (last.col === 3 && last.cols === 2 && last.row + last.rows === i + 1) last.rows++;
      else locked.push({ row: i + 1, col: 3, rows: 1, cols: 2 });
    });
    // A picked column that is no longer a heading on the tab (renamed or deleted): amber, with what to do.
    var known = (book.headers || {})[tab], stale = [];
    if (tab && known) {
      [[titleRow, false]].concat(messageRows.map(function (m) { return [m, true]; }), [[pushToRow, false], [linkRow, false]]).forEach(function (c) {
        var r = c[0] - 1, picked = text(rows[r][2]);
        if (picked === '') return;
        var gone = (c[1] ? picked.split(',') : [picked]).map(text).filter(function (n) { return n !== '' && cols.indexOf(n) < 0; });
        if (!gone.length) return;
        rows[r][3] = '"' + gone[0] + '" is not a heading on ' + tab + ' any more - pick again';
        stale.push(rows[r][1] + ': ' + rows[r][3] + '.');   // also stops Set up before the steps (18 Nov)
        tones.push({ row: c[0], col: 3, tone: 'amber' });
      });
    }
    // Any address in a failed step's reason is a real link (18 Nov: "this isn't clickable"), in the owner's account.
    STEP_NAMES.forEach(function (name) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][1] !== name) continue;
        var m = ADDRESS.exec(text(rows[i][3]));
        if (m) links.push({ row: i + 1, col: 4, url: asOwner(m[0]), text: rows[i][3], start: m.index, end: m.index + m[0].length });
      }
    });
    var built = { rows: rows, kinds: kinds, dropdowns: dropdowns, links: links, tones: tones, colourRow: colourRow, stale: stale, locked: locked };
    if (pageUrl) built.page = { row: pageRow, url: pageUrl };
    built.share = sharePanel(pageUrl);
    return built;
  }

  // The ticks (look B mock-up rows 6 and 24-29). Always worked out fresh from the settings and what Set up last did -
  // never copied from the old tab. facts = { apiSwitch: true | false | undefined, steps: { 'step name': { ok: true } | { error: 'words' } } }.
  // Writes the words into rows and gives back [{ row, col, tone }] with tone green / amber / red / grey for the drawing.
  // The share panel: once the page exists, a box to the right of the card (column G; F is a gap) with the QR code,
  // so the first thing you see when it is LIVE is how to get people signed up (18 Nov). The QR picture is
  // placed over rows 4 to 10 (pfsPlaceQr_); the drawing styles each cell by its kind.
  function sharePanel(url) {
    if (!url) return null;
    return { col: 7, width: 300, top: 2, bottom: 12, qr: { row: 4, col: 7, size: 150 },   // QR over rows 4-10; the link fits on one line
      cells: [{ row: 2, kind: 'sharetitle', text: 'Share the sign-up page' },
              { row: 3, kind: 'sharehelp', text: 'Scan with a phone camera, or send the link.' },
              { row: 11, kind: 'sharelink', text: url, url: url },
              { row: 12, kind: 'sharehelp', text: 'Menu: Push from sheet  ›  Share the sign-up page' }] };
  }

  function ticks(rows, facts) {
    var tones = [], steps = facts.steps || {};
    var at = function (label) { for (var i = 0; i < rows.length; i++) if (rows[i][1] === label) return i; return -1; };
    var put = function (i, col, words, tone) { rows[i][col - 1] = words; tones.push({ row: i + 1, col: col, tone: tone }); };
    var read = SETUP.read(rows), missing = read.problems.length;
    var nameMissing = read.problems.some(function (p) { return p.indexOf('Firebase project') === 0; });

    var done = 0, failed = 0;
    STEP_NAMES.forEach(function (name, n) {
      var i = at(name), r = steps[name];
      if (i < 0) return;
      if (r && r.ok) { done++; put(i, 3, '✓  Done', 'green'); }
      else if (r && r.error) { if (!failed) failed = n + 1; put(i, 3, '✕  Failed', 'red'); put(i, 4, r.error, 'red'); }
      else put(i, 3, NOT_YET, 'grey');
    });
    // The terms cannot be asked about, but the first step only gets through once they are accepted.
    var first = steps[STEP_NAMES[0]], terms = at(TERMS_LABEL);
    if (terms >= 0) {
      if (first && first.ok) put(terms, 3, '✓  Done', 'green');
      else if (first && first.error && first.error.indexOf('terms') >= 0) put(terms, 3, '!  Open the terms', 'amber');
    }
    var sw = at('"Google Apps Script API" switch');
    if (facts.apiSwitch === true) put(sw, 3, '✓  On', 'green');
    else if (facts.apiSwitch === false) put(sw, 3, '!  Off', 'amber');

    var head = 5;   // row 6: Firebase project, Apps Script API, Your settings, Set up
    if (nameMissing) put(head, 2, '!  Needs your project name', 'amber');
    else if (steps[STEP_NAMES[0]] && steps[STEP_NAMES[0]].ok) put(head, 2, '✓  Done', 'green');
    else put(head, 2, NOT_YET, 'grey');
    if (facts.apiSwitch === true) put(head, 3, '✓  On', 'green');
    else if (facts.apiSwitch === false) put(head, 3, '!  Switch it on', 'amber');
    else put(head, 3, '–  Not checked', 'grey');
    if (missing) put(head, 4, '!  ' + missing + ' to fill in', 'amber'); else put(head, 4, '✓  Filled in', 'green');
    if (failed) put(head, 5, '✕  Step ' + failed + ' failed', 'red');
    else if (done === STEP_NAMES.length) { put(head, 5, '✓  Done', 'green'); put(1, 5, '●  LIVE', 'live'); }
    else if (done) put(head, 5, '!  Run Set up again', 'amber');
    else put(head, 5, NOT_YET, 'grey');
    return tones;
  }

  // A copy of a sheet that was set up: keep the owner's picks, but not the Firebase project (it belongs to whoever set
  // up the original). Drawn with no facts, it shows as not set up: no LIVE, no link, no QR (18 Nov).
  function forCopy(grid) {
    return (grid || []).map(function (r) {
      var row = (r || []).slice();
      if ([SETUP.PROJECT_LABEL].concat(SETUP.OLD_PROJECT_LABELS).indexOf(text(row[1])) >= 0) row[2] = '';
      return row;
    });
  }

  // The settings the owner changed between Set up reading the tab and drawing it (cold test 2, 18 Nov: a 52 second run
  // drew over a project name typed while it ran). Set up draws from a fresh read and says these need another run.
  function typedDuring(before, now) {
    var a = pairs(before || []), b = pairs(now || []), out = [];
    Object.keys(b).forEach(function (label) { if (text(b[label]) !== text(a[label])) out.push(label); });
    Object.keys(a).forEach(function (label) { if (!(label in b) && text(a[label]) !== '') out.push(label); });
    return out;
  }

  // Is this tab ours to draw on? Yes when it is empty, or its subtitle (row 3, column B) starts with 'Push from sheet'.
  // Set up never draws over somebody else's tab that happens to be called Setup.
  function isOurs(grid) {
    var any = (grid || []).some(function (r) { return (r || []).some(function (c) { return text(c) !== ''; }); });
    return !any || text(((grid || [])[2] || [])[1]).indexOf('Push from sheet') === 0;
  }

  function ownerTabsOf(tabs) { return tabs.filter(function (t) { return OWN_TABS.indexOf(t) < 0; }); }

  // The owner's tab is remembered by Google's own ID for it (18 Nov), so renaming it never loses it.
  // wanted = the name on Setup, storedId = the ID remembered last time, tabs = [{ name, id }].
  // Gives { name, id, renamed }: the tab to use, its ID to remember, and whether Setup should show the new name.
  function followTab(wanted, storedId, tabs) {
    var byName = tabs.filter(function (t) { return t.name === wanted; })[0];
    if (byName) return { name: byName.name, id: byName.id, renamed: false };
    var byId = storedId === null || storedId === undefined ? null : tabs.filter(function (t) { return t.id === storedId; })[0];
    if (byId) return { name: byId.name, id: byId.id, renamed: true };
    return { name: wanted, id: null, renamed: false };
  }

  // The owner just edited a Setup cell (row, col from 1). When it is the AppSheet answer, the wait follows it: Yes = Off,
  // No = 30 seconds - but only when the wait still holds the other answer's starting value, so a wait the owner picked
  // (1 minute) is never touched. Gives { row, col, value } to write, or null.
  function afterEdit(rows, row, col) {
    var label = function (r) { return String((rows[r] || [])[1] || '').trim(); }, at = -1, i;
    if (col !== 3 || label(row - 1) !== SETUP.APPSHEET_LABEL) return null;
    var answer = String(rows[row - 1][2] || '').trim().toLowerCase();
    if (answer !== 'yes' && answer !== 'no') return null;
    for (i = 0; i < rows.length; i++) if (label(i) === SETUP.WAIT_LABEL) at = i;
    if (at < 0) return null;
    var wait = String(rows[at][2] || '').trim().toLowerCase(), want = SETUP.waitDefault(answer === 'yes'), other = SETUP.waitDefault(answer !== 'yes');
    return wait === other.toLowerCase() ? { row: at + 1, col: 3, value: want } : null;
  }

  return { build: build, forCopy: forCopy, typedDuring: typedDuring, afterEdit: afterEdit, isOurs: isOurs, followTab: followTab, ownerTabs: ownerTabsOf, TAB_NAME: 'Setup' };
})(typeof SETUP !== 'undefined' ? SETUP : require(process.env.SETUP || './setup.js'),
   typeof STEPS !== 'undefined' ? STEPS : require('./steps.js'));

if (typeof module !== 'undefined') module.exports = SETUPTAB;
