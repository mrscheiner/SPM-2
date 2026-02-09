const fs = require('fs');
const path = require('path');

const tmPath = path.resolve(__dirname, '../constants/seasonPassSchedules_20252026_ticketmaster.ts');
const espnPath = path.resolve(__dirname, '../backend/trpc/routes/espn.ts');
const leaguesPath = path.resolve(__dirname, '../constants/leagues.ts');

function loadFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error('Failed to read', p, e);
    process.exit(1);
  }
}

const tm = loadFile(tmPath);
const espn = loadFile(espnPath);
const leagues = loadFile(leaguesPath);

// Extract TEAM_LOGO_FALLBACKS from espn.ts using a regex
const fallbacksMatch = espn.match(/const TEAM_LOGO_FALLBACKS:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\};/);
let espnFallbacks = {};
if (fallbacksMatch) {
  const objText = fallbacksMatch[1];
  // crude parse: each line like "  \"boston bruins\": \"https://...\",
  const lineRe = /\"(.+?)\"\s*:\s*\"(.+?)\"/g;
  let lm;
  while ((lm = lineRe.exec(objText)) !== null) {
    espnFallbacks[lm[1].toLowerCase()] = lm[2];
  }
}

// Extract team names from leagues.ts (NHL_TEAMS etc.)
const teamRe = /export const NHL_TEAMS:[\s\S]*?=\s*\[([\s\S]*?)\];/;
const teamMatch = leagues.match(teamRe);
let nhlTeams = [];
if (teamMatch) {
  const arrText = teamMatch[1];
  const itemRe = /\{([\s\S]*?)\}\s*,?/g;
  let im;
  while ((im = itemRe.exec(arrText)) !== null) {
    const item = im[1];
    const nameM = item.match(/name:\s*'([^']+)'/);
    const cityM = item.match(/city:\s*'([^']+)'/);
    const abbrM = item.match(/abbreviation:\s*'([^']+)'/);
    const logoM = item.match(/logoUrl:\s*'([^']+)'/);
    if (nameM) nhlTeams.push({ name: nameM[1], city: cityM ? cityM[1] : '', abbr: abbrM ? abbrM[1] : '', logo: logoM ? logoM[1] : '' });
  }
}

// Parse the TM file: find all occurrences of { ... "opponent": "...", ... "dateTimeISO": "..." }
const opponentRe = /\{([\s\S]*?)\}/g;
let matches = [];
let m;
while ((m = opponentRe.exec(tm)) !== null) {
  const block = m[1];
  if (block.includes('"opponent":')) {
    const idM = block.match(/"id":\s*"([^"]+)"/);
    const oppM = block.match(/"opponent":\s*"([^"]+)"/);
    const dateM = block.match(/"dateTimeISO":\s*"([^"]+)"/);
    if (oppM) {
      matches.push({ id: idM ? idM[1] : null, opponent: oppM[1], dateTimeISO: dateM ? dateM[1] : null, raw: block.trim() });
    }
  }
}

console.log('Total game entries found with opponent field:', matches.length);

// For each match, try to resolve a logo using espnFallbacks or nhlTeams
const report = [];
for (const g of matches) {
  const opp = (g.opponent || '').toLowerCase();
  let logo = null;
  let matched = null;

  // try espn fallbacks (keyed by full name)
  for (const key of Object.keys(espnFallbacks)) {
    if (opp.includes(key)) {
      logo = espnFallbacks[key];
      matched = key;
      break;
    }
  }

  // try nhlTeams names / city / abbr
  if (!logo) {
    for (const t of nhlTeams) {
      if (!t) continue;
      const name = (t.name || '').toLowerCase();
      const city = (t.city || '').toLowerCase();
      const abbr = (t.abbr || '').toLowerCase();
      if ((name && opp.includes(name)) || (city && opp.includes(city)) || (abbr && opp.includes(abbr.toLowerCase()))) {
        logo = t.logo;
        matched = t.name;
        break;
      }
    }
  }

  report.push({ id: g.id, dateTimeISO: g.dateTimeISO, opponent: g.opponent, matched, logo });
}

// Filter report for specific teams the user reported (Carolina, Philadelphia, Chicago, Senators, Penguins, Capitals, Boston Feb4 Apr2)
const targets = ['carolina', 'philadelphia', 'chicago', 'ottawa', 'pittsburgh', 'washington', 'boston'];
const targeted = report.filter(r => {
  const opp = (r.opponent || '').toLowerCase();
  return targets.some(t => opp.includes(t));
});

const unmatched = targeted.filter(r => !r.logo);
console.log('Total targeted entries:', targeted.length);
console.log('Targeted unmatched count:', unmatched.length);

// Write a JSON report
const out = { totalFound: matches.length, targetedCount: targeted.length, targetedUnmatchedCount: unmatched.length, targeted, unmatched };
fs.writeFileSync(path.resolve(__dirname, 'logo-resolution-report.json'), JSON.stringify(out, null, 2));
console.log('Wrote scripts/logo-resolution-report.json');

// Also print a small sample of unmatched entries for immediate view
if (unmatched.length > 0) {
  console.log('\nSample unmatched entries:');
  unmatched.slice(0, 20).forEach(u => console.log(u));
} else {
  console.log('\nAll targeted entries matched logos (via local heuristics)');
}

process.exit(0);
