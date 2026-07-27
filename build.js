#!/usr/bin/env node
/*
 * Build script for "Alienation DN Card DB".
 *
 *   node build.js            Parse database.csv -> inject into src/template.html -> index.html
 *   node build.js --fetch    Re-download database.csv from the Google Sheet first, then build
 *
 * The Google Sheet is published to the web (read-only). gid=0 is the raw "Database" tab.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CSV = path.join(ROOT, 'database.csv');
const TEMPLATE = path.join(ROOT, 'src', 'template.html');
const LOGO = path.join(ROOT, 'assets', 'dn-logo.png');
const CLASSES_DIR = path.join(ROOT, 'assets', 'classes');
const OUT = path.join(ROOT, 'index.html');

const SHEET_ID = '1vTvRW7hDA5tGE-BXDQrCC3Sf74EdNvcoNhUVbSLLYOY';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

const RARITIES = ['Magic', 'Rare', 'Epic', 'Unique', 'Legend'];

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
    if (a && b) { cur = { no: parseInt(a, 10), name: b, nest, stats: [] }; cards.push(cur); }
    if (stat && cur) {
      const vals = [c[3], c[4], c[5], c[6], c[7]].map(v => {
        const n = parseInt((v || '').trim(), 10);
        return isNaN(n) ? null : n;
      });
      if (vals.some(v => v !== null)) cur.stats.push({ stat, values: vals });
    }
  }

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
    process.stdout.write('Fetching latest CSV from Google Sheet… ');
    const csv = await download(CSV_URL);
    fs.writeFileSync(CSV, csv);
    console.log('saved ' + csv.length + ' bytes');
  }

  if (!fs.existsSync(CSV)) { console.error('Missing database.csv (run with --fetch to download it).'); process.exit(1); }
  if (!fs.existsSync(TEMPLATE)) { console.error('Missing src/template.html'); process.exit(1); }

  const db = parse(fs.readFileSync(CSV, 'utf8'));
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  if (!tpl.includes('__DATA__')) { console.error('Template has no __DATA__ placeholder'); process.exit(1); }

  let html = tpl.replace('__DATA__', JSON.stringify(db));

  // Embed the Dragon Nest logo as a base64 data URI so the app stays self-contained.
  if (html.includes('__LOGO__')) {
    if (!fs.existsSync(LOGO)) { console.error('Missing assets/dn-logo.png'); process.exit(1); }
    const b64 = fs.readFileSync(LOGO).toString('base64');
    html = html.replace('__LOGO__', 'data:image/png;base64,' + b64);
  }

  // Embed the class icons as a { "Class Name": dataURI } map.
  if (html.includes('__CLASSES__')) {
    const map = {};
    if (fs.existsSync(CLASSES_DIR)) {
      for (const f of fs.readdirSync(CLASSES_DIR).sort()) {
        const full = path.join(CLASSES_DIR, f);
        if (!fs.statSync(full).isFile()) continue;
        const buf = fs.readFileSync(full);
        const mime = buf.slice(0, 4).toString('latin1') === 'RIFF' ? 'image/webp'
                   : buf[0] === 0x89 ? 'image/png'
                   : buf.slice(0, 3).toString('latin1') === 'GIF' ? 'image/gif'
                   : 'image/jpeg';
        const name = f.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        map[name] = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
    html = html.replace('__CLASSES__', JSON.stringify(map));
    console.log('Embedded ' + Object.keys(map).length + ' class icons');
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
