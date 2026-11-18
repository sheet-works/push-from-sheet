// setup.js - reads the owner's settings off the Setup tab and says plainly what is wrong.
// Look B (the pick, 17 Nov 2026): each setting is a label in column B with its value in column C.
// Settings are found by their LABEL, not their row, so moving or adding rows never breaks it.
// It never touches Apps Script: the caller hands in the tab's displayed values (getDisplayValues).
// Runs in Apps Script and in Node (for the tests).

var SETUP = (function () {
  'use strict';

  var REPO = 'github.com/sheet-works/push-from-sheet';   // one truth: where the code and README live
  var VERSION = '1.0';                      // the one version number (the menu's Check for update and the Setup tab use it)
  var NOTIFIED = 'Notified';                 // the column the script writes its note into (added if missing)
  // 18 Nov: the owner picks a plain colour name from a dropdown; a code like #1565C0 still works for an exact brand colour.
  var COLOURS = { Blue: '#1565C0', Navy: '#1A237E', Green: '#2E7D32', Teal: '#00796B', Red: '#C62828', Orange: '#EF6C00',
    Purple: '#6A1B9A', Pink: '#AD1457', Grey: '#546E7A', Black: '#212121' };
  var DEFAULT_COLOUR_NAME = 'Blue', DEFAULT_COLOUR = COLOURS.Blue;
  var APPSHEET_LABEL = 'Making an AppSheet app?';   // 18 Nov: the longer label was cut off in its column
  var LINKS_LABEL = 'Links can open', LINKS_GOOGLE = 'AppSheet and Google only', LINKS_ANY = 'Any website';
  // 18 Nov (cold test): the message is up to three single picks, each its own dropdown, joined in order.
  var MESSAGE_LABELS = ['Message column', 'Message column 2 (optional)', 'Message column 3 (optional)'];
  // 18 Nov: a row typed by hand is sent once it has sat unchanged this long, so it goes out complete.
  // Off = at once (AppSheet adds a whole row in one go). Blank follows the AppSheet answer.
  var WAIT_LABEL = 'Wait before sending', WAIT_CHOICES = ['Off', '30 seconds', '1 minute'], WAIT_SECONDS = [0, 30, 60];
  function waitDefault(appsheet) { return appsheet ? WAIT_CHOICES[0] : WAIT_CHOICES[1]; }
  var MAX_APP_NAME = 30;                     // a Home Screen name has to stay short
  var PROJECT_LABEL = 'Firebase project address', OLD_PROJECT_LABELS = ['Firebase project name', 'Firebase project ID'];   // one truth for the row's name
  var PROJECT_SHAPE = new RegExp('^[a-z][a-z0-9-]{4,28}[a-z0-9]$'); // Firebase project IDs: 6 to 30 characters
  // 18 Nov: the owner may paste the address of their project page instead (.../project/THE-ID/... or ...?project=THE-ID).
  var PROJECT_IN_LINK = new RegExp('[/?&]project[/=]([^/?&#]+)');
  var SPACES = new RegExp(' +');
  // 18 Nov: how often the backup check runs is the owner's pick. Google's timers come in 1, 5, 10, 15 or 30 minutes;
  // 1 is not offered because it would use more than a free account's daily allowance. 0 = off.
  var BACKUP_CHOICES = [5, 10, 15, 30], BACKUP_DEFAULT = 10;
  var BACKUP_SHAPE = new RegExp('^([0-9]+) ?(min|mins|minute|minutes)?$');
  var COLOUR_SHAPE = new RegExp('^#[0-9A-F]{6}$');
  var DRIVE_ID = new RegExp('^[A-Za-z0-9_-]{20,}$');
  var DRIVE_LINK = new RegExp('^https://drive\\.google\\.com/(?:file/d/([A-Za-z0-9_-]{20,})|open\\?id=([A-Za-z0-9_-]{20,}))');

  function text(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }

  // label -> value, from column B and column C of every row.
  function pairs(grid) {
    var out = {};
    (grid || []).forEach(function (row) {
      if (!row) return;
      var label = text(row[1]);
      if (label !== '' && !(label in out)) out[label] = text(row[2]);
    });
    return out;
  }

  // 'Green' (any case) or '#2e7d32' -> '#2E7D32'. Anything else -> ''.
  function colourOf(v) {
    var t = text(v);
    for (var n in COLOURS) if (n.toLowerCase() === t.toLowerCase()) return COLOURS[n];
    return COLOUR_SHAPE.test(t.toUpperCase()) ? t.toUpperCase() : '';
  }

  function driveId(v) {
    if (DRIVE_ID.test(v)) return v;
    var m = v.match(DRIVE_LINK);
    return m ? (m[1] || m[2]) : '';
  }

  // { settings, problems } - problems are plain sentences for the owner, in the order the settings appear.
  function read(grid) {
    var p = pairs(grid), problems = [];
    var get = function (label) { return p[label] || ''; };

    // 18 Nov 9:15pm: one way only - copy the project page's address from the address bar and paste it in. The ID is
    // taken out of the address exactly as it is. A bare ID or name still works (the old labels are still read).
    var typed = [PROJECT_LABEL].concat(OLD_PROJECT_LABELS).map(get).filter(function (v) { return v !== ''; })[0] || '', inLink = PROJECT_IN_LINK.exec(typed);
    var project = inLink ? inLink[1] : typed.toLowerCase().split(SPACES).join('-');
    var pasteIt = 'open your project in Firebase, copy the address from the address bar and paste it here (step 1).';
    if (typed === '') problems.push(PROJECT_LABEL + ' is empty - ' + pasteIt);
    else if (!PROJECT_SHAPE.test(project)) problems.push(PROJECT_LABEL + ' "' + typed + '" is not the address of a Firebase project - ' + pasteIt);

    var appName = get('App name');
    if (appName === '') problems.push('App name is empty.');
    else if (appName.length > MAX_APP_NAME) problems.push('App name is too long - ' + MAX_APP_NAME + ' characters at most.');

    var colourText = get('Colour'), colour = colourOf(colourText);
    if (colourText !== '' && !colour) problems.push('Colour "' + colourText + '" is not one of the colours in the list or a code like ' + DEFAULT_COLOUR + ' - using ' + DEFAULT_COLOUR_NAME + '.');
    colour = colour || DEFAULT_COLOUR;

    var iconText = get('Icon'), icon = '';
    if (iconText !== '' && iconText.toLowerCase() !== 'plain default') {
      icon = driveId(iconText);
      if (icon === '') problems.push('Icon "' + iconText + '" is not a Drive link - using the plain default.');
    }

    var tab = get('Tab with your rows');
    if (tab === '') problems.push('Tab with your rows is empty.');
    var title = get('Title column');
    if (title === '') problems.push('Title column is empty.');
    var message = MESSAGE_LABELS.map(get).join(',').split(',').map(text).filter(function (m) { return m !== ''; });
    if (!message.length) problems.push('Message column is empty.');
    var pushTo = get('Push To column'), link = get('Link to open');

    var signupText = get('Sign-ups'), signup = signupText.toLowerCase() === 'open' ? 'open' : 'approve';
    if (signupText !== '' && signup !== 'open' && signupText.toLowerCase() !== 'approve') problems.push('Sign-ups "' + signupText + '" should be Open or Approve - using Approve.');

    // 18 Nov: AppSheet builds a new app from the FIRST tab, so Yes moves the owner's tab first at Set up.
    var appsheetText = get(APPSHEET_LABEL).toLowerCase(), appsheetFirst = appsheetText === 'yes';
    if (appsheetText !== '' && appsheetText !== 'yes' && appsheetText !== 'no') problems.push(APPSHEET_LABEL + ' "' + get(APPSHEET_LABEL) + '" should be Yes or No - using No.');
    // 18 Nov: what a tap may open. The safe one is the default (stops a fake page that looks like it came from the boss).
    var linksText = get(LINKS_LABEL), links = linksText.toLowerCase() === LINKS_ANY.toLowerCase() ? 'any' : 'google';
    if (linksText !== '' && links !== 'any' && linksText.toLowerCase() !== LINKS_GOOGLE.toLowerCase()) problems.push(LINKS_LABEL + ' "' + linksText + '" should be ' + LINKS_GOOGLE + ', or ' + LINKS_ANY + ' - using ' + LINKS_GOOGLE + '.');

    var waitText = get(WAIT_LABEL) || waitDefault(appsheetFirst), waitAt = WAIT_CHOICES.map(function (c) { return c.toLowerCase(); }).indexOf(waitText.toLowerCase());
    if (waitAt < 0) { problems.push(WAIT_LABEL + ' "' + waitText + '" should be Off, 30 seconds or 1 minute - using 30 seconds.'); waitAt = 1; }

    var backupText = get('Backup check'), backup = BACKUP_DEFAULT, asked = BACKUP_SHAPE.exec(backupText.toLowerCase());
    if (backupText.toLowerCase() === 'off') backup = 0;
    else if (asked && BACKUP_CHOICES.indexOf(Number(asked[1])) >= 0) backup = Number(asked[1]);
    else if (backupText !== '') problems.push('Backup check "' + backupText + '" should be Off, 5, 10, 15 or 30 minutes - using ' + BACKUP_DEFAULT + '.');

    // The same column must not do two jobs, and none may be the script's own Notified column.
    var jobs = [['Title', title]].concat(message.map(function (m) { return ['Message', m]; }), [['Push To', pushTo], ['Link', link]]);
    jobs.forEach(function (j) { if (j[1] === NOTIFIED) problems.push('"' + NOTIFIED + '" is kept for the script - pick another ' + j[0] + ' column.'); });
    for (var a = 0; a < jobs.length; a++) {
      for (var b = a + 1; b < jobs.length; b++) {
        if (jobs[a][1] !== '' && jobs[a][1] === jobs[b][1] && jobs[a][1] !== NOTIFIED) {
          problems.push('The ' + jobs[a][0] + ' column and the ' + jobs[b][0] + ' column are the same column ("' + jobs[a][1] + '").');
        }
      }
    }

    return {
      settings: { firebaseProject: project, appName: appName, colour: colour, icon: icon, tab: tab, title: title, message: message,
        pushTo: pushTo, link: link, notified: NOTIFIED, signup: signup, backupMinutes: backup, appsheetFirst: appsheetFirst, links: links, waitSeconds: WAIT_SECONDS[waitAt] },
      problems: problems
    };
  }

  return { REPO: REPO, PROJECT_LABEL: PROJECT_LABEL, OLD_PROJECT_LABELS: OLD_PROJECT_LABELS, MESSAGE_LABELS: MESSAGE_LABELS, WAIT_LABEL: WAIT_LABEL, WAIT_CHOICES: WAIT_CHOICES, waitDefault: waitDefault, read: read, pairs: pairs, VERSION: VERSION, NOTIFIED: NOTIFIED, BACKUP_CHOICES: BACKUP_CHOICES, BACKUP_DEFAULT: BACKUP_DEFAULT, MAX_APP_NAME: MAX_APP_NAME,
    DEFAULT_COLOUR: DEFAULT_COLOUR, DEFAULT_COLOUR_NAME: DEFAULT_COLOUR_NAME, COLOURS: COLOURS, colourOf: colourOf,
    APPSHEET_LABEL: APPSHEET_LABEL, LINKS_LABEL: LINKS_LABEL, LINKS_GOOGLE: LINKS_GOOGLE, LINKS_ANY: LINKS_ANY };
})();

if (typeof module !== 'undefined') module.exports = SETUP;
