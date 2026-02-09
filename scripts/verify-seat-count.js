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

(async function main(){
  try {
    const jsonPath = path.join(__dirname, 'panthers-recovery-full.json');
    if (!fs.existsSync(jsonPath)) {
      console.error('Missing test JSON:', jsonPath);
      process.exit(2);
    }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  // Support two shapes: { seatPairs, salesData } or { recoveryData: { seatPairs, salesData } }
  const source = raw.recoveryData ? raw.recoveryData : raw;
  const seatPairs = source.seatPairs || [];
  const salesData = source.salesData || {};

    const seatsPerGame = seatPairs.reduce((acc, p) => acc + parseSeatsCount(p.seats), 0);
    const games = Object.keys(salesData).filter(k => !isNaN(Number(k))).length || (raw.games ? raw.games.length : 0);
    const totalTickets = games * seatsPerGame;

    let ticketsSold = 0;
    let totalRevenue = 0;
    let pendingSeats = 0;

    Object.entries(salesData).forEach(([gameId, gameSales]) => {
      Object.values(gameSales).forEach(sale => {
        const sc = parseSeatsCount(sale.seats);
        if (sale.paymentStatus && sale.paymentStatus.toLowerCase() !== 'pending') {
          ticketsSold += sc;
          totalRevenue += Number(sale.price || 0);
        } else {
          pendingSeats += sc;
        }
      });
    });

    console.log('seatPairs count:', seatPairs.length);
    console.log('seatsPerGame:', seatsPerGame);
    console.log('games (numeric keys):', games);
    console.log('totalTickets (games * seatsPerGame):', totalTickets);
    console.log('ticketsSold (sum of sold seatCounts):', ticketsSold);
    console.log('pendingSeats:', pendingSeats);
    console.log('totalRevenue (sold):', totalRevenue);

    process.exit(0);
  } catch (e) {
    console.error('Error running verification script:', e);
    process.exit(1);
  }
})();
