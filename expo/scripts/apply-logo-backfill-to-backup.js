#!/usr/bin/env node
// Usage: node ./scripts/apply-logo-backfill-to-backup.js <inputBackup.json> <outputBackup.json>
// Reads a backup JSON (BackupData shape), applies logo heuristics to games and sales, and writes updated backup.

const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.log('Usage: node ./scripts/apply-logo-backfill-to-backup.js <inputBackup.json> <outputBackup.json>');
  process.exit(1);
}

const inPath = path.resolve(process.cwd(), process.argv[2]);
const outPath = path.resolve(process.cwd(), process.argv[3]);

function loadFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error('Failed to read', p, e);
    process.exit(2);
  }
}

// Load leagues and espn fallbacks to resolve logos
const leaguesFile = path.resolve(__dirname, '../constants/leagues.ts');
const espnFile = path.resolve(__dirname, '../backend/trpc/routes/espn.ts');

let leaguesText = '';
let espnText = '';
try { leaguesText = fs.readFileSync(leaguesFile, 'utf8'); } catch (e) { /* ignore */ }
try { espnText = fs.readFileSync(espnFile, 'utf8'); } catch (e) { /* ignore */ }

function buildTeamLists() {
  // crude extraction for known exported team lists (NHL_TEAMS, NFL_TEAMS, MLS_TEAMS, etc.)
  const lists = {};
  const re = /export const (\w+):\s*any\s*=\s*\[([\s\S]*?)\];/g;
  let m;
  while ((m = re.exec(leaguesText)) !== null) {
    const name = m[1];
    const arrText = m[2];
    const itemRe = /\{([\s\S]*?)\}\s*,?/g;
    let im;
    const items = [];
    while ((im = itemRe.exec(arrText)) !== null) {
      const item = im[1];
      const nameM = item.match(/name:\s*'([^']+)'/);
      const cityM = item.match(/city:\s*'([^']+)'/);
      const abbrM = item.match(/abbreviation:\s*'([^']+)'/);
      const logoM = item.match(/logoUrl:\s*'([^']+)'/);
      items.push({ name: nameM ? nameM[1] : '', city: cityM ? cityM[1] : '', abbreviation: abbrM ? abbrM[1] : '', logoUrl: logoM ? logoM[1] : '' });
    }
    lists[name] = items;
  }
  return lists;
}

function buildEspnFallbacks() {
  const fallbacks = {};
  const m = espnText.match(/const TEAM_LOGO_FALLBACKS:[\s\S]*?=\s*\{([\s\S]*?)\};/);
  if (!m) return fallbacks;
  const objText = m[1];
  const lineRe = /"(.+?)"\s*:\s*"(.+?)"/g;
  let lm;
  while ((lm = lineRe.exec(objText)) !== null) {
    fallbacks[lm[1].toLowerCase()] = lm[2];
  }
  return fallbacks;
}

const teamLists = buildTeamLists();
const espnFallbacks = buildEspnFallbacks();

function findLogoForOpponent(opponentText, leagueId) {
  if (!opponentText) return undefined;
  const txt = String(opponentText).toLowerCase();
  // pick teams list by league id mapping heuristic: NHL -> NHL_TEAMS, NFL -> NFL_TEAMS, MLS -> MLS_TEAMS
  const map = { nhl: 'NHL_TEAMS', nba: 'NBA_TEAMS', nfl: 'NFL_TEAMS', mlb: 'MLB_TEAMS', mls: 'MLS_TEAMS' };
  const listName = map[(leagueId || '').toLowerCase()];
  const teams = listName && teamLists[listName] ? teamLists[listName] : [].concat(...Object.values(teamLists));

  // espn fallbacks by full name
  for (const key of Object.keys(espnFallbacks)) {
    if (txt.includes(key)) return espnFallbacks[key];
  }

  for (const t of teams) {
    const name = (t.name || '').toLowerCase();
    const city = (t.city || '').toLowerCase();
    const abbr = (t.abbreviation || '').toLowerCase();
    if ((name && txt.includes(name)) || (city && txt.includes(city)) || (abbr && txt.includes(abbr))) {
      return t.logoUrl || undefined;
    }
  }

  // token fallback
  const tokens = txt.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const t of teams) {
    const name = (t.name || '').toLowerCase();
    const city = (t.city || '').toLowerCase();
    for (const token of tokens) {
      if (name.includes(token) || city.includes(token) || (t.abbreviation || '').toLowerCase() === token) {
        return t.logoUrl || undefined;
      }
    }
  }
  return undefined;
}

// Load input backup
let backupRaw = null;
try { backupRaw = fs.readFileSync(inPath, 'utf8'); } catch (e) { console.error('Failed to read input backup:', e); process.exit(3); }
let backup = null;
try { backup = JSON.parse(backupRaw); } catch (e) { console.error('Input file is not valid JSON:', e); process.exit(4); }
if (!backup || !Array.isArray(backup.seasonPasses)) {
  console.error('Input backup does not contain seasonPasses array');
  process.exit(5);
}

let totalGames = 0;
let gamesUpdated = 0;
let salesUpdated = 0;

const updatedPasses = backup.seasonPasses.map(p => {
  const cloned = JSON.parse(JSON.stringify(p));
  if (Array.isArray(cloned.games)) {
    cloned.games.forEach(g => {
      totalGames++;
      if (!g.opponentLogo) {
        const found = findLogoForOpponent(g.opponent, cloned.leagueId);
        if (found) { g.opponentLogo = found; gamesUpdated++; }
      }
    });
  }
  // backfill sales
  const gamesById = {};
  (cloned.games || []).forEach(g => { gamesById[g.id] = g; });
  const sd = cloned.salesData || {};
  Object.entries(sd).forEach(([gid, gameSales]) => {
    const game = gamesById[gid];
    if (!game) return;
    Object.entries(gameSales || {}).forEach(([k, s]) => {
      if (s && !s.opponentLogo && game.opponentLogo) {
        s.opponentLogo = game.opponentLogo; salesUpdated++;
      }
    });
  });
  cloned.salesData = sd;
  return cloned;
});

backup.seasonPasses = updatedPasses;
fs.writeFileSync(outPath, JSON.stringify(backup, null, 2));
console.log('Wrote updated backup to', outPath);
console.log('Games scanned:', totalGames, 'Games updated:', gamesUpdated, 'Sales backfilled:', salesUpdated);
process.exit(0);
