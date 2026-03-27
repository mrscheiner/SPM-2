#!/usr/bin/env node
/*
  Fetch season schedule events from Ticketmaster for all teams across supported leagues.
  This script reads `constants/leagues.ts` to extract team names and leagueIds, then
  queries the Ticketmaster Discovery API for each team and aggregates events per league.

  Requires TM_API_KEY env var.
  Usage:
    TM_API_KEY=your_key node ./scripts/fetchAllLeaguesTicketmaster.js --season=20252026 --out=./constants/seasonPassSchedules_20252026_ticketmaster.ts
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

function toETStringsFromUTC(isoUtc) {
  // re-use simple ET conversion heuristic from other scripts
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function isInStandardTime(year, month, day) {
    const ymd = new Date(Date.UTC(year, month - 1, day));
    const dstEnd = new Date(Date.UTC(2025, 10, 2)); // 2025-11-02
    const dstStart = new Date(Date.UTC(2026, 2, 8)); // 2026-03-08
    if (ymd >= dstEnd && ymd < dstStart) return true;
    return false;
  }
  const dUtc = new Date(isoUtc);
  const year = dUtc.getUTCFullYear();
  const month = dUtc.getUTCMonth() + 1; // 1-12
  const day = dUtc.getUTCDate();
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

async function main() {
  const args = parseArgs();
  const apikey = process.env.TM_API_KEY;
  if (!apikey) {
    console.error('TM_API_KEY not set in environment. Aborting.');
    process.exit(1);
  }
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, '..', 'constants', `seasonPassSchedules_${season}_ticketmaster.ts`);

  const leaguesPath = path.join(__dirname, '..', 'constants', 'leagues.ts');
  if (!fs.existsSync(leaguesPath)) {
    console.error('Could not find constants/leagues.ts');
    process.exit(2);
  }
  const leaguesText = fs.readFileSync(leaguesPath, 'utf8');

  // Extract each export const ..._TEAMS block and parse objects inside for name and leagueId
  const teamBlocks = {};
  const blockRegex = /export const\s+(\w+)_TEAMS\s*:\s*Team\[\]\s*=\s*\[([\s\S]*?)\];/g;
  let m;
  while ((m = blockRegex.exec(leaguesText)) !== null) {
    const blockName = m[1];
    const blockBody = m[2];
    // split objects by '},' sequence (best-effort)
    const objs = blockBody.split(/\},\s*\{/).map((s, idx, arr) => {
      let txt = s;
      if (idx === 0) txt = txt.replace(/^\s*\{?/, '');
      if (idx === arr.length -1) txt = txt.replace(/\}?\s*$/, '');
      if (!txt.trim()) return null;
      return txt;
    }).filter(Boolean);
    const teams = objs.map((objText) => {
      const nameMatch = objText.match(/name:\s*'([^']+)'/);
      const leagueMatch = objText.match(/leagueId:\s*'([^']+)'/);
      const cityMatch = objText.match(/city:\s*'([^']+)'/);
      const name = nameMatch ? nameMatch[1] : null;
      const leagueId = leagueMatch ? leagueMatch[1] : null;
      const city = cityMatch ? cityMatch[1] : null;
      if (!name || !leagueId) return null;
      return { name, leagueId, city };
    }).filter(Boolean);
    teams.forEach(t => {
      if (!teamBlocks[t.leagueId]) teamBlocks[t.leagueId] = [];
      teamBlocks[t.leagueId].push(t);
    });
  }

  const targetLeagues = ['nhl','nba','mlb','nfl','mls'];
  const results = {};

  for (const lid of targetLeagues) {
    const teams = teamBlocks[lid] || [];
    console.log('League', lid, 'teams to query:', teams.length);
    const leagueEventsById = new Map();
    for (const team of teams) {
      const keyword = `${team.name} ${team.city || ''}`.trim();
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(keyword)}&classificationName=sports&countryCode=US&apikey=${apikey}&size=200`;
      console.log('  fetching', keyword);
      try {
        const data = await fetchJson(url);
        const events = (data && data._embedded && data._embedded.events) ? data._embedded.events : [];
        for (const ev of events) {
          const id = ev.id;
          if (leagueEventsById.has(id)) continue;
          const isoUtc = ev.dates && ev.dates.start && ev.dates.start.dateTime ? ev.dates.start.dateTime : null;
          const localInfo = isoUtc ? toETStringsFromUTC(isoUtc) : { date: null, month: null, day: null, time: (ev.dates && ev.dates.start && ev.dates.start.localTime) || '7:00PM' };
          const opponent = ev.name || keyword;
          const game = {
            id: `tm-${id}`,
            date: localInfo.date || '',
            month: localInfo.month || '',
            day: localInfo.day || '',
            opponent: `vs ${opponent}`,
            opponentLogo: undefined,
            time: localInfo.time || '7:00PM',
            ticketStatus: 'Available',
            isPaid: false,
            type: 'Regular',
            dateTimeISO: isoUtc || null,
          };
          leagueEventsById.set(id, game);
        }
      } catch (e) {
        console.warn('    fetch failed for', keyword, ':', e && e.message);
      }
      // polite delay to avoid hitting TM rate limits
      await new Promise((r) => setTimeout(r, 200));
    }
    results[lid] = Array.from(leagueEventsById.values());
    console.log('  league', lid, 'collected', results[lid].length, 'events');
  }

  // write combined TS file
  const header = "import { Game } from './types';\n\n";
  const bodyObj = {};
  Object.keys(results).forEach((k) => { bodyObj[k] = results[k]; });
  const body = JSON.stringify(bodyObj, null, 2);
  const content = header + `export const SEASON_PASS_SCHEDULES_${season}_TICKETMASTER = ${body};\n\nexport default SEASON_PASS_SCHEDULES_${season}_TICKETMASTER;\n`;
  fs.writeFileSync(out, content, 'utf8');
  console.log('Wrote', out);
}

main().catch((e) => { console.error(e); process.exit(99); });
