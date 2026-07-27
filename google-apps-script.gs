/**
 * Alienation DN Companion App — Google Sheet sync backend
 * ------------------------------------------------------------------
 * This turns your own Google Sheet into the storage for the Character
 * Details roster, so it syncs across your devices (and your guild).
 *
 * SETUP (one time, ~2 minutes):
 *   1. Create a Google Sheet (any blank one).
 *   2. Extensions ▸ Apps Script.  Delete the sample code, paste ALL of this.
 *   3. Click Deploy ▸ New deployment ▸ (gear) Web app.
 *        - Description: anything
 *        - Execute as:  Me
 *        - Who has access:  Anyone
 *      Deploy, authorise when prompted, then copy the Web app URL
 *      (it ends with /exec).
 *   4. In the app: Character Details ▸ Connect Google Sheet ▸ paste that URL.
 *
 * The /exec URL is a capability link — anyone who has it can read/write
 * this roster, so only share it with people you want to edit it.
 * (Optional: set SECRET below and send it from the app to require a pass.)
 */

var SHEET_NAME = 'Roster';
var SECRET = '';   // leave '' for no password; or set a word and the app must send it

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function read_() {
  var vals = sheet_().getDataRange().getValues();
  if (!vals || vals.length === 0) return { header: [], rows: [] };
  return { header: vals[0], rows: vals.slice(1) };
}

function write_(header, rows) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var s = sheet_();
    s.clear();
    var data = [header].concat(rows || []);
    if (data.length && header.length) {
      s.getRange(1, 1, data.length, header.length).setValues(data);
    }
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_(read_());
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (SECRET && body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
    if (body.action === 'save') {
      write_(body.header || [], body.rows || []);
      return json_({ ok: true });
    }
    return json_(read_());
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
