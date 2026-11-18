// run-apps-script.js - Apps Script only. The version 1 engine against the owner's sheet: reads the Setup tab
// (look B labels), watches the tab named there, and for each new row plans (ENGINE), locks the words for each
// device (LOCK) and sends (PUSH), then writes the Notified note. Which sheet, which Setup tab and which devices
// come from PFS_ENV (the test rig and the shared sheet each have their own small env file).
// One stored record per run that has marked rows Sending... and not finished: its name starts with this, its value is when it started.
var RUN_PENDING = 'run-sending-';

function runSettings_(book) {
  var tab = book.getSheetByName(PFS_ENV.setupTab);
  if (!tab) throw new Error('No tab called ' + PFS_ENV.setupTab);
  var r = SETUP.read(tab.getDataRange().getDisplayValues());
  if (r.problems.length) throw new Error('Setup problems: ' + r.problems.join(' | '));
  return r.settings;
}

// The owner's tab, its header and rows. Adds the Notified column at the end if it is missing.
function runRead_() {
  var book = PFS_ENV.book(), s = runSettings_(book);
  s.tab = runFollowTab_(book, s.tab);
  var sheet = book.getSheetByName(s.tab);
  if (!sheet) throw new Error('No tab called ' + s.tab);
  var all = sheet.getDataRange().getDisplayValues(), header = all[0];
  if (header.map(function (h) { return h.trim(); }).indexOf(s.notified) < 0) {
    sheet.getRange(1, header.length + 1).setValue(s.notified);
    SpreadsheetApp.flush();
    all = sheet.getDataRange().getDisplayValues(); header = all[0];
  }
  return { sheet: sheet, settings: s, header: header, rows: all.slice(1) };
}

// The owner's tab is remembered by Google's own ID for it (18 Nov). If it was renamed, the Setup cell is
// changed to the new name, so nothing breaks. The "Tab with your rows" dropdown is refreshed with the tabs as they are now.
// Gives the tab name to use.
function runFollowTab_(book, wanted) {
  var props = PropertiesService.getScriptProperties(), stored = props.getProperty('PFS_TAB_ID');
  var tabs = book.getSheets().map(function (sh) { return { name: sh.getName(), id: sh.getSheetId() }; });
  var r = SETUPTAB.followTab(wanted, stored === null ? null : Number(stored), tabs);
  if (r.id !== null) props.setProperty('PFS_TAB_ID', String(r.id));
  var setup = book.getSheetByName(PFS_ENV.setupTab);
  if (setup) {
    var labels = setup.getRange(1, 2, setup.getLastRow() || 1, 1).getDisplayValues();
    for (var i = 0; i < labels.length; i++) {
      if (String(labels[i][0]).trim() !== 'Tab with your rows') continue;
      var cell = setup.getRange(i + 1, 3), list = SETUPTAB.ownerTabs(tabs.map(function (t) { return t.name; }));
      if (list.length) cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
      if (r.renamed) { cell.setValue(r.name); Logger.log('Your tab was renamed - Setup now says ' + r.name + '.'); }
      break;
    }
  }
  return r.name;
}

function runNote_(t, rowIndexes, text) {
  var col = t.header.map(function (h) { return h.trim(); }).indexOf(t.settings.notified) + 1;
  rowIndexes.forEach(function (i) { t.sheet.getRange(i + 2, col).setValue(text); });
  SpreadsheetApp.flush();
}

