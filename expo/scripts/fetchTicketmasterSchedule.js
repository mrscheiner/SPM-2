#!/usr/bin/env node
/*
  Fetch events from Ticketmaster Discovery API and write a temporary TS file
  that exports Game[] for the given season.

  Requires environment variable: TM_API_KEY
  Usage:
    TM_API_KEY=your_key node ./scripts/fetchTicketmasterSchedule.js --keyword="Florida Panthers" --season=20252026 --out=./scripts/tmp_panthers_ticketmaster.ts

  Notes: This is best-effort. Ticketmaster provides event dates in UTC; we will
  fill `dateTimeISO` with the UTC iso from Ticketmaster and compute a local ET
  `time`/`date` using the 2025-26 DST boundaries (same rules used elsewhere).
*/

const https = require('https');
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

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function isInStandardTime(year, month, day) {
  const ymd = new Date(Date.UTC(year, month - 1, day));
  const dstEnd = new Date(Date.UTC(2025, 10, 2)); // 2025-11-02
  const dstStart = new Date(Date.UTC(2026, 2, 8)); // 2026-03-08
  if (ymd >= dstEnd && ymd < dstStart) return true;
  return false;
}

function toETStringsFromUTC(isoUtc) {
  const dUtc = new Date(isoUtc);
  const year = dUtc.getUTCFullYear();
  const month = dUtc.getUTCMonth() + 1; // 1-12
  const day = dUtc.getUTCDate();
  // determine ET offset by local date boundaries
  const inStd = isInStandardTime(year, month, day);
  const offsetHours = inStd ? -5 : -4; // ET = UTC + offsetHours
  const etMillis = dUtc.getTime() + offsetHours * 3600 * 1000;
  const et = new Date(etMillis);
  const monthShort = monthNames[et.getMonth()];
  const dayNum = et.getDate();
  let h = et.getHours();
  const m = et.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const timeStr = `${h}:${String(m).padStart(2,'0')}${ampm}`;
  return { date: `${monthShort} ${dayNum}`, month: monthShort, day: String(dayNum), time: timeStr };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const args = parseArgs();
  const apikey = process.env.TM_API_KEY;
  if (!apikey) {
    console.error('TM_API_KEY not set in environment. Skipping Ticketmaster fetch.');
    process.exit(1);
  }
  const keyword = args.keyword || 'Florida Panthers';
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, 'tmp_panthers_ticketmaster.ts');

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(keyword)}&classificationName=sports&countryCode=US&apikey=${apikey}&size=200`;
  console.log('Fetching Ticketmaster events for', keyword);
  let data;
  try { data = await fetchJson(url); } catch (e) { console.error('Ticketmaster fetch failed:', e.message || e); process.exit(2); }

  const events = (data && data._embedded && data._embedded.events) ? data._embedded.events : [];
  if (!events.length) {
    console.warn('No Ticketmaster events found for', keyword);
  }

  const games = events.map((ev, i) => {
    // prefer UTC dateTime if present
    const isoUtc = ev.dates && ev.dates.start && ev.dates.start.dateTime ? ev.dates.start.dateTime : null;
    const localInfo = isoUtc ? toETStringsFromUTC(isoUtc) : { date: null, month: null, day: null, time: (ev.dates && ev.dates.start && ev.dates.start.localTime) || '7:00PM' };
    const opponent = ev.name || keyword;
    return {
      id: `tm-${ev.id || i}`,
      date: localInfo.date || '',
      month: localInfo.month || '',
      day: localInfo.day || '',
      opponent: `vs ${opponent}`,
      opponentLogo: undefined,
      time: localInfo.time || '7:00PM',
      ticketStatus: 'Available',
      isPaid: false,
      type: 'Preseason',
      dateTimeISO: isoUtc || null,
    };
  });

  const header = "import { Game } from './types';\n\n";
  const content = header + `export const PANTHERS_${season}_TICKETMASTER: Game[] = ${JSON.stringify(games, null, 2)};\n`;
  fs.writeFileSync(out, content, 'utf8');
  console.log('Wrote', out, 'with', games.length, 'events parsed from Ticketmaster.');
}

main().catch((e) => { console.error(e); process.exit(99); });
