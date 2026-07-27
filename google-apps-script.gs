/**
 * Alienation DN Companion App — Google Sheet sync backend
 * ------------------------------------------------------------------
 * One Google Sheet stores BOTH the Character roster and the Guild
 * storage list (in two tabs: "Roster" and "Storage"), so they sync
 * across your devices / your guild.
 *
 * SETUP (one time, ~2 minutes):
 *   1. Create a Google Sheet (any blank one).
 *   2. Extensions ▸ Apps Script.  Delete the sample code, paste ALL of this.
 *   3. Click Deploy ▸ New deployment ▸ (gear) Web app.
 *        - Execute as:  Me
 *        - Who has access:  Anyone
 *      Deploy, authorise when prompted, then copy the Web app URL
 *      (it ends with /exec).
 *   4. In the app: open Character Details or Guild Storage ▸ Connect
 *      Google Sheet ▸ paste that URL. Use "Copy sheet link" to move it
 *      to another device.
 *
 * If you change this script later, redeploy: Deploy ▸ Manage deployments
 * ▸ (pencil) ▸ Version: New version ▸ Deploy (keeps the same /exec URL).
 *
 * The /exec URL is a capability link — anyone who has it can read/write,
 * so only share it with people you want to edit this data.
 * (Optional: set SECRET below; the app would then need to send it.)
 */

var SHEETS = { roster: 'Roster', storage: 'Storage' };
var SECRET = '';   // leave '' for no password

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function read_(name) {
  var vals = sheet_(name).getDataRange().getValues();
  if (!vals || vals.length === 0) return { header: [], rows: [] };
  return { header: vals[0], rows: vals.slice(1) };
}

function write_(name, header, rows) {
  var s = sheet_(name);
  s.clear();
  var data = [header].concat(rows || []);
  if (data.length && header.length) {
    s.getRange(1, 1, data.length, header.length).setValues(data);
  }
}

function all_() {
  return { roster: read_(SHEETS.roster), storage: read_(SHEETS.storage) };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_(all_());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var b = JSON.parse(e.postData.contents);
    if (SECRET && b.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    if (b.action === 'saveAll') {
      if (b.roster)  write_(SHEETS.roster,  b.roster.header  || [], b.roster.rows  || []);
      if (b.storage) write_(SHEETS.storage, b.storage.header || [], b.storage.rows || []);
      return json_({ ok: true });
    }
    if (b.action === 'save') {           // single dataset (which: 'roster' | 'storage')
      var name = b.which === 'storage' ? SHEETS.storage : SHEETS.roster;
      write_(name, b.header || [], b.rows || []);
      return json_({ ok: true });
    }
    return json_(all_());
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