// Brings the Devices tab (look B, the pick; called Devices since 18 Nov 12:59pm) and the stored phones into step
// (PHONETAB.sync): the owner's ticks, names and deleted rows go into the store, and the tab gets the latest details.
// The first time, the rows of the old 'Phones' tab (header in row 1) are moved across; the old tab is left alone.
// The whole tab is drawn only when it is new, its header is not where look B puts it, or the rows have outgrown it;
// otherwise only the rows and the counts are written, so an ordinary send stays quick.
// Gives back the devices the engine may send to (PFS_ENV.keep: the test rig sends to its own two only).
// held = the caller already holds the script lock and keeps it (run_): this must not take or release it. Found 18 Nov
// in the rehearsal: releasing here let run_ carry on unlocked while it marked rows Sending, so two runs starting in the
// same second could both have sent a row. (How I know: Google's notes say releaseLock lets waiting runs go; not seen live.)
function runSyncPhones_(book, settings, held) {
  var s = settings || runSettings_(book), width = PHONETAB.HEADER.length;
  var blank = PHONETAB.frame('', { on: 0, waiting: 0, gone: 0 }), first = blank.firstDataRow, col = blank.firstCol;
  var tab = book.getSheetByName(PHONETAB.TAB_NAME), rows = [], moved = 0, last;
  if (tab) {
    last = tab.getLastRow();
    rows = last >= first ? tab.getRange(first, col, last - first + 1, width).getValues() : [];
  } else {
    var old = PFS_ENV.oldPhonesTab ? book.getSheetByName(PFS_ENV.oldPhonesTab) : null;
    if (old && old.getLastRow() > 1) { rows = old.getRange(2, 1, old.getLastRow() - 1, width).getValues(); moved = rows.length; }
    tab = book.insertSheet(PHONETAB.TAB_NAME);
  }
  var store = stage3Store_(), lock = LockService.getScriptLock(), r;
  if (!held) lock.waitLock(20000);
  try {
    r = PHONETAB.sync(PUSHHUB.records(store), rows, 20, function (ms) {
      return ms ? Utilities.formatDate(new Date(ms), pfsZone_(), 'd MMM h:mm a').replace('AM', 'am').replace('PM', 'pm') : '';
    });
    r.changes.forEach(function (c) { PUSHHUB.update(store, c); });
  } finally {
    if (!held) lock.releaseLock();
  }
  var frame = PHONETAB.frame(s.appName, r.counts);
  var header = tab.getRange(frame.headerRow, col, 1, width - 1).getDisplayValues()[0].join('|');
  // A full redraw when the tab is not ours yet, is too short, or the owner changed the colour (cold test: Devices stayed blue).
  var tint = String(tab.getTabColor() || '').toUpperCase();
  if (header !== PHONETAB.HEADER.slice(0, width - 1).join('|') || tab.getMaxRows() < first + r.rows.length + 1 || tint !== String(s.colour).toUpperCase()) phonesDraw_(tab, frame, r.rows, s.colour);
  else phonesFill_(tab, frame, r.rows);
  if (moved) Logger.log('MOVED ' + moved + ' row(s) from the old ' + PFS_ENV.oldPhonesTab + ' tab to ' + PHONETAB.TAB_NAME + '. The old tab is left as it was.');
  return PFS_ENV.keep(r.phones);
}

// The stored record (endpoint and keys) for each phone the engine picked.
function runPhoneRecords_() {
  var byId = {};
  PUSHHUB.phones(stage3Store_()).forEach(function (ph) { byId[ph.id] = ph; });
  return byId;
}

// The start times of runs that marked rows and have not finished (a dead run's record stays behind).
function runPending_() {
  var p = PropertiesService.getScriptProperties(), out = {};
  p.getKeys().forEach(function (k) { if (k.indexOf(RUN_PENDING) === 0) out[k] = p.getProperty(k); });
  return out;
}

// Runs by itself whenever the sheet changes (and can be run by hand from the editor).
function runOnChange() { run_(false); }

