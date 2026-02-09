#!/usr/bin/env node
// probe-hw-and-persist.js
// Probes hockeywriters.com for team logos for NHL_TEAMS in constants/leagues.ts
// If a verified hockeywriters image is found for a team, replaces that team's logoUrl in the file.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const LEAGUES_PATH = path.resolve(process.cwd(), 'constants', 'leagues.ts');
const BACKUP_PATH = LEAGUES_PATH + '.bak';
const MARKER = 'export const NHL_TEAMS';

function candidatesForTeam(t) {
  const abbr = (t.abbreviation || '').toLowerCase();
  const nameSlug = (t.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const candidates = [];
  if (abbr) candidates.push(`https://hockeywriters.com/wp-content/uploads/${abbr}.png`);
  if (nameSlug) candidates.push(`https://hockeywriters.com/wp-content/uploads/${nameSlug}.png`);
  candidates.push(...candidates.map(u => u.replace('.png', '-200x200.png')));
  return candidates;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' , timeout: 5000});
    if (!res) return false;
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      return ct.startsWith('image');
    }
  } catch (e) {
    return false;
  }
  return false;
}

function parseTeamsBlock(fileText) {
  const start = fileText.indexOf(MARKER);
  if (start === -1) return null;
  // find the opening [ and matching ] for the array
  const arrStart = fileText.indexOf('[', start);
  if (arrStart === -1) return null;
  let depth = 0;
  for (let i = arrStart; i < fileText.length; i++) {
    const ch = fileText[i];
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        const arrText = fileText.slice(arrStart, i+1);
        return { arrText, arrStart, arrEnd: i+1 };
      }
    }
  }
  return null;
}

function extractTeamObjects(arrText) {
  // crude split by '},' - assumes objects are non-nested
  const objs = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < arrText.length; i++) {
    const ch = arrText[i];
    current += ch;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        objs.push(current);
        current = '';
      }
    }
  }
  return objs;
}

function extractField(objText, key) {
  const re = new RegExp(key + "\\s*:\\s*(['\"])" + "(.*?)" + "\\1");
  const m = objText.match(re);
  return m ? m[2] : null;
}

(async function main(){
  if (!fs.existsSync(LEAGUES_PATH)) {
    console.error('leagues.ts not found at', LEAGUES_PATH);
    process.exit(1);
  }

  const original = fs.readFileSync(LEAGUES_PATH, 'utf8');
  const parsed = parseTeamsBlock(original);
  if (!parsed) {
    console.error('Could not locate NHL_TEAMS block in leagues.ts');
    process.exit(1);
  }

  const objs = extractTeamObjects(parsed.arrText);
  const updates = {};

  console.log(`Found ${objs.length} team entries in NHL_TEAMS block; probing hockeywriters...`);

  for (const obj of objs) {
    const id = extractField(obj, 'id');
    const name = extractField(obj, 'name');
    const abbr = extractField(obj, 'abbreviation');
    const logo = extractField(obj, 'logoUrl');
    if (!id) continue;
    const team = { id, name, abbreviation: abbr };
    const cands = candidatesForTeam(team);
    for (const c of cands) {
      process.stdout.write(`Probing ${c} ... `);
      // eslint-disable-next-line no-await-in-loop
      const ok = await headOk(c);
      if (ok) {
        console.log('OK');
        updates[id] = c;
        break;
      } else {
        console.log('no');
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    console.log('No hockeywriters replacements found. No file changes.');
    process.exit(0);
  }

  // backup and write changes
  fs.copyFileSync(LEAGUES_PATH, BACKUP_PATH);
  let out = original;
  for (const [teamId, url] of Object.entries(updates)) {
    // replace the logoUrl for objects with id: 'teamId'
    const re = new RegExp("(\{[\s\S]*?id\s*:\s*['\"]"+teamId+"['\"][\s\S]*?logoUrl\s*:\s*)['\"][^'\"]*['\"]","m");
    out = out.replace(re, `$1'${url}'`);
  }

  fs.writeFileSync(LEAGUES_PATH, out, 'utf8');
  console.log('Updated leagues.ts with hockeywriters logos for teams:', Object.keys(updates));
  console.log('Backup saved at', BACKUP_PATH);
})();
