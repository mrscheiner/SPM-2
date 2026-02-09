#!/usr/bin/env node
/**
 * Recalculate dateTimeISO fields in constants/panthersSchedule.ts using America/New_York rules
 * for the 2025-2026 season. This is a deterministic, local-only script and does not
 * require external network access.
 *
 * DST boundaries used (US):
 *  - DST ends: 2025-11-02 02:00 local -> after this is standard time (UTC-5)
 *  - DST starts: 2026-03-08 02:00 local -> after this is daylight time (UTC-4)
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'constants', 'panthersSchedule.ts');

const monthMap = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
};

function parseTime(t) {
  if (!t) return { hour: 19, minute: 0 };
  // normalize like '7:00PM' or '7:00 PM' or '4:00 PM'
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) {
    // fallback: try digits only
    const m2 = t.match(/(\d{1,2})\s*(AM|PM)/i);
    if (m2) return { hour: +(m2[1]) % 12 + (m2[2].toUpperCase() === 'PM' ? 12 : 0), minute: 0 };
    return { hour: 19, minute: 0 };
  }
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function isInStandardTime(year, month, day) {
  // return true if the given local date is in standard time (EST, UTC-5) for the 2025-26 season
  // DST ends on 2025-11-02 and starts on 2026-03-08
  const ymd = new Date(Date.UTC(year, month - 1, day));
  const dstEnd = new Date(Date.UTC(2025, 10, 2)); // 2025-11-02
  const dstStart = new Date(Date.UTC(2026, 2, 8)); // 2026-03-08
  // If date >= Nov 2 2025 and < Mar 8 2026 -> standard time
  if (ymd >= dstEnd && ymd < dstStart) return true;
  return false;
}

function computeISO(year, month, day, timeStr) {
  const { hour, minute } = parseTime(timeStr);
  const inStd = isInStandardTime(year, month, day);
  const offset = inStd ? 5 : 4; // hours to add to ET to get UTC
  // Build UTC components
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour + offset, minute, 0));
  return utcDate.toISOString();
}

function main() {
  let text = fs.readFileSync(FILE, 'utf8');

  // Regex to match object blocks inside the exported array. We'll find occurrences of
  // date: 'Mon D', month: 'Mon', day: 'D', time: '7:00PM' and replace dateTimeISO accordingly.
  const objRe = /\{([\s\S]*?)\},\s*\n/gm;
  let match;
  const parts = [];
  let lastIndex = 0;
  while ((match = objRe.exec(text))) {
    const block = match[0];
    const start = match.index;
    const end = objRe.lastIndex;
    parts.push(text.slice(lastIndex, start));
    lastIndex = end;

    // extract date, month, day, time
    const dateM = block.match(/date:\s*'([^']+)'/);
    const monthM = block.match(/month:\s*'([^']+)'/);
    const dayM = block.match(/day:\s*'([^']+)'/);
    const timeM = block.match(/time:\s*'([^']+)'/);

    if (dateM && monthM && dayM) {
      const monthShort = monthM[1];
      const day = parseInt(dayM[1], 10);
      const monthNum = monthMap[monthShort];
      // determine year from month: Oct-Dec -> 2025, Jan-Apr -> 2026, Sep preseason -> 2025
      let year = (monthNum >= 10) ? 2025 : 2026;
      if (monthNum === 9) year = 2025; // preseason Sep

      const timeStr = timeM ? timeM[1] : '7:00PM';
      const iso = computeISO(year, monthNum, day, timeStr);

      // replace existing dateTimeISO value if present, else append one before closing of block
      if (/dateTimeISO:\s*'[^']*'/.test(block)) {
        const newBlock = block.replace(/dateTimeISO:\s*'[^']*'/, `dateTimeISO: '${iso}'`);
        parts.push(newBlock);
      } else {
        // insert before the closing bracket of the object
        const newBlock = block.replace(/\n\s*\}/, `\n    dateTimeISO: '${iso}',\n  }`);
        parts.push(newBlock);
      }
    } else {
      // leave unchanged
      parts.push(block);
    }
  }
  parts.push(text.slice(lastIndex));
  const out = parts.join('');
  fs.writeFileSync(FILE, out, 'utf8');
  console.log('Updated dateTimeISO values in', FILE);
}

main();
