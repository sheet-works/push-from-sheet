// phonetab.js - keeps the owner's Phones tab and the script's stored phones in step (SPEC_V1, look B).
// The owner types Name, ticks or unticks Let in, and deletes rows. The script fills everything else.
// The tab is where names live (Push To matches them); the store is where keys and the let-in flag live.
// It never touches Apps Script: the caller hands in the stored records and the tab's rows, and applies what comes back.
// Runs in Apps Script and in Node (for the tests).

var PHONETAB = (function () {
  'use strict';

  var HEADER = ['Name', 'Email', 'Device', 'Let in', 'Signed up', 'Last seen', 'Last message', 'Status', 'ID'];
  var NAME = 0, EMAIL = 1, DEVICE = 2, LETIN = 3, ID = 8;
  var ON = 'On', WAITING = 'Waiting for your tick', STOPPED = 'Stopped - tick Let in to start it again';
  var GONE = 'Gone (its push service says so) - delete this row', NO_KEYS = 'Needs to open the page again';

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  // A device's short name: the first 4 of its ID in capitals. The page shows the same ("This phone's name is 5BD4") and
  // hub.js asks this one for it, so the owner can match the phone in their hand to its row on Devices.
  function shortName(id) { return text(id).slice(0, 4).toUpperCase(); }
  function ticked(v) { return v === true || text(v).toUpperCase() === 'TRUE'; }

  // records = every stored phone (let in or waiting): { id, approved, stopped, listed, added, lastSeen, lastSend, email, device, keys }
  // rows = the tab's data rows (below the header), as getValues gives them. maxPhones = the most that may be let in.
  // fmt = turns a time in ms into text for the tab ('' when never).
  // Gives back { rows: the tab's new data rows, changes: [{ id, approved?, stopped?, listed?, remove? }] for the store,
  //              phones: [{ id, name, email }] the engine may send to, counts: { on, waiting, gone } }.
  function sync(records, rows, maxPhones, fmt) {
    var byId = {}, seen = {}, entries = [], others = [], changes = [];
    records.forEach(function (r) { byId[r.id] = r; });

    (rows || []).forEach(function (r) {
      var id = text(r[ID]);
      if (id === '') { if (r.some(function (c) { return text(c) !== ''; })) others.push(r); return; }
      if (seen[id]) return;
      seen[id] = true;
      entries.push({ id: id, rec: byId[id] || null, name: text(r[NAME]), tick: ticked(r[LETIN]), row: r });
    });
    records.forEach(function (r) {
      if (seen[r.id]) return;
      if (r.listed) { changes.push({ id: r.id, remove: true }); return; }
      entries.push({ id: r.id, rec: r, name: shortName(r.id), isNew: true });   // the name its page shows (cold test 2)
      changes.push({ id: r.id, listed: true });
    });

    // Phones already let in and still ticked keep their place; newly ticked ones get in while there is room.
    var kept = entries.filter(function (e) { return e.rec && !e.isNew && e.tick && e.rec.approved; }).length;
    var tabChanges = [];
    entries.forEach(function (e) {
      if (!e.rec) return;
      e.approved = e.rec.approved === true;
      e.stopped = e.rec.stopped === true;
      if (e.isNew) return;
      if (e.tick && !e.approved) {
        if (kept >= maxPhones) { e.full = true; return; }
        kept++;
        e.approved = true;
        var c = { id: e.id, approved: true };
        if (e.stopped) { c.stopped = false; e.stopped = false; }
        tabChanges.push(c);
      } else if (!e.tick && e.approved) {
        e.approved = false; e.stopped = true;
        tabChanges.push({ id: e.id, approved: false, stopped: true });
      }
    });
    changes = tabChanges.concat(changes);

    var out = [], phones = [], counts = { on: 0, waiting: 0, gone: 0 };
    entries.forEach(function (e) {
      if (!e.rec) {
        counts.gone++;
        out.push([e.name, text(e.row[EMAIL]), text(e.row[DEVICE]), false, e.row[4], e.row[5], e.row[6], GONE, e.id]);
        return;
      }
      var status;
      if (e.full) status = 'Full - untick another device first (most is ' + maxPhones + ')';
      else if (e.approved) status = e.rec.keys ? ON : NO_KEYS;
      else status = e.stopped ? STOPPED : WAITING;
      if (status === ON) { counts.on++; phones.push({ id: e.id, name: e.name, email: e.rec.email || '' }); }
      if (status === WAITING) counts.waiting++;
      out.push([e.name, e.rec.email || '', e.rec.device || '', e.approved, fmt(e.rec.added), fmt(e.rec.lastSeen), fmt(e.rec.lastSend), status, e.id]);
    });
    return { rows: out.concat(others), changes: changes, phones: phones, counts: counts };
  }

  // The tab's frame in look B (mock-up 'B Phones', the pick): row 2 the title, row 3 the counts, row 5 a line of help,
  // row 6 the header. Phone rows go from row 7, starting in column B (column A is the margin). 10 columns, A to J.
  // 18 Nov 12:59pm: notifications for everything, phones AND computers, so the tab is called Devices.
  var TAB_NAME = 'Devices';
  var HELP = 'Tick to let a device in, untick to stop it. Delete a row to remove it. ' +
    'Emails come from the sign-up link and don\'t prove who it is.';
  function frame(appName, counts) {
    var blank = function () { return ['', '', '', '', '', '', '', '', '', '']; };
    var rows = [blank(), blank(), blank(), blank(), blank(), [''].concat(HEADER)];
    rows[1][1] = appName + '  ·  ' + TAB_NAME;
    rows[2][1] = counts.on + ' on'; rows[2][3] = counts.waiting + ' waiting'; rows[2][5] = counts.gone + ' gone';
    rows[4][1] = HELP;
    return { rows: rows, headerRow: 6, firstDataRow: 7, firstCol: 2 };
  }

  // What each status starts with, for the drawing's colour rules (On green, Waiting amber, Gone struck through).
  var STATUS_START = { on: ON, waiting: WAITING.split(' ')[0], gone: GONE.split(' ')[0] };

  return { sync: sync, frame: frame, shortName: shortName, HEADER: HEADER, STATUS_START: STATUS_START, TAB_NAME: TAB_NAME };
})();

if (typeof module !== 'undefined') module.exports = PHONETAB;
