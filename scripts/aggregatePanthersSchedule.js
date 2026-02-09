#!/usr/bin/env node
/*
  Aggregate Panthers schedule from NHL API (preferred) and ESPN (fallback/merge).

  Usage:
    node ./scripts/aggregatePanthersSchedule.js --teamId=13 --season=20252026 --out=./constants/panthersSchedule.ts

  The script runs the existing fetch scripts (which must be present), reads their outputs
  (temporary files) and merges them into a final TS file at the requested --out path.

  Run this locally (network access required). It will attempt NHL API first, then ESPN.
*/

const { spawnSync } = require('child_process');
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

function extractArrayFromTs(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  // First quick attempt: find first [ and last ] and parse as JSON
  let start = text.indexOf('[');
  let end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  let arrText = text.slice(start, end + 1);
  try {
    return JSON.parse(arrText);
  } catch (e) {
    // attempt to convert single-quoted strings to double-quoted for JSON parse
    const doubleQuoted = arrText.replace(/'/g, '"');
    try { return JSON.parse(doubleQuoted); } catch (err) {
      // Last-resort: attempt to evaluate the array portion as JS in a sandboxed function.
      // Find the first export const ... = [ ... ]; pattern and extract between the brackets up to the closing '];'
      const exportIndex = text.indexOf('export');
      if (exportIndex === -1) return null;
      const firstBracket = text.indexOf('[', exportIndex);
      const closeBracketToken = '];';
      const closeIndex = text.indexOf(closeBracketToken, firstBracket);
      if (firstBracket === -1 || closeIndex === -1) return null;
      const candidate = text.slice(firstBracket, closeIndex + 1);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('return ' + candidate + ';');
        return fn();
      } catch (evalErr) {
        console.warn('Failed to eval tmp TS array:', evalErr && evalErr.message);
        return null;
      }
    }
  }
}


function runScript(cmd, args, env) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  return res.status === 0;
}