// ruling 18 Nov (cold test: a row typed by hand went out with only its title): with Setup's "Wait before sending"
// on, a new row is marked Sending soon... and sent once it has sat unchanged for that long. Each change to the sheet
// starts its own run; only the NEWEST run keeps waiting (the others stop within 5 seconds), so typing a row costs about
// its typing time plus the wait, once. Called holding the lock; gives back { t, rows } holding the lock again
// (rows = the settled rows, or null when there is no wait), or null when this run should stop.
var RUN_WAIT = 'pfs-wait';
function runWait_(t, lock, props) {
  var wait = t.settings.waitSeconds, before, now, rows = [], me, s, round;
  if (!wait) return { t: t, rows: null };
  before = ENGINE.pending(t.header, t.rows, t.settings);
  if (!Object.keys(before).length) return { t: t, rows: [] };
  me = Utilities.getUuid(); props.setProperty(RUN_WAIT, me);
  for (round = 0; round < 3; round++) {
    runNote_(t, Object.keys(before).map(Number), ENGINE.SOON);
    lock.releaseLock();
    for (s = 0; s < wait; s += 5) {
      Utilities.sleep(Math.min(5, wait - s) * 1000);
      if (props.getProperty(RUN_WAIT) !== me) { Logger.log('A newer change is doing the waiting - this run stops.'); return null; }
    }
    if (!lock.tryLock(20000)) return null;
    t = runRead_();
    now = ENGINE.pending(t.header, t.rows, t.settings);
    rows = ENGINE.settled(before, now);
    if (rows.length === Object.keys(now).length) break;   // everything waiting has settled
    before = now;                                           // something is still being typed: wait again (3 rounds at most)
  }
  return { t: t, rows: rows };
}

// The backup check (go-ahead, 18 Nov). Runs by itself as often as the Setup tab says (10 minutes unless changed). It sends rows that a change run missed
// (Google now and then fails a run before it starts), and gives a row stuck on Sending... ONE second try once every
// run that marked rows is at least 10 minutes old. A row whose second try also died is marked as failed twice.
// When there is nothing to do it stops after one read of the sheet, to save the daily allowance.
function runTimer() { run_(true); }

// The Sending... note is written BEFORE anything is sent, so a failed run never sends the same row again and again.
function run_(fromTimer) {
  var lock = LockService.getScriptLock(), props = PropertiesService.getScriptProperties();
  var t, phones, plans, b, pending, retry = false, dead, mine = '', w;
  var rowOf = function (p) { return p.row; };
  if (!lock.tryLock(20000)) return;
  try {
    t = runRead_();
    if (fromTimer) {
      pending = runPending_();
      retry = ENGINE.quiet(Object.keys(pending).map(function (k) { return pending[k]; }), Date.now());
      if (retry) {
        Object.keys(pending).forEach(function (k) { props.deleteProperty(k); });
        dead = ENGINE.failedTwice(t.header, t.rows, t.settings);
        if (dead.length) { runNote_(t, dead, ENGINE.GAVE_UP); Logger.log('FAILED TWICE: ' + dead.length + ' row(s) marked ' + ENGINE.GAVE_UP); }
      }
      if (!ENGINE.plan(t.header, t.rows, t.settings, [], PFS_ENV.page(), retry).length) { Logger.log('Backup check: nothing waiting.'); return; }
    }
    w = runWait_(t, lock, props);
    if (!w) return;
    t = w.t;
    phones = runSyncPhones_(PFS_ENV.book(), t.settings, true);
    plans = ENGINE.ready(ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page(), retry), w.rows);
    if (!plans.length) { Logger.log(w.rows && Object.keys(ENGINE.pending(t.header, t.rows, t.settings)).length ? 'A row is still being typed - it goes when it has sat unchanged.' : 'Nothing new.'); return; }
    b = ENGINE.batch(plans);
    if (b.send.length) { mine = RUN_PENDING + Utilities.getUuid(); props.setProperty(mine, String(Date.now())); }
    if (b.skip.length) runNote_(t, b.skip, ENGINE.TOO_MANY);
    runNote_(t, b.send.filter(function (p) { return !p.retry; }).map(rowOf), ENGINE.SENDING);
    runNote_(t, b.send.filter(function (p) { return !!p.retry; }).map(rowOf), ENGINE.AGAIN);
  } finally {
    lock.releaseLock();
  }
  var byId = runPhoneRecords_();
  b.send.forEach(function (p) {
    var list = p.phoneIds.map(function (id) { return byId[id]; }).filter(function (ph) { return !!ph; });
    var sent = list.length ? stage3PushTo_(list, { title: p.title, body: p.body, at: Date.now(), navigate: p.navigate }) : [];
    var ok = sent.filter(function (s) { return s.code >= 200 && s.code < 300; }).length;
    var note = ENGINE.note({ sent: ok, failed: sent.length - ok, unknown: p.unknown, retry: !!p.retry, linkSkipped: p.linkSkipped }, stage3Clock_(Date.now()));
    runNote_(t, [p.row], note);
    Logger.log((fromTimer ? 'BACKUP CHECK ' : '') + 'ROW ' + (p.row + 2) + ': ' + p.title + ' / ' + p.body + ' -> ' + note + String.fromCharCode(10) + stage3Lines_(sent).join(String.fromCharCode(10)));
  });
  if (mine) props.deleteProperty(mine);
  if (b.skip.length) Logger.log('TOO MANY: ' + b.skip.length + ' rows marked ' + ENGINE.TOO_MANY);
}

