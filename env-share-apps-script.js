// env-share-apps-script.js - Apps Script only. For the sheet we share: the script lives INSIDE the owner's
// sheet, reads its Setup tab, sends to every device the owner let in, and keeps its own sending key and page
// address in its own private storage (Set up makes them - the Firebase steps).
var PFS_ENV = {
  book: function () { return SpreadsheetApp.getActiveSpreadsheet(); },
  setupTab: 'Setup',
  oldPhonesTab: '',
  keyProp: 'PFS_SENDING_KEY',
  page: function () { return PropertiesService.getScriptProperties().getProperty('PFS_PAGE') || ''; },
  signup: function () {
    var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Setup');
    return tab ? SETUP.read(tab.getDataRange().getDisplayValues()).settings.signup : 'approve';
  },
  keep: function (phones) { return phones; }
};
