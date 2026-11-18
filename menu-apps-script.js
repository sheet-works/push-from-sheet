// menu-apps-script.js - Apps Script only. The 'Push from sheet' menu (MENU in menu.js decides the words).
// Inside the owner's sheet (the copy-only sheet) the menu appears by itself when the sheet opens. In the test rig,
// which runs from outside the sheet, there is no menu: run the pfs... functions from the editor, and the words go to the log.
// Set up draws the Setup and Devices tabs and, once the settings are filled in, runs the Firebase steps (steps.js)
// with the real hands from setuprun-apps-script.js, then shows each step's tick.
function pfsBook_() { return PFS_ENV.book(); }
function pfsSay_(text) {
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(MENU.TITLE, text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* no sheet open (test rig): the log has it */ }
}

// The sheet owner's Google account, for links that open in the right account (cold test 18 Nov: with two accounts
// signed in, plain links opened as the wrong one). No extra permission: it is this sheet's own owner. '' when Google
// will not say (then the links are plain and the Setup tab's warning line covers it).
// Never on the shared master: strangers read and copy it, and its links must not send them to the developer's account
// (seen 18 Nov 7pm: the master's links carried his email after it redrew).
function pfsOwner_(book) {
  if (MENU.isMaster(book.getId())) return '';
  try { var o = book.getOwner(); return o ? String(o.getEmail() || '') : ''; } catch (e) { return ''; }
}

// Runs by itself when the owner edits a cell (no permission needed). Only job: on the Setup tab, the AppSheet answer
// moves "Wait before sending" to match (SETUPTAB.afterEdit). Must never get in the way of an edit.
function onEdit(e) {
  try {
    var sheet = e && e.range && e.range.getSheet();
    if (!sheet || sheet.getName() !== SETUPTAB.TAB_NAME) return;
    var change = SETUPTAB.afterEdit(sheet.getDataRange().getDisplayValues(), e.range.getRow(), e.range.getColumn());
    if (change) sheet.getRange(change.row, change.col).setValue(change.value);
  } catch (err) { Logger.log('On edit: ' + err); }
}

function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu(MENU.TITLE);
  MENU.items().forEach(function (item) { menu.addItem(item.name, item.fn); });
  menu.addToUi();
  try { pfsCopyCheck_(pfsBook_()); } catch (e) { /* opening the sheet must never fail because of this */ }
  // Keep the "Tab with your rows" list and a renamed tab in step every time the sheet opens (18 Nov).
  try {
    var book = pfsBook_(), setup = book.getSheetByName(SETUPTAB.TAB_NAME);
    if (setup && SETUPTAB.isOurs(setup.getDataRange().getDisplayValues())) {
      var r = SETUP.read(setup.getDataRange().getDisplayValues());
      if (r.settings.tab) runFollowTab_(book, r.settings.tab);
      // New sign-ups and the owner's colour show on Devices whenever the sheet is opened.
      if (book.getSheetByName(PHONETAB.TAB_NAME)) runSyncPhones_(book, r.settings);
    }
  } catch (e) { Logger.log('On open: ' + e); /* opening the sheet must never fail because of this */ }
}

// Draws the Setup tab (keeping everything already filled in) and the Devices tab. Never draws over a tab called
// Setup that is not ours - it says so and stops. With every setting filled in it then runs the Firebase steps:
// services, web app, keys, page site, page upload, watcher, link and QR. Safe to run again at any time.
// Which sheet the Setup tab was last drawn in, kept on the tab itself (developer metadata copies with the sheet).
// In a copy it names the original, so the copy knows its Setup tab is not its own yet.
var PFS_BOOK_KEY = 'pfs-book';
function pfsMarkBook_(tab, id) {
  tab.getDeveloperMetadata().forEach(function (m) { if (m.getKey() === PFS_BOOK_KEY) m.remove(); });
  tab.addDeveloperMetadata(PFS_BOOK_KEY, id);
}

// Opened as a copy of a sheet that was set up (18 Nov, the cold test showed LIVE with someone else's link):
// keep the owner's picks, drop the Firebase project, draw it as not set up, take the QR away. Runs once per copy.
function pfsCopyCheck_(book) {
  var tab = book.getSheetByName(SETUPTAB.TAB_NAME);
  if (!tab) return;
  var was = tab.getDeveloperMetadata().filter(function (m) { return m.getKey() === PFS_BOOK_KEY; }).map(function (m) { return m.getValue(); })[0];
  if (!was || was === book.getId()) return;
  var current = tab.getDataRange().getDisplayValues();
  if (!SETUPTAB.isOurs(current)) return;
  var headers = {}, tabs = book.getSheets().map(function (s) {
    var name = s.getName(), last = s.getLastColumn();
    headers[name] = last ? s.getRange(1, 1, 1, last).getDisplayValues()[0] : [];
    return name;
  });
  var built = SETUPTAB.build({ name: book.getName(), tabs: tabs, headers: headers, owner: pfsOwner_(book) }, SETUPTAB.forCopy(current), {});
  var s = SETUP.read(built.rows).settings;
  setupDraw_(tab, built, s.colour);
  pfsPlaceQr_(tab, built, null);
  // The original's devices are not this copy's: its Devices tab starts empty (cold test: the original owner's devices were listed).
  var devices = book.getSheetByName(PHONETAB.TAB_NAME);
  if (devices) phonesDraw_(devices, PHONETAB.frame(s.appName, { on: 0, waiting: 0, gone: 0 }), [], s.colour);
  pfsMarkBook_(tab, book.getId());
}

