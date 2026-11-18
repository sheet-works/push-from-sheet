'use strict';
// Tests for menu.js - the 'Push from sheet' menu in the owner's sheet (SPEC_V1: Set up, Send me a test, Check for update, Turn off).
// Run: node --test test-menu.js   (always name the test files)
// Rule: written BEFORE menu.js and seen to fail first.
const test = require('node:test');
const assert = require('node:assert/strict');
const MENU = require(process.env.MENU || './menu.js');
const SETUP = require(process.env.SETUP || './setup.js');

test('the menu is called Push from sheet and has the four items from the spec, in order, each with its function', () => {
  assert.equal(MENU.TITLE, 'Push from sheet');
  assert.deepEqual(MENU.items(), [{ name: 'Set up', fn: 'pfsSetUp' }, { name: 'Share the sign-up page', fn: 'pfsShare' },
    { name: 'Send me a test', fn: 'pfsSendTest' }, { name: 'Check for update', fn: 'pfsCheckUpdate' }, { name: 'Turn off', fn: 'pfsTurnOff' }]);
});

test('the test notification says which app it is from and that it worked, and never comes out empty', () => {
  assert.deepEqual(MENU.testMessage('Smith Cutting Jobs'), { title: 'Test from Smith Cutting Jobs', body: 'If you can read this, notifications work on this device.' });
  assert.deepEqual(MENU.testMessage(''), { title: 'Test from Push from sheet', body: 'If you can read this, notifications work on this device.' });
  assert.deepEqual(MENU.testMessage('  '), { title: 'Test from Push from sheet', body: 'If you can read this, notifications work on this device.' });
});

test('there is one version number, kept in setup.js, and the Setup tab shows that same one', () => {
  assert.match(SETUP.VERSION, /^\d+\.\d+(\.\d+)?$/);
  assert.equal(MENU.VERSION, SETUP.VERSION);
});

test('Check for update: a higher version out there is news, the same or lower is not', () => {
  assert.equal(MENU.newer('1.0', '1.1'), true);
  assert.equal(MENU.newer('1.0', '2.0'), true);
  assert.equal(MENU.newer('1.9', '1.10'), true, 'numbers, not letters: 10 is more than 9');
  assert.equal(MENU.newer('1.0', '1.0.1'), true);
  assert.equal(MENU.newer('1.0', '1.0'), false);
  assert.equal(MENU.newer('1.0.0', '1.0'), false);
  assert.equal(MENU.newer('1.2', '1.1'), false);
  assert.equal(MENU.newer('2.0', '1.9.9'), false);
});

test('Check for update: whatever comes back that is not a version is never news (a broken page must not nag)', () => {
  ['', 'Not Found', '<html>', 'v', '1.x', null, undefined].forEach(bad => assert.equal(MENU.newer('1.0', bad), false, String(bad)));
  assert.equal(MENU.newer('1.0', ' 1.1\n'), true, 'spaces and a new line around it are fine');
  assert.equal(MENU.newer('1.0', 'v1.1'), true, 'a leading v is fine');
});

test('Check for update: the words the owner sees, and they never say it changed their code', () => {
  assert.equal(MENU.updateText('1.0', '1.0'), "You're up to date (version 1.0).");
  assert.equal(MENU.updateText('1.0', '1.1'), 'Version 1.1 is out (you have 1.0). Get it from github.com/sheet-works/push-from-sheet - nothing here was changed.');
  assert.equal(MENU.updateText('1.0', ''), "Couldn't check for an update just now. Try again later.");
  assert.equal(MENU.updateText('1.2', '1.1'), "You're up to date (version 1.2).");
});

test('Turn off: removes only our own triggers, by name, and says what it kept', () => {
  const triggers = ['runOnChange', 'runTimer', 'myOtherScript', 'onEdit', 'runOnChange'];
  assert.deepEqual(MENU.ours(triggers), [0, 1, 4]);
  assert.deepEqual(MENU.OWN_TRIGGERS, ['runOnChange', 'runTimer']);
  assert.equal(MENU.offText(3), 'Turned off: 3 watchers removed. Your devices and settings are kept - Set up turns it back on.');
  assert.equal(MENU.offText(1), 'Turned off: 1 watcher removed. Your devices and settings are kept - Set up turns it back on.');
  assert.equal(MENU.offText(0), 'It was already off. Your devices and settings are kept - Set up turns it back on.');
});

