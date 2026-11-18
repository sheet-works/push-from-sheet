// engine.js - decides, for each new row in the owner's tab, what the notification says and which phones get it,
// and writes the note that goes back into the row's Notified cell.
// SPEC_V1.md: a new row with a title and a blank Notified is sent. Push To blank = every let-in phone;
// Push To with names or emails = only those phones. The link column (e.g. the AppSheet record) is what a tap opens.
// It never touches Apps Script: the caller hands in the header row, the rows as text, the settings and the phones.
// Runs in Apps Script and in Node (for the tests).

var ENGINE = (function () {
  'use strict';

  var SENDING = 'Sending...';           // written into a row BEFORE its push goes, so a failed run is never sent again and again
  var SOON = 'Sending soon...';         // 18 Nov: a new row waits until it has sat unchanged (Setup's Wait before sending), so a row typed by hand goes out complete
  var OLD = 'Old row - not sent';       // written into rows that were already there when the owner turned it on
  var AGAIN = 'Sending again...';       // written into a stuck row BEFORE its one second try (go-ahead, 18 Nov)
  var GAVE_UP = 'Failed twice - may not have been sent';   // a row whose second try also died. It is never tried a third time
  var STUCK_MINUTES = 10;               // a row still on Sending... this long after its run started is stuck (a run cannot last that long)
  var MAX_TITLE = 100, MAX_BODY = 500;  // longer words are cut, ending in ...
  var MAX_AT_ONCE = 10;                // ruling 17 Nov: more new rows than this in one run (an import) are not sent
  var TOO_MANY = 'Not sent - too many new rows at once';
  var SPLIT = new RegExp('[,;\\n]');    // Push To may list people split by commas, semicolons or new lines

  function cell(row, i) {
    var v = row[i];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }
  function cut(text, max) { return text.length > max ? text.slice(0, max - 3) + '...' : text; }
  function key(text) { return String(text || '').trim().toLowerCase(); }

  // Where each named column is, counting from 0. A name that is not in the header is refused by name.
  function finder(header) {
    var names = header.map(function (h) { return String(h).trim(); });
    return function (name) {
      var i = names.indexOf(String(name).trim());
      if (i < 0) throw new Error('No column called "' + name + '"');
      return i;
    };
  }

  // Which phones a Push To cell means. Blank = every phone. Otherwise each name or email, matched without caring
  // about capitals or spaces, picks every phone with that name or email. Names that pick nothing come back as unknown.
  function pick(pushTo, phones) {
    var asked = pushTo.split(SPLIT).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
    if (!asked.length) return { phoneIds: phones.map(function (p) { return p.id; }), unknown: [] };
    var chosen = {}, unknown = [];
    asked.forEach(function (who) {
      var k = key(who), found = false;
      phones.forEach(function (p) {
        if (key(p.name) === k || key(p.email) === k) { chosen[p.id] = true; found = true; }
      });
      if (!found) unknown.push(who);
    });
    return { phoneIds: phones.filter(function (p) { return chosen[p.id]; }).map(function (p) { return p.id; }), unknown: unknown };
  }

  // One plan per new row, oldest first: { row, title, body, navigate, phoneIds, unknown }.
  // retry = true (the 10-minute backup check, when quiet() says so): rows stuck on Sending... are planned again, with retry: true.
  // What a tap may open (18 Nov). links = 'any': any https site. Otherwise (the default) only AppSheet and Google
  // addresses: AppSheet record links, Maps, Drive, Docs. Gives '' when the link is fine, or the reason it is skipped.
  var HOST = new RegExp('^https://([^/?#:@]+)(?::[0-9]+)?(?:[/?#]|$)', 'i');
  var SAFE_HOSTS = ['appsheet.com', 'google.com', 'goo.gl'];
  function linkProblem(link, links) {
    var m = HOST.exec(link);
    if (!m) return 'links must start with https://';
    if (links === 'any') return '';
    var host = m[1].toLowerCase();
    var ok = SAFE_HOSTS.some(function (h) { return host === h || host.slice(-(h.length + 1)) === '.' + h; });
    return ok ? '' : 'only AppSheet and Google links';
  }

  // settings = { title: column, message: column or list of columns, notified: column, pushTo: column (optional), link: column (optional) }
  // phones = [{ id, name, email }] - the let-in phones. page = the owner's phone page (opened when there is no link).
  function plan(header, rows, settings, phones, page, retry) {
    var col = finder(header);
    var t = col(settings.title), n = col(settings.notified);
    var m = (Array.isArray(settings.message) ? settings.message : [settings.message]).map(col);
    var to = settings.pushTo ? col(settings.pushTo) : -1;
    var ln = settings.link ? col(settings.link) : -1;
    var out = [];
    rows.forEach(function (r, i) {
      var title = cell(r, t), mark = cell(r, n);
      var again = !!retry && mark === SENDING;
      if (title === '' || (mark !== '' && mark !== SOON && !again)) return;
      var body = m.map(function (c) { return cell(r, c); }).filter(function (w) { return w !== ''; }).join(', ');
      var link = ln >= 0 ? cell(r, ln) : '';
      var who = pick(to >= 0 ? cell(r, to) : '', phones);
      var why = link === '' ? '' : linkProblem(link, settings.links);
      var p = { row: i, title: cut(title, MAX_TITLE), body: cut(body, MAX_BODY), navigate: link !== '' && !why ? link : page,
        phoneIds: who.phoneIds, unknown: who.unknown };
      if (why) p.linkSkipped = why;
      if (again) p.retry = true;
      out.push(p);
    });
    return out;
  }

  // The wait. pending() = the rows waiting to go, by row number, each with all its words (every cell except Notified).
  // settled() = the rows that were waiting at the first look and have not changed at all by the second look.
  function pending(header, rows, settings) {
    var col = finder(header), t = col(settings.title), n = col(settings.notified), out = {};
    rows.forEach(function (r, i) {
      var mark = cell(r, n);
      if (cell(r, t) === '' || (mark !== '' && mark !== SOON)) return;
      out[i] = JSON.stringify(header.map(function (h, c) { return c === n ? '' : cell(r, c); }));
    });
    return out;
  }
  function settled(before, after) {
    return Object.keys(after).filter(function (i) { return before[i] === after[i]; }).map(Number);
  }
  // The plans that may go now: second tries always, new rows only when settled (rows = null means there is no wait).
  function ready(plans, rows) {
    return rows ? plans.filter(function (p) { return !!p.retry || rows.indexOf(p.row) >= 0; }) : plans;
  }

  // The rows whose second try also died (still on AGAIN). The backup check marks them GAVE_UP when quiet() says so.
  function failedTwice(header, rows, settings) {
    var n = finder(header)(settings.notified), out = [];
    rows.forEach(function (r, i) { if (cell(r, n) === AGAIN) out.push(i); });
    return out;
  }

  // May stuck rows be tried again? Only when every run that marked rows started STUCK_MINUTES or more ago.
  // starts = the start times (ms, as numbers or text) of runs that marked rows and have not finished. A broken time counts as old.
  function quiet(starts, now) {
    return !starts.some(function (s) { return Number(s) > now - STUCK_MINUTES * 60000; });
  }

  // Splits a run's plans into those to send and the rows to mark TOO_MANY (every new row, when there are more than MAX_AT_ONCE).
  // Second tries are always sent and do not count toward the limit.
  function batch(plans) {
    var fresh = plans.filter(function (p) { return !p.retry; });
    if (fresh.length > MAX_AT_ONCE) return { send: plans.filter(function (p) { return !!p.retry; }), skip: fresh.map(function (p) { return p.row; }) };
    return { send: plans, skip: [] };
  }

  // The note written back into Notified after sending. result = { sent, failed, unknown, retry }. Never empty.
  function note(result, clockText) {
    var text;
    if (result.sent) text = 'Sent ' + clockText + ' to ' + result.sent + (result.sent === 1 ? ' device' : ' devices') + (result.failed ? ', ' + result.failed + ' failed' : '');
    else text = 'Not sent ' + clockText + (result.failed ? ' - ' + result.failed + ' failed' : (result.unknown.length ? '' : ' - no devices to send to'));
    if (result.unknown.length) text += ' - no device for ' + result.unknown.join(', ');
    if (result.linkSkipped) text += ' - link skipped (' + result.linkSkipped + ')';
    if (result.retry) text += ' (second try)';
    return text;
  }

  return { pending: pending, settled: settled, ready: ready, SOON: SOON, plan: plan, batch: batch, note: note, failedTwice: failedTwice, quiet: quiet, SENDING: SENDING, AGAIN: AGAIN, GAVE_UP: GAVE_UP, OLD: OLD, TOO_MANY: TOO_MANY,
    MAX_AT_ONCE: MAX_AT_ONCE, STUCK_MINUTES: STUCK_MINUTES };
})();

if (typeof module !== 'undefined') module.exports = ENGINE;
