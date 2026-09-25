#!/usr/bin/env node
/*
 * Build script for "Alienation DN Card DB".
 *
 *   node build.js            Parse database.csv -> inject into src/template.html -> index.html
 *   node build.js --fetch    Re-scrape database.csv from the community sheet first, then build
 *
 * Data source: the community-maintained Dragon Nest Classic sheet, "Card" tab. It is
 * shared read-only (no CSV export), and its nest headings live in merged cells that the
 * CSV/gviz exports drop — so --fetch reads the sheet's own HTML grid view and flattens
 * it (colspan/rowspan expanded) into database.csv. Card order in that file is the sheet's
 * row order, which is also the order the in-game Card window lists them in.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CSV = path.join(ROOT, 'database.csv');
const TEMPLATE = path.join(ROOT, 'src', 'template.html');
const LOGO = path.join(ROOT, 'assets', 'dn-logo.png');
const CLASSES_DIR = path.join(ROOT, 'assets', 'classes');
const CARDS_DIR = path.join(ROOT, 'assets', 'cards');
const OUT = path.join(ROOT, 'index.html');

const SHEET_ID = '1bSW0Sn-k8CD-V0YqHxQKLS4c59Sayn_s-8LvdJyosLI';  // community DN Classic sheet
const CARD_GID = '0';                                            // its "Card" tab
const GRID_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview/sheet?headers=true&gid=${CARD_GID}`;

const RARITIES = ['Magic', 'Rare', 'Epic', 'Unique', 'Legend'];

// Cards the community sheet spells differently from the game client. The app shows the
// in-game name everywhere, so they are renamed right after parsing; database.csv itself
// stays a faithful copy of the sheet. The map is also embedded in the page (__NAMEFIX__)
// so a collection saved under an old name follows the rename.
const NAME_FIX = {
  'General Umzaka':                      'Deputy Umzaka',
  'General Umhar':                       'Deputy Umhar',
  'Experiment No.287 Upgraded Tenakrun': 'Experiment No.287 Tenakrun',
  'Experiment No.60 Proto Omega':        'Experiment No.60 Prototype Omega',
  'Experiment No.665 Super Strong XXXX': 'Experiment No.665 Giant XXXX',
  'Centurian Ogre Baopar':               '100-man Leader Ogre Boarba',
  'Engata General Umbala':               'Anjuta Army Leader Wonbla',
  'Chiliarch Titanion':                  'Centurion Titanian'
};

// ---- tiny CSV line parser (handles quoted fields) ----
function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ---- follow redirects and download the CSV ----
function download(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, depth + 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ---- Google Sheets HTML grid -> rows of strings (merged cells expanded) ----
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      return String.fromCodePoint(parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10));
    }
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}
function cellText(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
function htmlGrid(html) {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!body) throw new Error('no <tbody> in the sheet page — is the sheet still shared publicly?');
  const rows = [], pending = {};                       // pending: column -> rowspan carry-over
  for (const tr of body[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const row = [];
    for (const col in pending) {
      if (pending[col].left > 0) { row[col] = pending[col].value; pending[col].left--; }
    }
    let c = 0;
    for (const cell of tr.match(/<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi) || []) {
      const attrs = cell.slice(0, cell.indexOf('>'));
      if (/^<th/i.test(cell) && /id="\d+R\d+"/.test(attrs)) continue;   // row-number gutter
      const cs = +((attrs.match(/colspan="(\d+)"/i) || [])[1] || 1);
      const rs = +((attrs.match(/rowspan="(\d+)"/i) || [])[1] || 1);
      const txt = cellText(cell.replace(/^<[^>]*>/, '').replace(/<\/(td|th)>$/i, ''));
      while (row[c] !== undefined) c++;                                  // skip carried-over cells
      for (let i = 0; i < cs; i++) {
        row[c + i] = i === 0 ? txt : '';
        if (rs > 1) pending[c + i] = { left: rs - 1, value: i === 0 ? txt : '' };
      }
      c += cs;
    }
    rows.push(row);
  }
  return rows;
}
function gridToCSV(rows) {
  const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  return rows.map(r => {
    let end = r.length;
    while (end > 0 && (r[end - 1] === undefined || r[end - 1] === '')) end--;
    const cells = [];
    for (let i = 0; i < end; i++) cells.push(q(r[i] === undefined ? '' : r[i]));
    return cells.join(',');
  }).filter(l => l.length).join('\n') + '\n';
}

// ---- read a directory of images into a { "File Name": dataURI } map ----
function imageMap(dir) {
  const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (!/[.](png|jpe?g|gif|webp)$/i.test(f)) continue;   // skip README and friends
    const buf = fs.readFileSync(full);
    const mime = buf.slice(0, 4).toString('latin1') === 'RIFF' ? 'image/webp'
               : buf[0] === 0x89 ? 'image/png'
               : buf.slice(0, 3).toString('latin1') === 'GIF' ? 'image/gif'
               : 'image/jpeg';
    map[f.replace(/\.[^.]+$/, '').replace(/_/g, ' ')] = `data:${mime};base64,${buf.toString('base64')}`;
  }
  return map;
}

// ---- parse the raw CSV into { meta, cards } ----
function parse(raw) {
  const lines = raw.replace(/\r/g, '').split('\n').filter(l => l.length);
  const cards = [];
  let nest = null, cur = null;

  for (const line of lines) {
    const c = parseCSVLine(line);
    const a = (c[0] || '').trim();
    const b = (c[1] || '').trim();
    const stat = (c[2] || '').trim();

    if (a && !b && a !== 'Card No.' && !stat) { nest = a; continue; } // nest header
    if (a === 'Card No.') continue;                                    // column header
    if (a && b) {
      // the grid repeats the card no./name on each of the card's stat rows, so only
      // start a new card when the number actually changes
      const no = parseInt(a, 10);
      if (isNaN(no)) continue;
      if (!cur || cur.no !== no || cur.name !== b) { cur = { no, name: b, nest, stats: [] }; cards.push(cur); }
    }
    if (stat && cur) {
      const vals = [c[3], c[4], c[5], c[6], c[7]].map(v => {
        const n = parseInt((v || '').trim(), 10);
        return isNaN(n) ? null : n;
      });
      if (vals.some(v => v !== null)) cur.stats.push({ stat, values: vals });
    }
  }

  const unused = Object.keys(NAME_FIX);
  cards.forEach(cd => {
    const fixed = NAME_FIX[cd.name];
    if (!fixed) return;
    const i = unused.indexOf(cd.name);
    if (i >= 0) unused.splice(i, 1);
    cd.name = fixed;
  });
  if (unused.length) console.warn('Note: NAME_FIX has no match for ' + unused.join(', ') + ' — did the sheet rename it?');

  const statSet = new Set();
  cards.forEach(cd => cd.stats.forEach(s => statSet.add(s.stat)));
  const meta = {
    rarities: RARITIES,
    stats: [...statSet].sort(),
    nests: [...new Set(cards.map(c => c.nest))]
  };
  return { meta, cards };
}

(async () => {
  if (process.argv.includes('--fetch')) {
    process.stdout.write('Fetching the community sheet… ');
    const grid = htmlGrid(await download(GRID_URL));
    const csv = gridToCSV(grid);
    if (!/Card No\./.test(csv)) { console.error('\nThat page had no card table — the sheet may have moved or changed sharing.'); process.exit(1); }
    fs.writeFileSync(CSV, csv);
    console.log('saved ' + grid.length + ' rows (' + csv.length + ' bytes)');
  }

  if (!fs.existsSync(CSV)) { console.error('Missing database.csv (run with --fetch to download it).'); process.exit(1); }
  if (!fs.existsSync(TEMPLATE)) { console.error('Missing src/template.html'); process.exit(1); }

  const db = parse(fs.readFileSync(CSV, 'utf8'));
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  if (!tpl.includes('__DATA__')) { console.error('Template has no __DATA__ placeholder'); process.exit(1); }

  let html = tpl.replace('__DATA__', JSON.stringify(db));

  // The sheet-name -> in-game-name map, so saved collections follow a rename.
  if (html.includes('__NAMEFIX__')) html = html.replace('__NAMEFIX__', JSON.stringify(NAME_FIX));

  // Embed the Dragon Nest logo as a base64 data URI so the app stays self-contained.
  if (html.includes('__LOGO__')) {
    if (!fs.existsSync(LOGO)) { console.error('Missing assets/dn-logo.png'); process.exit(1); }
    const b64 = fs.readFileSync(LOGO).toString('base64');
    html = html.replace('__LOGO__', 'data:image/png;base64,' + b64);
  }

  // Embed the class icons as a { "Class Name": dataURI } map.
  if (html.includes('__CLASSES__')) {
    const map = imageMap(CLASSES_DIR);
    html = html.replace('__CLASSES__', JSON.stringify(map));
    console.log('Embedded ' + Object.keys(map).length + ' class icons');
  }

  // Embed monster-card art as a { "Card Name": dataURI } map. Optional: drop PNGs into
  // assets/cards/ named after the card (underscores stand in for spaces) and the card
  // collection modal picks them up; slots without art fall back to the card's initials.
  if (html.includes('__CARDART__')) {
    const map = imageMap(CARDS_DIR);
    html = html.replace('__CARDART__', JSON.stringify(map));
    console.log('Embedded ' + Object.keys(map).length + ' card images');
  }

  // Embed the Apps Script source so the in-app tutorial can offer one-click copy.
  if (html.includes('__APPSCRIPT__')) {
    const p = path.join(ROOT, 'google-apps-script.gs');
    const code = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    html = html.replace('__APPSCRIPT__', JSON.stringify(code));
  }

  fs.writeFileSync(OUT, html);

  const lines = db.cards.reduce((a, c) => a + c.stats.length, 0);
  console.log(`Built index.html — ${db.cards.length} cards, ${db.meta.nests.length} nests, ` +
              `${db.meta.stats.length} stats, ${lines} stat lines (${html.length} bytes)`);
})();