// Run once. Rows already in the tab are marked so they are never sent, then the sheet is watched
// and the backup check is started, as often as the Setup tab's 'Backup check' says (Off, 5, 10, 15 or 30 minutes; blank = 10). Also removes the old join-test watcher so only one thing watches the sheet.
function runTurnOn() {
  var t = runRead_();
  var old = ENGINE.plan(t.header, t.rows, t.settings, [], PFS_ENV.page()).map(function (p) { return p.row; });
  runNote_(t, old, ENGINE.OLD);
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var f = tr.getHandlerFunction();
    if (f === 'runOnChange' || f === 'runTimer' || f === 'joinOnChange') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('runOnChange').forSpreadsheet(PFS_ENV.book()).onChange().create();
  if (t.settings.backupMinutes) ScriptApp.newTrigger('runTimer').timeBased().everyMinutes(t.settings.backupMinutes).create();
  Logger.log('ON, ' + (t.settings.backupMinutes ? 'with a backup check every ' + t.settings.backupMinutes + ' minutes' : 'with NO backup check (Backup check is Off in Setup)') + '. Watching tab ' + t.settings.tab + ' (title: ' + t.settings.title + ', message: ' + t.settings.message.join(', ') + ', Push To: ' + (t.settings.pushTo || '-') +
    '). Old rows marked: ' + old.length + '. Phones it may send to: ' + runSyncPhones_(PFS_ENV.book()).map(function (p) { return p.id.slice(0, 4).toUpperCase() + (p.name ? ' (' + p.name + ')' : ''); }).join(', '));
}

function runTurnOff() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var f = tr.getHandlerFunction();
    if (f === 'runOnChange' || f === 'runTimer') { ScriptApp.deleteTrigger(tr); n++; }
  });
  Logger.log('OFF. Watcher and backup check removed: ' + n);
}

// Checks the settings and shows what would happen, without sending or writing anything.
function runCheck() {
  var t = runRead_(), phones = runSyncPhones_(PFS_ENV.book());
  var plans = ENGINE.plan(t.header, t.rows, t.settings, phones, PFS_ENV.page());
  Logger.log('SETTINGS OK: ' + JSON.stringify(t.settings) + String.fromCharCode(10) + 'Phones: ' + phones.map(function (p) { return p.id.slice(0, 4).toUpperCase() + ' ' + (p.name || '(no name)') + ' ' + p.email; }).join(', ') + '. New rows waiting: ' + plans.length +
    String.fromCharCode(10) + plans.map(function (p) { return 'row ' + (p.row + 2) + ': ' + p.title + ' / ' + p.body + ' -> ' + p.phoneIds.length + ' phone(s)' + (p.unknown.length ? ', no phone for ' + p.unknown.join(', ') : ''); }).join(String.fromCharCode(10)));
}
