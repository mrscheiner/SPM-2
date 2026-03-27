Seat-count migration (2026-01-22)

Overview
- Purpose: migrate existing stored season passes and incoming backups so all SaleRecord objects include a numeric `seatCount` property. This ensures ticket math is always performed at the seat (not sale-record) level and avoids inconsistencies between UI components.

What changed in code
- Added `seatCount?: number` to `SaleRecord` in `constants/types.ts`.
- Added `lib/seats.ts` with `parseSeatsCount(seats)` utility to infer seat counts from common seat formats like `"24-25"`, `"24,25"`, and single seats like `"24"`.
- Provider (`providers/SeasonPassProvider.tsx`) now:
  - Populates `seatCount` when transforming recovery JSON (`transformSalesData`).
  - Runs a migration on app startup: any stored season pass missing `seatCount` values will be updated in-place and persisted. The migration tries, in order:
    1) parse the sale's `seats` string using `parseSeatsCount`;
    2) if that yields 0, parse the seat pair's configured `seats` (from `seatPairs`);
    3) fallback to `2` seats per pair (preserves previous implicit behaviour).
  - Exposes `calculateStats` values using seat-level math (ticketsSold, totalTickets) and also returns `pendingSeats` and `pendingPayments` (backwards-compatible count of pending sale records).
- UI updates:
  - `app/(tabs)/schedule.tsx` uses `parseSeatsCount` on `seatPairs` to compute `ticketsPerGame`, and sums `sale.seatCount` for tickets sold.
  - `app/(tabs)/analytics.tsx` shows `soldSeats` per pair in analytics and uses seat-level counts for exports.

Why fallback to 2 seats?
- Historically parts of the code treated each seat pair as 2 seats (pair * 2). To avoid undercounting for older backups that might not include seat strings, the migration uses `2` as a sensible fallback.

Verification
- Scripts:
  - `scripts/verify-seat-count.js` reads `scripts/panthers-recovery-full.json` and prints seatsPerGame, totalTickets, ticketsSold, pendingSeats, totalRevenue.
  - `scripts/assert-seat-math.js` asserts: ticketsSold + pendingSeats <= totalTickets and exits non-zero on failure.
- On the provided Panthers fixture the verification output is:
  - seatPairs count: 3
  - seatsPerGame: 6
  - games: 29
  - totalTickets: 174
  - ticketsSold: 160
  - pendingSeats: 12
  - totalRevenue: 6321.20
  - Assertions passed.

Impact & rollback
- Migration runs once at app startup when stored season passes are detected. It's idempotent (will not change records that already have `seatCount`).
- If anything goes wrong persisting the migrated passes, the provider logs a warn and continues; the app will still function using inferred seatCounts during that session.
- Rollback would require restoring previous AsyncStorage keys from a backup.

QA checklist
- Restore recovery JSON in Settings -> Restore from Code and verify Dashboard and Schedule counts match `scripts/verify-seat-count.js` output.
- Start the app with existing stored passes (pre-migration) and ensure metrics look correct and logs show migration applied.
- Export Excel backup and confirm `Tickets Sold` column uses seat-level counts.

If you'd like
- I can open a PR with this migration and include the verification scripts and a short PR checklist.
- If you prefer a different fallback (e.g., 1 seat per pair), tell me and I will adjust the migration strategy.