test('Send me a test: the owner hears how it went, in plain words', () => {
  assert.equal(MENU.testText({ sent: 3, failed: 0 }), 'Test sent to 3 devices. Each should show "Test from ..." now.');
  assert.equal(MENU.testText({ sent: 1, failed: 0 }), 'Test sent to 1 device. It should show "Test from ..." now.');
  assert.equal(MENU.testText({ sent: 2, failed: 1 }), 'Test sent to 2 devices. Each should show "Test from ..." now. 1 failed - see its Status on the Devices tab.');
  assert.equal(MENU.testText({ sent: 0, failed: 0 }), 'No devices are let in yet. Open the sign-up page on a phone or computer, tap Turn on, then tick it on the Devices tab.');
  assert.equal(MENU.testText({ sent: 0, failed: 2 }), 'The test did not reach any device (2 failed) - see Status on the Devices tab.');
});

test('Check for update: a version with junk after it is not a version', () => {
  ['2.0abc', '1.1 beta', '1.1-rc'].forEach(bad => assert.equal(MENU.newer('1.0', bad), false, bad));
});

test('Check for update: a leading v is not shown back to the owner', () => {
  assert.equal(MENU.updateText('1.0', 'v1.1'), 'Version 1.1 is out (you have 1.0). Get it from github.com/sheet-works/push-from-sheet - nothing here was changed.');
});

// ---- 18 Nov (make the link and QR easy to share): Share the sign-up page shows them big, with a Copy button ----
test('the share box shows the QR picture, the address and a Copy button, in the owner\'s colour', () => {
  const html = MENU.shareHtml('https://smith-cutting-a1b2c3.web.app/', 'iVBORw0KGgo=', 'Smith Cutting', '#2E7D32');
  assert.ok(html.indexOf('src="data:image/png;base64,iVBORw0KGgo="') > 0, 'the QR picture');
  assert.ok(html.indexOf('https://smith-cutting-a1b2c3.web.app/') > 0, 'the address');
  assert.ok(/<button[^>]*>Copy link<\/button>/.test(html), 'a Copy button');
  assert.ok(html.indexOf('#2E7D32') > 0, 'the owner colour');
  assert.match(html, /Scan this with a phone camera, or send the link\. Each person taps Turn on notifications\./);
});

test('the share box cannot be broken by a name or address with HTML in it', () => {
  const html = MENU.shareHtml('https://x.web.app/?a="b"<c>', 'AAA=', '<b>Bob</b> & Co', 'red;}');
  assert.ok(html.indexOf('<b>Bob') < 0 && html.indexOf('&lt;b&gt;Bob&lt;/b&gt; &amp; Co') > 0);
  assert.ok(html.indexOf('"b"<c>') < 0);
  assert.ok(html.indexOf('red;}') < 0, 'a colour that is not a colour is not used');
});

test('with no page yet, Share says to run Set up first', () => {
  assert.equal(MENU.shareMissing(), 'There is no sign-up page yet. Run Set up first.');
});

test('master sheet: Set up refuses there and says to make a copy (18 Nov, same as Drive Galaxy)', () => {
  assert.ok(Array.isArray(MENU.MASTERS) && MENU.MASTERS.length >= 1);
  assert.equal(MENU.isMaster(MENU.MASTERS[0]), true);
  assert.equal(MENU.isMaster('someone-elses-copy'), false);
  assert.equal(MENU.isMaster(''), false);
  assert.match(MENU.MASTER_SAY, /master/i);
  assert.match(MENU.MASTER_SAY, /File\s*›\s*Make a copy/);
});

// ---- cold test 2, ruling A 9:00pm: Set up ends by opening the share box, because a placed QR only shows after a reload ----
test('the share box can carry a first line (Set up\'s "All done"), escaped; without it the box is as before', () => {
  const plain = MENU.shareHtml('https://x.web.app/', 'AAA=', 'Smith', '#2E7D32');
  const led = MENU.shareHtml('https://x.web.app/', 'AAA=', 'Smith', '#2E7D32', 'All done. <b>Go</b>');
  assert.ok(led.indexOf('All done. &lt;b&gt;Go&lt;/b&gt;') >= 0);
  assert.ok(led.indexOf('All done.') < led.indexOf('Smith'), 'the line comes first');
  assert.equal(plain.indexOf('All done'), -1);
});

test('a newer version says where to get it: the repo itself', () => {
  assert.match(MENU.updateText('1.0', '1.1'), /github\.com\/sheet-works\/push-from-sheet/);
});
