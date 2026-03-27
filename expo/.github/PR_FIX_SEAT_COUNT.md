Title: fix: seat-level ticket counting and migration

Branch: fix/seat-count
Base: main

Summary
- Unify ticket counting to seat-level across provider and UI.
- Parse seat strings (e.g., "24-25", "1-2") into numeric `seatCount`.
- Persist `seatCount` in transformed sale records and migrate existing stored passes at startup.
- Update exports and analytics to use seat-level counts.
- Added verification scripts: `scripts/verify-seat-count.js` and `scripts/assert-seat-math.js`.

Files touched (high level)
- `constants/types.ts` — add `seatCount?: number` on `SaleRecord`.
- `lib/seats.ts` — new parse utility.
- `providers/SeasonPassProvider.tsx` — transformSalesData, calculateStats, migration logic, export fixes.
- `app/(tabs)/schedule.tsx` — ticketsPerGame and ticketsSold use seat-level counts.
- `app/(tabs)/analytics.tsx` — show seat-level soldSeats per pair.
- `scripts/*` — verification and recovery fixtures.

Notes
- Migration is idempotent and falls back to the pair seats or 2 seats per pair if no seat info is available.
- Verify locally by running `node scripts/verify-seat-count.js` and restoring the recovery JSON in the app.

Create PR URL:
https://github.com/mrscheiner/rork-app-ui-clone-clone/compare/main...fix/seat-count?expand=1
