#!/usr/bin/env node
// Best-effort parser for NHL.com team schedule pages.
// Usage: node ./scripts/fetchNhlComSchedule.js --url=<nhl.com schedule url> --season=20252026 --out=./constants/panthersSchedule.ts

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

function extractRowsFromNhlHtml(html) {
  // crude approach: collapse tags to spaces and look for patterns like "Oct 7" and opponent names
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const rowRe = /([A-Za-z]{3})\s+(\d{1,2})\s+(vs|@)\s+([A-Za-z\s\.\'\-]+)/g;
  const matches = [];
  let m;
  while ((m = rowRe.exec(text))) {
    matches.push({ monthShort: m[1], day: m[2], homeAway: m[3], opponentFull: m[4].trim() });
  }
  return matches;
}

async function main() {
  const args = parseArgs();
  const url = args.url || 'https://www.nhl.com/panthers/schedule';
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, 'tmp_panthers_nhlcom.ts');

  console.log('Fetching NHL.com schedule page:', url);
  let html;
  try { html = await fetchUrl(url); } catch (e) { console.error('Fetch failed:', e.message || e); process.exit(1); }

  const rows = extractRowsFromNhlHtml(html);
  if (!rows.length) {
    console.warn('No rows parsed from NHL.com page.');
  }

  // Build Game[] objects (minimal fields)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monthIndex(m) { return MONTHS.indexOf(m) + 1; }

  const games = rows.map((r, idx) => {
    const month = r.monthShort;
    const day = String(Number(r.day));
    return {
      id: `nhlcom-${idx}`,
      date: `${month} ${day}`,
      month,
      day,
      opponent: `${r.homeAway === 'vs' ? 'vs ' : 'at '}${r.opponentFull}`,
      time: '7:00PM',
      ticketStatus: 'Pending',
      isPaid: false,
      type: 'Regular'
    };
  });

  const header = "import { Game } from './types';\n\n";
  const content = header + `export const PANTHERS_${season}_NHLCOM: Game[] = ${JSON.stringify(games, null, 2)};\n`;
  fs.writeFileSync(out, content, 'utf8');
  console.log('Wrote', out, 'with', games.length, 'parsed games.');
}

main().catch((err) => { console.error(err); process.exit(1); });
