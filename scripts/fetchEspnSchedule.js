#!/usr/bin/env node
/*
  Fetch and parse an ESPN NHL team schedule page and write a TS schedule file

  Usage:
    node ./scripts/fetchEspnSchedule.js --url=<ESPN schedule url> --season=20252026 --out=./constants/panthersSchedule.ts

  Notes:
  - The script extracts date, month, day, opponent, and time (when present) from the ESPN table.
  - It will preserve any Preseason objects present in the existing constants file (best-effort).
  - Opponent logos are NOT auto-populated; the script will attempt to preserve existing opponentLogo values if the opponent name matches one in the current file.
*/

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const m = arg.match(/^--([^=]+)=?(.*)$/);
    if (m) args[m[1]] = m[2] || true;
  });
  return args;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthIndexFromShort(m) {
  return MONTHS.indexOf(m) + 1;
}

function fetchUrl(url) {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(url).then(r => r.text());
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => raw += c);
      res.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}

function extractPreseasonObjects(existingText) {
  const results = [];
  // crude: find object blocks that contain "type: 'Preseason'"
  const objRe = /\{[\s\S]*?type:\s*'Preseason',[\s\S]*?\},/g;
  let m;
  while ((m = objRe.exec(existingText))) {
    results.push(m[0].replace(/\n\s*/g, '\n  '));
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const url = args.url || 'https://www.espn.com/nhl/team/schedule/_/name/fla/seasontype/2';
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, '..', 'constants', 'panthersSchedule.ts');

  console.log('Fetching ESPN schedule page:', url);
  const html = await fetchUrl(url);

  // Try to build a simple text table by collapsing HTML tags to pipe-separated text.
  // ESPN's fetched content will include table rows like: | Tue, Oct 7 | vs Chicago Chicago | ...
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\|/g, '|');

  // Regex to match rows with date and opponent. Two table formats exist on ESPN pages:
  // 1) Past games: | Tue, Oct 7 | vs Chicago Chicago | W3-2 | ...
  // 2) Future games: | Thu, Jan 22 | @ Winnipeg Winnipeg | 8:00 PM | ...
  const rowRe = /\|\s*([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2})\s*\|\s*(vs|@)\s+([A-Za-z\s\.\'\-]+?)\s*(?:\|\s*([^|]{1,20})\s*\|)?/g;

  const matches = [];
  let m;
  while ((m = rowRe.exec(text))) {
    const weekday = m[1];
    const monthShort = m[2];
    const day = m[3];
    const homeAway = m[4];
    const opponentFull = m[5].trim();
    const thirdCol = (m[6] || '').trim();

    // Determine if thirdCol is a time (contains colon + AM/PM)
    const timeMatch = thirdCol.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const time = timeMatch ? timeMatch[1].toUpperCase() : null;

    matches.push({ monthShort, day, homeAway, opponentFull, time });
  }

  if (matches.length === 0) {
    console.error('No schedule rows parsed from ESPN page. The page layout may differ.');
    process.exit(1);
  }

  // Read existing file to try to preserve preseason objects and opponent logos.
  let existing = '';
  try { existing = fs.readFileSync(out, 'utf8'); } catch (e) { /* ignore */ }

  const preseasonObjects = extractPreseasonObjects(existing);

  // Build a simple opponent -> logo map from existing file
  const logoMap = {};
  if (existing) {
    const logoRe = /opponent:\s*'([^']+)'[\s\S]*?opponentLogo:\s*'([^']+)'/g;
    let l;
    while ((l = logoRe.exec(existing))) {
      const oppLabel = l[1].replace(/^vs\s+|^at\s+/i, '').trim();
      logoMap[oppLabel] = l[2];
    }
  }

  // Compose Game[] entries
  const games = [];

  // Prepend preseason objects if any (as raw text object blocks).
  // We'll re-serialize them later by inserting them directly.

  // Translate matches into objects
  let gameCounter = 0;
  const startYear = Number(season.slice(0,4));
  const endYear = Number(season.slice(4));
  matches.forEach((r, idx) => {
    // Skip any rows that look like table header repeats
    if (!r.monthShort || !r.day || !r.opponentFull) return;

    const month = r.monthShort;
    const day = String(Number(r.day));
    const monthNum = monthIndexFromShort(month);
    const year = monthNum >= 10 ? startYear : endYear;

    const prefix = r.homeAway === 'vs' ? 'vs ' : 'at ';
    const opponentLabel = `${prefix}${r.opponentFull}`;

    // Determine opponentLogo by simple name match
    const logo = logoMap[r.opponentFull] || logoMap[r.opponentFull.replace(/[^A-Za-z ]/g, '')];

    const obj = {
      id: `espn-${year}-${monthNum.toString().padStart(2,'0')}-${day.padStart(2,'0')}-${idx}`,
      date: `${month} ${day}`,
      month,
      day,
      opponent: opponentLabel,
      opponentLogo: logo || undefined,
      time: r.time || '7:00PM',
      ticketStatus: 'Pending',
      isPaid: false,
      type: 'Regular',
    };

    // assign sequential gameNumber
    gameCounter += 1;
    obj.gameNumber = gameCounter;

    games.push(obj);
  });

  // Build file content: include import, then export const PANTHERS_2025_2026_SCHEDULE: Game[] = [ ... ];
  const header = "import { Game } from './types';\n\n";

  // Start array content
  const arrParts = [];

  // Add preserved preseason objects (insert raw blocks if any)
  if (preseasonObjects.length) {
    preseasonObjects.forEach((raw) => {
      // Attempt to massage raw block into valid JS object text
      const cleaned = raw.replace(/,\s*$/, ',');
      arrParts.push(cleaned);
    });
  }

  // Add parsed regular games
  games.forEach((g) => {
    const objText = JSON.stringify(g, null, 2)
      .replace(/"(\w+)":/g, '$1:') // crude: remove quotes from keys for nicer TS object
      .replace(/"([^']+)":/g, (m,k) => `${k}:` );
    // But JSON.stringify will quote strings; keep them. We'll convert to JS-like by simple replace
    const jsText = JSON.stringify(g, null, 2)
      .replace(/"id":/g, 'id:')
      .replace(/"date":/g, 'date:')
      .replace(/"month":/g, 'month:')
      .replace(/"day":/g, 'day:')
      .replace(/"opponent":/g, 'opponent:')
      .replace(/"opponentLogo":/g, 'opponentLogo:')
      .replace(/"time":/g, 'time:')
      .replace(/"ticketStatus":/g, 'ticketStatus:')
      .replace(/"isPaid":/g, 'isPaid:')
      .replace(/"gameNumber":/g, 'gameNumber:')
      .replace(/"type":/g, 'type:')
      .replace(/null/g, 'null');

    // Now convert string values to single-quoted strings for consistency with repo
    const singleQuoted = jsText.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, p1) => `'${p1.replace(/'/g, "\\'")}'`);

    arrParts.push(singleQuoted + ',');
  });

  const final = header + `export const PANTHERS_${season}_SCHEDULE: Game[] = [\n` + arrParts.map(s => '  ' + s.replace(/\n/g, '\n  ')).join('\n') + `\n];\n\nexport default PANTHERS_${season}_SCHEDULE;\n`;

  fs.writeFileSync(out, final, 'utf8');
  console.log('Wrote', out, 'with', games.length, 'parsed games and', preseasonObjects.length, 'preseason preserved.');
  console.log('Review the file, adjust logos/times if needed, then commit.');
}

main().catch((err) => { console.error(err); process.exit(1); });
