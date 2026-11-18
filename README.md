# Push from sheet

Free push notifications to phones and computers, sent by a Google Sheet.

Add a row to your sheet, by hand or from an AppSheet app, and a notification pops up on every phone you have let in. It shows the row's words, like a text message.

- **Free.** No subscription, no paid service, no app from an app store.
- **Nobody in the middle.** Everything runs in your own Google account: the sheet's own script sends the notifications, and the sign-up page sits on your own free Firebase project. Nothing passes through us.
- **iPhone, Android and computers.** iPhone needs iOS 16.4 or later and the page added to the Home Screen. Android and computers just tap Turn on.

Free, as is, MIT licence. Made by Jarrod (eskimo joe).

---

## Set it up (about 10 minutes)

You need a Google account. That's all.

### 1. Copy the sheet

Open the copy link: **[Make a copy of Push from sheet](https://docs.google.com/spreadsheets/d/1cEkCkMDHR85XqrXljxhCz8w_LEZTNxWlts5GbpybLyA/copy)**

Google shows a yellow warning: *"The attached Apps Script file and functionality will also be copied."* That's expected. The script is the part that sends the notifications, and the copy is yours alone.

Signed in to more than one Google account? Check the picture at the top right of each page you open is the account you want to own the sheet.

### 2. Make a free Firebase project

On the **Setup** tab, row "Firebase project address":

1. Click **Open Firebase ›** and make a project. Any name will do.
2. Switch off the Developer Program, Gemini and Analytics. They are not needed.
3. Open the project, copy the address from your browser's address bar, and paste it into the white box.

Firebase is Google's. Its free plan (Spark) is all this needs. Paste the address rather than typing the name: Google often adds a few letters to a project's ID, and the address always has the right one.

### 3. Two once-only Google switches

Still on the Setup tab:

- **Open the terms ›** and click **Accept** if Google shows a button. (Once per Google account.)
- **Open the switch ›** and turn **Google Apps Script API** to **On**.

### 4. Run Set up

Menu: **Push from sheet › Set up**

Google asks you to allow the script. *"Google hasn't verified this app"* is normal: it's your own copy, and the developer it names is you. Click **Advanced › Go to Push from sheet**, tick **Select all**, then **Continue**. Run Set up again if it stops after the permission screen.

Set up takes about half a minute. It ticks each step as it goes and shows **LIVE** when it's done. Then a box opens with your sign-up page's link and QR code.

### 5. Sign phones up

Open the sign-up page on each phone or computer. Scan the QR code, or send the link.

- **iPhone:** in Safari, tap Share › **Add to Home Screen**, open it from the Home Screen icon, then tap **Turn on notifications**. iPhones only allow notifications from apps on the Home Screen.
- **Android and computers:** tap **Turn on notifications**, then **Allow**.

Each device shows a short name, like **5BD4**.

### 6. Let them in

Open the **Devices** tab. New devices wait for your tick. Tick **Let in** and they're on. You can untick to stop one, or delete its row to remove it. Type a name in the Name column if you like.

(Set **Sign-ups** to *Open* on the Setup tab if you'd rather anyone with the link gets in without a tick.)

### 7. Add a row

Add a row to your tab. A few seconds later it pops up on every device you let in. The **Notified** column says when it went, and to how many devices.

To test without adding a row: **Push from sheet › Send me a test**.

---

## The settings

All on the Setup tab, mostly dropdowns:

| Setting | What it does |
|---|---|
| App name | The name shown on phones. Starts as the sheet's name. |
| Colour | The colour of the sign-up page, the icon and the Setup tab. |
| Tab with your rows | The tab whose new rows are sent. |
| Making an AppSheet app? | Yes moves your tab first (AppSheet builds an app from the first tab) and sends at once. |
| Title column | The bold first line of the notification. |
| Message column (and 2, 3) | The line underneath. Extra columns are added with a comma. |
| Push To column | Optional. Names or emails from the Devices tab. A blank cell sends to everyone you let in. |
| Link to open | Optional. A column of links. Tapping the notification opens that row's link, like its AppSheet record. |
| Links can open | AppSheet and Google only (the safe one), or any website. |
| Wait before sending | Time to finish typing a row before it's sent. Off sends at once, which suits AppSheet. |
| Sign-ups | Approve (each device waits for your tick) or Open. |
| Backup check | Every few minutes, sends any row Google missed. Run Set up again after changing it. |

## Good to know

- **Who can send:** anyone who can add a row to your tab can send a notification. Only let people you trust add rows.
- **Google's daily allowance:** Apps Script has a daily allowance of run time, shared by all your scripts. The backup check uses about 11 minutes a day at the 10-minute setting. Free accounts get 90 minutes a day.
- **How the words travel:** each notification is locked (encrypted) for the one device it's going to, then handed to that device's own push service (Apple's, Google's, Mozilla's or Microsoft's). They pass it on without being able to read it.
- **Where things are kept:** the device list is in your sheet. The keys are in your sheet's script. The sign-up page sits on your Firebase project.
- **Updates:** Push from sheet › Check for update tells you if there's a newer version and where to get it. Nothing updates by itself.
- **To stop for good:** Push from sheet › Turn off, then bin the sheet.

## The code

Everything in the sheet's script is in this repository. Each piece runs both in Apps Script and in Node (for the tests).

| File | What it does |
|---|---|
| `es256.js` | Signs the push pass (ES256, P-256), with no outside library. |
| `lock.js` | Locks the words inside the push for one device (Web Push encryption, RFC 8291). |
| `push.js` | Builds the push request for a device's push service. |
| `hub.js` | Sign-ups, sign-outs and the device list, from the script's side. |
| `engine.js` | Which rows to send, to whom, and the notes written back. |
| `setup.js`, `setuptab.js`, `steps.js` | Reads the Setup tab, draws it, and runs Set up's Google steps. |
| `phonetab.js`, `menu.js`, `png.js`, `qr.js` | The Devices tab, the menu, the icon and the QR code (made in the script, so the link never passes through another site). |
| `*-apps-script.js` | The parts that only run in Apps Script. |
| `stage3/index.html`, `stage3/sw.js` | The sign-up page and its service worker. Set up uploads them to your Firebase project. |
| `build.py` | Joins the pieces into `SHARE - paste into the sheet's Apps Script.gs`. |
| `appsscript.json` | The script's manifest: the permissions it asks for. |

To set it up by hand: make a sheet, open Extensions › Apps Script, paste the built file into Code.gs, replace appsscript.json with the one here (show it under Project Settings), save, reload the sheet, and carry on from step 2.

Tests: `node --test test*.js`. They were written before the code, and each piece has been broken on purpose to check the tests notice (`mutants.py`, `mutants-steps.py`).

## Credit

This is not the first time Web Push has been signed inside Apps Script. Others did it before us, in their own app projects:

- [andres1-dev/two](https://github.com/andres1-dev/two) (`P9/NotificacionesGAS.txt`)
- [77sevenbox-git-it/Sevenboxapp](https://github.com/77sevenbox-git-it/Sevenboxapp) (`oyuncaq-magaza/apps-script/Code.gs`)
- [sqaz2/mftnb](https://github.com/sqaz2/mftnb) (`backend/owner-notifications.gs`)
- [maxwellbw/household-hq](https://github.com/maxwellbw/household-hq) (`backend/WebPush.js`, using SJCL)
- [desvandi/PLTSMonitoring_Firmware-Backend](https://github.com/desvandi/PLTSMonitoring_Firmware-Backend) (`push-alarm/gas/WebPushCore.gs`)
- [NyckolasBotero/zoe-app](https://github.com/NyckolasBotero/zoe-app) (its first design; it later moved sending to a Cloudflare Worker)

What Push from sheet adds is the packaging: a sheet anyone can copy and set up, for AppSheet apps and plain sheets alike.

## Licence

MIT. Free, as is, no warranty. See [LICENSE](LICENSE).