async function main() {
  const args = parseArgs();
  const teamId = args.teamId || '13';
  const season = args.season || '20252026';
  const out = args.out || path.join(__dirname, '..', 'constants', 'panthersSchedule.ts');

  console.log('Aggregator: teamId=', teamId, 'season=', season);

  const tmpNhl = path.join(__dirname, 'tmp_panthers_nhl.ts');
  const tmpEspn = path.join(__dirname, 'tmp_panthers_espn.ts');

  // 1) Try NHL API fetcher
  console.log('Running NHL API fetcher...');
  const nhlCmd = process.execPath; // node
  const nhlArgs = [path.join(__dirname, 'fetchPanthersSchedule.js'), `--teamId=${teamId}`, `--season=${season}`, `--out=${tmpNhl}`];
  const nhlOk = runScript(nhlCmd, nhlArgs);

  let nhlGames = null;
  if (nhlOk && fs.existsSync(tmpNhl)) {
    console.log('NHL fetcher produced', tmpNhl);
    nhlGames = extractArrayFromTs(tmpNhl);
    if (!nhlGames) console.warn('Warning: could not parse NHL output');
  } else {
    console.warn('NHL fetcher failed or no output.');
  }

  // 2) Try NHL.com parser
  const tmpNhlCom = path.join(__dirname, 'tmp_panthers_nhlcom.ts');
  console.log('Running NHL.com parser...');
  const nhlcomOk = runScript(process.execPath, [path.join(__dirname, 'fetchNhlComSchedule.js'), `--season=${season}`, `--out=${tmpNhlCom}`]);
  let nhlComGames = null;
  if (nhlcomOk && fs.existsSync(tmpNhlCom)) {
    nhlComGames = extractArrayFromTs(tmpNhlCom);
    if (!nhlComGames) console.warn('Warning: could not parse NHL.com output');
  } else {
    console.warn('NHL.com parser failed or no output.');
  }

  // 3) Run ESPN parser (always run to use as fallback/merge)
  console.log('Running ESPN parser...');
  const espnCmd = process.execPath;
  const espnArgs = [path.join(__dirname, 'fetchEspnSchedule.js'), `--season=${season}`, `--out=${tmpEspn}`];
  const espnOk = runScript(espnCmd, espnArgs);
  let espnGames = null;
  if (espnOk && fs.existsSync(tmpEspn)) {
    espnGames = extractArrayFromTs(tmpEspn);
    if (!espnGames) console.warn('Warning: could not parse ESPN output');
  } else {
    console.warn('ESPN parser failed or no output.');
  }

  // 4) Run team site parser
  const tmpTeam = path.join(__dirname, 'tmp_panthers_team.ts');
  console.log('Running team site parser...');
  const teamOk = runScript(process.execPath, [path.join(__dirname, 'fetchTeamSiteSchedule.js'), `--season=${season}`, `--out=${tmpTeam}`]);
  let teamGames = null;
  if (teamOk && fs.existsSync(tmpTeam)) {
    teamGames = extractArrayFromTs(tmpTeam);
    if (!teamGames) console.warn('Warning: could not parse team site output');
  } else {
    console.warn('Team site parser failed or no output.');
  }

  // 5) Run Ticketmaster parser
  const tmpTm = path.join(__dirname, 'tmp_panthers_ticketmaster.ts');
  console.log('Running Ticketmaster parser...');
  // TM API requires TM_API_KEY env var set in your environment
  const tmOk = runScript(process.execPath, [path.join(__dirname, 'fetchTicketmasterSchedule.js'), `--season=${season}`, `--out=${tmpTm}`], { TM_API_KEY: process.env.TM_API_KEY || '' });
  let tmGames = null;
  if (tmOk && fs.existsSync(tmpTm)) {
    tmGames = extractArrayFromTs(tmpTm);
    if (!tmGames) console.warn('Warning: could not parse Ticketmaster output');
  } else if (fs.existsSync(tmpTm)) {
    // If a previous run created a tmp Ticketmaster file, try to read it
    console.warn('TM parser did not run now, but found existing tmp file; attempting to read it.');
    tmGames = extractArrayFromTs(tmpTm);
    if (!tmGames) console.warn('Warning: could not parse existing Ticketmaster tmp output');
  } else {
    console.warn('Ticketmaster parser failed or no output (ensure TM_API_KEY is set).');
  }

  // If none of the sources produced any data, abort. Otherwise continue
  // and prefer sources in this priority order when merging:
  // NHL API -> NHL.com -> ESPN -> Team site -> Ticketmaster (fallback)
  if (!nhlGames && !nhlComGames && !espnGames && !teamGames && !tmGames) {
    console.error('No schedule data available from any source. Aborting.');
    process.exit(1);
  }

  // 3) Merge: prefer NHL entries when present; otherwise use ESPN.
  const merged = [];
  const byKey = new Map();

  function keyOf(g) {
    // key by date + opponent trimmed
    return `${g.date || ''}|${(g.opponent || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
  }

  // Merge sources with defined priority. We insert lower-priority sources
  // first, then higher-priority sources overwrite them by the same key.
  const priorities = [tmGames, teamGames, espnGames, nhlComGames, nhlGames];
  priorities.forEach((src) => {
    if (!src) return;
    src.forEach((g) => byKey.set(keyOf(g), g));
  });

  // determine iteration order for output: pick the highest-priority source
  // that actually contains entries (we prefer NHL > NHL.com > ESPN > Team > TM)
  let orderingSource = [];
  if (nhlGames && nhlGames.length) orderingSource = nhlGames;
  else if (nhlComGames && nhlComGames.length) orderingSource = nhlComGames;
  else if (espnGames && espnGames.length) orderingSource = espnGames;
  else if (teamGames && teamGames.length) orderingSource = teamGames;
  else if (tmGames && tmGames.length) orderingSource = tmGames;
  orderingSource.forEach((g) => {
    const k = keyOf(g);
    const entry = byKey.get(k);
    if (entry) merged.push(entry);
  });

  // 4) Normalize ids and ensure types & minimal fields
  let counter = 1;
  merged.forEach((g) => {
    if (!g.id) g.id = `m${counter++}`;
    if (!g.type) g.type = 'Regular';
    if (!g.ticketStatus) g.ticketStatus = 'Pending';
    if (g.isPaid === undefined) g.isPaid = false;
  });

  // If merge produced no entries, abort and don't overwrite the existing schedule
  if (!merged.length) {
    console.error('Merged schedule is empty — no valid entries found. Aborting without writing file.');
    process.exit(1);
  }

  // 5) Write final TS file
  const header = "import { Game } from './types';\n\n";
  const body = JSON.stringify(merged, null, 2);
  const content = header + `export const PANTHERS_${season}_SCHEDULE: Game[] = ${body};\n\nexport default PANTHERS_${season}_SCHEDULE;\n`;
  fs.writeFileSync(out, content, 'utf8');
  console.log('Wrote merged schedule to', out, 'with', merged.length, 'games.');

  // cleanup tmp files
  [tmpNhl, tmpEspn, tmpNhlCom, tmpTeam, tmpTm].forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} });
}

main();
