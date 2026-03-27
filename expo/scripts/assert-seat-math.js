const fs = require('fs');
const path = require('path');

function parseSeatsCount(seats) {
  if (!seats || typeof seats !== 'string') return 0;
  const normalized = seats.replace(/\s+/g, '').replace(/-/g, ',');
  const parts = normalized.split(',').filter(Boolean);
  if (parts.length === 2) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (!isNaN(a) && !isNaN(b) && b >= a) {
      return Math.max(1, b - a + 1);
    }
  }
  const explicit = parts.reduce((acc, p) => {
    const n = parseInt(p, 10);
    return acc + (isNaN(n) ? 0 : 1);
  }, 0);
  return explicit || 0;
}

function loadRecovery() {
  const jsonPath = path.join(__dirname, 'panthers-recovery-full.json');
  if (!fs.existsSync(jsonPath)) throw new Error('Missing panthers-recovery-full.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return raw.recoveryData ? raw.recoveryData : raw;
}

function runAssertions() {
  const data = loadRecovery();
  const seatPairs = data.seatPairs || [];
  const salesData = data.salesData || {};

  const seatsPerGame = seatPairs.reduce((acc, p) => acc + parseSeatsCount(p.seats), 0);
  const games = Object.keys(salesData).filter(k => !isNaN(Number(k))).length;
  const totalTickets = games * seatsPerGame;

  let ticketsSold = 0;
  let pendingSeats = 0;
  let pendingRecords = 0;
  let revenue = 0;

  Object.entries(salesData).forEach(([gid, gameSales]) => {
    Object.values(gameSales).forEach(sale => {
      const sc = parseSeatsCount(sale.seats);
      if (sale.paymentStatus && sale.paymentStatus.toLowerCase() !== 'pending') {
        ticketsSold += sc;
        revenue += Number(sale.price || 0);
      } else {
        pendingSeats += sc;
        pendingRecords += 1;
      }
    });
  });

  console.log('Computed:', { seatsPerGame, games, totalTickets, ticketsSold, pendingSeats, pendingRecords, revenue });

  if (ticketsSold + pendingSeats > totalTickets) {
    throw new Error(`INVALID: sold (${ticketsSold}) + pending (${pendingSeats}) > totalTickets (${totalTickets})`);
  }

  if (typeof seatsPerGame !== 'number' || seatsPerGame <= 0) {
    console.warn('Warning: seatsPerGame looks odd:', seatsPerGame);
  }

  console.log('All assertions passed');
}

try {
  runAssertions();
  process.exit(0);
} catch (e) {
  console.error('Assertion failed:', e.message);
  process.exit(2);
}
