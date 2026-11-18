// rowpush.js - works out which sheet rows still need a push, and the words to show.
// It never touches Apps Script: the caller hands in the header row and the rows as text.
// A row needs a push when its key column has something in it and its flag column is empty.
// Runs in Apps Script and in Node (for the tests).

var ROWPUSH = (function () {
  'use strict';

  var OLD = 'Old row - not pushed';       // written into rows that were already there at turn-on
  var SENDING = 'Sending...';             // written into a row BEFORE its push goes, so a failed send is never repeated
  var MAX_BODY = 180;                      // longest body we hand to a notification
  var NOTHING = 'Open the app to see it';  // shown when the chosen columns are all empty

  function column(header, name) {
    var i = header.indexOf(name);
    if (i < 0) throw new Error('No column called "' + name + '"');
    return i;
  }
  function cell(row, i) {
    var v = row[i];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  // Positions (counting from 0) of the rows that still need a push.
  function pending(header, rows, keyName, flagName) {
    var k = column(header, keyName), f = column(header, flagName), out = [];
    rows.forEach(function (row, n) {
      if (cell(row, k) !== '' && cell(row, f) === '') out.push(n);
    });
    return out;
  }

  // One notification for everything pending: the newest row's words, and how many more there are.
  function words(header, rows, pendingRows, titleText, bodyColumns) {
    if (!pendingRows.length) throw new Error('Nothing to push');
    var cols = bodyColumns.map(function (name) { return column(header, name); });
    var newest = rows[pendingRows[pendingRows.length - 1]];
    var parts = cols.map(function (i) { return cell(newest, i); }).filter(function (t) { return t !== ''; });
    var body = parts.length ? parts.join(', ') : NOTHING;
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY - 3) + '...';
    var more = pendingRows.length - 1;
    return { title: more ? titleText + ' (+' + more + ' more)' : titleText, body: body };
  }

  // The note written back into the row's flag cell.
  function flagText(phoneCount, clockText) {
    if (!phoneCount) return 'No phones signed up ' + clockText;
    return 'Pushed ' + clockText + ' (' + phoneCount + (phoneCount === 1 ? ' phone)' : ' phones)');
  }

  return { pending: pending, words: words, flagText: flagText, OLD: OLD, SENDING: SENDING };
})();

if (typeof module !== 'undefined') module.exports = ROWPUSH;
