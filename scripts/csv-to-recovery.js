#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function normalizePaymentStatus(s) {
  const lower = String(s || '').trim().toLowerCase();
  if (lower === 'pending') return 'pending';
  if (lower === 'per seat') return 'per seat';
  return 'paid';
}

function mapToPairId(section, seats) {
  const s = String(section).trim();
  const se = String(seats).replace(/"/g, '').trim();
  if (s === '129' && se === '24-25') return 'pair1';
  if (s === '308' && se === '1-2') return 'pair2';
  if (s === '325' && se === '6-7') return 'pair3';
  // fallback: create a pair id based on section
  return `pair_${s}_${se.replace(/[^0-9a-zA-Z-]/g, '')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = path.resolve(process.cwd(), args[0] || './scripts/panthers-sales.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(2);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    console.error('CSV appears empty or only header');
    process.exit(3);
  }

  const header = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1);

  const salesData = {};
  const seatPairsMap = {
    pair1: { id: 'pair1', section: '129', row: '26', seats: '24-25', seasonCost: 6651.12 },
    pair2: { id: 'pair2', section: '308', row: '8', seats: '1-2', seasonCost: 3505.32 },
    pair3: { id: 'pair3', section: '325', row: '5', seats: '6-7', seasonCost: 3505.32 },
  };

  for (const r of rows) {
    // Handle CSV fields which may include quoted fields with commas
    // Simple split respecting quotes
    const vals = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        vals.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.length > 0) vals.push(cur);

    if (vals.length < 7) continue;
    const [game, section, row, seats, priceStr, paymentStatus, soldDate] = vals.map(v => v.trim());
    const price = Number(priceStr);
    const pairId = mapToPairId(section, seats);

    if (!salesData[game]) salesData[game] = {};
    salesData[game][pairId] = {
      gameId: game,
      pairId,
      section: String(section),
      row: String(row),
      seats: seats.replace(/\"/g, ''),
      price,
      paymentStatus: paymentStatus.trim(),
      soldDate: soldDate.trim(),
    };

    // Ensure seatPairs includes this pair
    if (!seatPairsMap[pairId]) {
      seatPairsMap[pairId] = { id: pairId, section: section, row: row, seats: seats.replace(/\"/g, ''), seasonCost: 0 };
    }
  }

  const seatPairs = Object.values(seatPairsMap);

  const recovery = {
    contextMarkers: { start: '=== RECOVERY CONTEXT START ===', end: '=== RECOVERY CONTEXT END ===' },
    recoveryData: {
      version: '2.01',
      timestamp: new Date().toISOString(),
      appName: 'Florida Panthers Ticket Sales Tracker',
      salesData,
      seatPairs,
      appConfig: { name: 'Florida Panthers Ticket Sales Tracker', season: '2025-2026', version: '2.01' }
    }
  };

  const outPath = path.resolve(process.cwd(), './scripts/panthers-recovery-full.json');
  fs.writeFileSync(outPath, JSON.stringify(recovery, null, 2));
  console.log('Wrote', outPath);
  console.log('Now run: node ./scripts/compress-recovery-context.js ./scripts/panthers-recovery-full.json');
}

main().catch(err => { console.error(err); process.exit(10); });
