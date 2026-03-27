Fetch Panthers schedule
======================

This folder contains a small helper script that fetches the Florida Panthers schedule from the NHL stats API and writes a TypeScript file in `constants/panthersSchedule.ts`.

Usage
-----

Run the included npm script (recommended):

```bash
npm run fetch:panthers-schedule
```

Or run directly with node and optional args:

```bash
node ./scripts/fetchPanthersSchedule.js --teamId=13 --season=20252026 --out=./constants/panthersSchedule.ts
```

Arguments
- `--teamId` — NHL team id (13 = Florida Panthers). Defaults to 13.
- `--season` — NHL season string, e.g. `20252026` for 2025-26. Defaults to `20252026`.
- `--out` — output path for the generated TypeScript file.

Notes
- The script uses the NHL public stats API. You need network access to run it.
- It will attempt to preserve opponent logos from the existing `constants/panthersSchedule.ts` by best-effort name matching.
- After running, inspect the generated file and commit it when happy.
