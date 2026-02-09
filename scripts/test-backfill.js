// Simple smoke test for backfill logic used in SeasonPassProvider
// Run with: node ./scripts/test-backfill.js

const fs = require('fs');

function runBackfill(passes) {
  let changed = false;
  const migrated = passes.map(p => {
    const salesClone = JSON.parse(JSON.stringify(p.salesData || {}));
    const gamesById = {};
    (p.games || []).forEach(g => { gamesById[g.id] = g; });

    Object.entries(salesClone).forEach(([gameId, gameSales]) => {
      const game = gamesById[gameId];
      if (!game) return;
      Object.entries(gameSales || {}).forEach(([pairId, sale]) => {
        if (!sale) return;
        if (!sale.opponentLogo && game.opponentLogo) {
          sale.opponentLogo = game.opponentLogo;
          changed = true;
        }
      });
    });

    return { ...p, salesData: salesClone };
  });

  return { migrated, changed };
}

function main() {
  const sample = [
    {
      id: 'sp_test',
      teamName: 'Testers',
      games: [
        { id: 'g1', opponent: 'Foos', opponentLogo: 'https://example.com/foos.png' },
        { id: 'g2', opponent: 'Bars' }
      ],
      salesData: {
        g1: {
          p1: { id: 'g1_p1', gameId: 'g1', pairId: 'p1', section: '100', row: 'A', seats: '1-2', price: 50, paymentStatus: 'Paid', soldDate: '2026-01-01' }
        },
        g2: {
          p2: { id: 'g2_p2', gameId: 'g2', pairId: 'p2', section: '200', row: 'B', seats: '3-4', price: 60, paymentStatus: 'Pending', soldDate: '2026-01-02' }
        }
      }
    }
  ];

  console.log('Before:', JSON.stringify(sample, null, 2));
  const res = runBackfill(sample);
  console.log('\nChanged:', res.changed);
  console.log('\nAfter:', JSON.stringify(res.migrated, null, 2));
}

main();