function pfsSetUp() {
  // How long each part takes goes to the log (cold test 2: a run that only said "still to fill in" took 52 seconds).
  var clock = Date.now(), lap = function (what) { Logger.log('Set up timing - ' + what + ': ' + Math.round((Date.now() - clock) / 100) / 10 + ' s'); };
  var book = pfsBook_();
  if (MENU.isMaster(book.getId())) { pfsSay_(MENU.MASTER_SAY); return; }   // the shared master is never set up
  // Google's Allow screen lets people untick single permissions. With one missing a step would fail halfway, so ask
  // again for all of them first (Google shows its box and stops this run). Not there on older Apps Script: skipped.
  if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  lap('permissions');
  pfsCopyCheck_(book);
  lap('copy check');
  var tab = book.getSheetByName(SETUPTAB.TAB_NAME), headers = {};
  var current = tab ? tab.getDataRange().getDisplayValues() : [];
  if (tab && !SETUPTAB.isOurs(current)) {
    pfsSay_('This sheet already has a tab called ' + SETUPTAB.TAB_NAME + ' that is not ours, so nothing was changed. Rename that tab, then run Set up again.');
    return;
  }
  if (tab && SETUPTAB.isOurs(current)) {   // a renamed tab: Setup shows its new name before anything is read
    var wanted = SETUP.read(current).settings.tab;
    if (wanted) { runFollowTab_(book, wanted); current = tab.getDataRange().getDisplayValues(); }
  }
  var tabs = book.getSheets().map(function (s) {
    var name = s.getName(), last = s.getLastColumn();
    headers[name] = last ? s.getRange(1, 1, 1, last).getDisplayValues()[0] : [];
    return name;
  });
  if (!tab) tab = book.insertSheet(SETUPTAB.TAB_NAME, 0);
  var shown = {}, io = pfsHands_(book, shown), info = { name: book.getName(), tabs: tabs, headers: headers, owner: pfsOwner_(book) };
  var built = SETUPTAB.build(info, current, STEPS.facts(io)), read = SETUP.read(built.rows), s = read.settings;
  var problems = read.problems.concat(built.stale || []);   // a picked column that is gone stops it here, not at step 6
  if (problems.length) {   // not ready for the Firebase steps yet: draw, and say what is still to fill in
    // Anything typed since the tab was read is kept (cold test 2: a project typed while Set up ran was drawn over).
    var now = tab.getDataRange().getDisplayValues();
    if (SETUPTAB.typedDuring(current, now).length) {
      current = now; built = SETUPTAB.build(info, current, STEPS.facts(io)); read = SETUP.read(built.rows); s = read.settings;
      problems = read.problems.concat(built.stale || []);
    }
    lap('read');
    setupDraw_(tab, built, s.colour);
    lap('Setup tab drawn');
    pfsPlaceQr_(tab, built, built.page ? STEPS.qrPicture(built.page.url) : null);
    runSyncPhones_(book, s);
    lap('Devices tab');
    pfsOrderTabs_(book, tab, s);
    pfsMarkBook_(tab, book.getId());
    pfsSay_(problems.length ? 'The Setup and ' + PHONETAB.TAB_NAME + ' tabs are ready. Still to fill in on Setup: ' + problems.join(' ') + ' Then run Set up again.'
      : 'Everything is filled in now. Run Set up again.');
    return;
  }
  try { book.toast('Setting up - this takes about a minute.', MENU.TITLE, 90); } catch (e) { /* no sheet open (test rig) */ }
  lap('read');
  var facts = STEPS.run({ project: s.firebaseProject, appName: s.appName, colour: s.colour, backupMinutes: s.backupMinutes,
    version: MENU.VERSION + (typeof PFS_BUILD === 'undefined' ? '' : '+' + PFS_BUILD), files: PFS_PAGE_FILES }, io);   // any new paste is published again
  // The steps take a minute: draw from the tab as it is NOW, so anything typed meanwhile is kept, and say so.
  var now2 = tab.getDataRange().getDisplayValues(), late = SETUPTAB.typedDuring(current, now2);
  lap('steps');
  built = SETUPTAB.build(info, now2, facts);
  setupDraw_(tab, built, s.colour);
  lap('Setup tab drawn');
  pfsPlaceQr_(tab, built, shown.png || (built.page ? STEPS.qrPicture(built.page.url) : null));
  runSyncPhones_(book, s);
  pfsOrderTabs_(book, tab, s);
  pfsMarkBook_(tab, book.getId());
  if (late.length) { pfsSay_(STEPS.summary(facts) + ' You changed ' + late.join(', ') + ' while Set up was running. It is kept - run Set up again to use it.'); return; }
  // Finished: open the share box with the QR straight away, because a QR placed on the sheet only shows after a
  // reload (ruling A, 18 Nov 9pm).
  if (STEPS.finished(facts)) pfsShowShare_(facts.page, s, STEPS.summary(facts));
  else pfsSay_(STEPS.summary(facts));
}

