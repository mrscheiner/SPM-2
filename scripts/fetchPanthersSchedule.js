#!/usr/bin/env node
/*
  Fetch the Florida Panthers schedule from the NHL stats API and write
  a TypeScript file `constants/panthersSchedule.ts` with the Game[] export.

  Usage:
    node ./scripts/fetchPanthersSchedule.js --teamId=13 --season=20252026 --out=./constants/panthersSchedule.ts

  Notes:
  - Default teamId is 13 (Florida Panthers)
  - Season uses the NHL season format, e.g. 20252026 for 2025-26
  - This script will try to preserve opponent logo URLs found in the existing file
    by doing a best-effort match on opponent team names.
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

function formatTimeNoSpace(dateStr) {
  const d = new Date(dateStr);
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;
}

function formatMonthDay(dateStr) {
  const d = new Date(dateStr);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  return { month, day: `${day}`, date: `${month} ${day}` };
}

function mapGameType(gameType) {
  // gameType values: 'PR' preseason, 'R' regular, 'P' playoffs
  if (gameType === 'PR') return 'Preseason';
  if (gameType === 'P') return 'Playoff';
  return 'Regular';
}

async function main() {
  const args = parseArgs();
  const teamId = args.teamId ? Number(args.teamId) : 13;
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, '..', 'constants', 'panthersSchedule.ts');

  console.log(`Fetching schedule for teamId=${teamId} season=${season} ...`);

  const apiUrl = `https://statsapi.web.nhl.com/api/v1/schedule?teamId=${teamId}&season=${season}`;

  // Small fetch shim for Node environments without global fetch.
  const nodeFetch = async (url) => {
    if (typeof globalThis.fetch === 'function') return globalThis.fetch(url);
    // fallback to https
    const https = require('https');
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          const { statusCode, statusMessage } = res;
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            resolve({
              ok: statusCode >= 200 && statusCode < 300,
              status: statusCode,
              statusText: statusMessage,
              text: async () => raw,
              json: async () => JSON.parse(raw),
            });
          });
        })
        .on('error', (err) => reject(err));
    });
  };

  let res;
  try {
    res = await nodeFetch(apiUrl);
  } catch (err) {
    console.error('Network error fetching schedule:', err.message || err);
    process.exit(2);
  }

  if (!res.ok) {
    console.error('Failed to fetch schedule:', res.status, res.statusText);
    process.exit(3);
  }

  const data = await res.json();

  // Read existing file to try to preserve opponentLogo mapping
  const existingPath = path.join(__dirname, '..', 'constants', 'panthersSchedule.ts');
  let existing = '';
  try {
    existing = fs.readFileSync(existingPath, 'utf8');
  } catch (e) {
    // ignore
  }

  const logoMap = {};
  if (existing) {
    // crude parse: find opponent and opponentLogo pairs
    const re = /opponent:\s*'([^']+)'[\s\S]*?opponentLogo:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(existing))) {
      const opponentFull = m[1];
      // normalize by stripping leading 'vs ' or 'at '
      const key = opponentFull.replace(/^vs\s+|^at\s+/i, '').trim();
      logoMap[key] = m[2];
    }
  }

  const outGames = [];
  let gameCounter = 0;

  (data.dates || []).forEach((dateEntry) => {
    (dateEntry.games || []).forEach((g) => {
      const isHome = Number(g.teams.home.team.id) === Number(teamId);
      const opponentName = isHome ? g.teams.away.team.name : g.teams.home.team.name;
      const prefix = isHome ? 'vs ' : 'at ';
      const opponentLabel = `${prefix}${opponentName}`;

      const { month, day, date } = formatMonthDay(g.gameDate);
      const time = formatTimeNoSpace(g.gameDate);
      const dateTimeISO = g.gameDate;
      const type = mapGameType(g.gameType || g.type || 'R');

      const key = opponentName.trim();
      const opponentLogo = logoMap[key] || undefined;

      const obj = {
        id: String(g.gamePk),
        date,
        month,
        day,
        opponent: opponentLabel,
        opponentLogo,
        time,
        ticketStatus: 'Pending',
        isPaid: false,
        type,
        dateTimeISO,
      };

      // Assign sequential gameNumber only for Regular/Playoff games (not Preseason)
      if (type === 'Regular' || type === 'Playoff') {
        gameCounter += 1;
        obj.gameNumber = gameCounter;
      }

      outGames.push(obj);
    });
  });

  const seasonLabel = `${season.slice(0,4)}-${season.slice(4)}`;

  const fileContent = `import { Game } from './types';

export const PANTHERS_${season}_SCHEDULE: Game[] = ${JSON.stringify(outGames, null, 2)};

export default PANTHERS_${season}_SCHEDULE;
`;

  fs.writeFileSync(out, fileContent, 'utf8');
  console.log(`Wrote ${out} with ${outGames.length} games (regular games=${gameCounter}).`);
  console.log('Done. You can review, format, and commit the updated file.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
