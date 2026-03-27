#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const LZString = require('lz-string');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/compress-recovery-context.js <path-to-recovery.json>');
    process.exit(2);
  }

  const filePath = path.resolve(process.cwd(), args[0]);

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(3);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    // We accept raw JSON of any accepted recovery shape and just compress it
    JSON.parse(raw); // quick validation

    const compressed = LZString.compressToEncodedURIComponent(raw);

    console.log('\n=== Recovery Code (paste into app Settings -> Restore from Code) ===\n');
    console.log(compressed);
    console.log('\n=== End Recovery Code ===\n');
    process.exit(0);
  } catch (err) {
    console.error('Failed to read/parse file:', err.message || err);
    process.exit(5);
  }
}

main();