// Setup first, unless the owner said they are making an AppSheet app from this sheet: then their tab goes first,
// because AppSheet builds a new app from the first tab (18 Nov). The sheet is left showing Setup.
function pfsOrderTabs_(book, setupTab, s) {
  try {
    var theirs = s.tab ? book.getSheetByName(s.tab) : null;
    if (s.appsheetFirst && theirs) { book.setActiveSheet(theirs); book.moveActiveSheet(1); }
    else { book.setActiveSheet(setupTab); book.moveActiveSheet(1); }
    book.setActiveSheet(setupTab);
  } catch (e) { Logger.log('Could not move the tabs: ' + e.message); }
}

// Share the sign-up page: the QR code big, the link, and a Copy button, in a box over the sheet (18 Nov).
function pfsShare() {
  var page = PropertiesService.getScriptProperties().getProperty('PFS_PAGE');
  if (!page) { pfsSay_(MENU.shareMissing()); return; }
  var setup = pfsBook_().getSheetByName(SETUPTAB.TAB_NAME), s = setup ? SETUP.read(setup.getDataRange().getDisplayValues()).settings : {};
  pfsShowShare_(page, s, '');
}
// The share box: the QR big, the link and a Copy button. lead = a first line (Set up's "All done"), or ''.
function pfsShowShare_(page, s, lead) {
  var png = Utilities.base64Encode(pfsSigned_(STEPS.qrPicture(page)));
  var html = HtmlService.createHtmlOutput(MENU.shareHtml(page, png, s.appName || MENU.TITLE, s.colour, lead)).setWidth(360).setHeight(lead ? 510 : 470);
  try { SpreadsheetApp.getUi().showModalDialog(html, 'Share the sign-up page'); } catch (e) { Logger.log((lead ? lead + ' ' : '') + page); }
}

// Anything that stops it (settings still to fill in, Set up not run yet) is told to the owner in plain words.
function pfsSendTest() {
  try { pfsSendTest_(); } catch (e) { pfsSay_('Send me a test could not run: ' + String(e.message || e).replace('Setup problems: ', '').split(' | ').join(' ')); }
}
function pfsSendTest_() {
  // A copied sheet still remembers the first sheet's devices until Set up has run in it: never send to those.
  if (STEPS.isCopy(pfsHands_(pfsBook_(), {}))) { pfsSay_('This sheet is a copy and has not been set up yet. Run Set up first.'); return; }
  var book = pfsBook_(), s = runSettings_(book), phones = runSyncPhones_(book, s), byId = runPhoneRecords_();
  var list = phones.map(function (p) { return byId[p.id]; }).filter(function (ph) { return !!ph; });
  var msg = MENU.testMessage(s.appName);
  var sent = list.length ? stage3PushTo_(list, { title: msg.title, body: msg.body, at: Date.now(), navigate: PFS_ENV.page() }) : [];
  var ok = sent.filter(function (r) { return r.code >= 200 && r.code < 300; }).length;
  pfsSay_(MENU.testText({ sent: ok, failed: sent.length - ok }));
}

// Reads one version number from our GitHub page. Never changes any code. (The repo is not made yet, so for now
// this says it couldn't check.)
var PFS_VERSION_URL = 'https://raw.githubusercontent.com/sheet-works/push-from-sheet/main/VERSION';
function pfsCheckUpdate() {
  var latest = '';
  try {
    var r = UrlFetchApp.fetch(PFS_VERSION_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) latest = r.getContentText();
  } catch (e) { latest = ''; }
  pfsSay_(MENU.updateText(MENU.VERSION, latest));
}

function pfsTurnOff() {
  var triggers = ScriptApp.getProjectTriggers();
  var mine = MENU.ours(triggers.map(function (t) { return t.getHandlerFunction(); }));
  mine.forEach(function (i) { ScriptApp.deleteTrigger(triggers[i]); });
  pfsSay_(MENU.offText(mine.length));
}
