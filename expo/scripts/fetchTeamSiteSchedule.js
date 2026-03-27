#!/usr/bin/env node
// Best-effort parser for the official team site schedule (floridapanthers.com)
// Usage: node ./scripts/fetchTeamSiteSchedule.js --url=<team schedule url> --season=20252026 --out=./constants/panthersSchedule.ts

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

function extractRows(html) {
  // crude: collapse tags and look for Month Day + vs/@ opponent patterns
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const re = /([A-Za-z]{3})\s+(\d{1,2})\s+(vs|@)\s+([A-Za-z\s\.\-\']+)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    out.push({ monthShort: m[1], day: m[2], homeAway: m[3], opponentFull: m[4].trim() });
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const url = args.url || 'https://www.floridapanthers.com/schedule';
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, 'tmp_panthers_team.ts');

  console.log('Fetching team site schedule:', url);
  let html;
  try { html = await fetchUrl(url); } catch (e) { console.error('Fetch failed:', e.message || e); process.exit(1); }

  const rows = extractRows(html);
  if (!rows.length) console.warn('No rows parsed from team site.');

  const games = rows.map((r, i) => ({
    id: `team-${i}`,
    date: `${r.monthShort} ${String(Number(r.day))}`,
    month: r.monthShort,
    day: String(Number(r.day)),
    opponent: `${r.homeAway === 'vs' ? 'vs ' : 'at '}${r.opponentFull}`,
    time: '7:00PM',
    ticketStatus: 'Pending',
    isPaid: false,
    type: 'Regular'
  }));

  const header = "import { Game } from './types';\n\n";
  const content = header + `export const PANTHERS_${season}_TEAM: Game[] = ${JSON.stringify(games, null, 2)};\n`;
  fs.writeFileSync(out, content, 'utf8');
  console.log('Wrote', out, 'with', games.length, 'parsed games.');
}

main().catch((e) => { console.error(e); process.exit(1); });
