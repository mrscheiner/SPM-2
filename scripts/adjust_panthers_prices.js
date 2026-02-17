const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'providers', 'SeasonPassProvider.tsx');
let src = fs.readFileSync(file, 'utf8');
const startToken = 'const PANTHERS_TICKET_SALES_SEED: TicketSaleSeedRow[] = [';
const start = src.indexOf(startToken);
if (start === -1) {
  console.error('start token not found');
  process.exit(1);
}
let i = start + startToken.length;
let depth = 1;
let end = -1;
for (; i < src.length; i++) {
  const ch = src[i];
  if (ch === '[') depth++;
  else if (ch === ']') depth--;
  if (depth === 0) { end = i; break; }
}
if (end === -1) { console.error('end not found'); process.exit(1); }
const before = src.slice(0, start + startToken.length);
const arrayText = src.slice(start + startToken.length, end + 1); // includes closing ]
const after = src.slice(end + 1);
// Replace totalPrice: numbers inside arrayText
const replaced = arrayText.replace(/totalPrice:\s*([0-9]+(?:\.[0-9]+)?)/g, (m, num) => {
  const n = parseFloat(num);
  const newv = Math.round(n * 0.9 * 100) / 100;
  // keep decimal precision similar to original
  return `totalPrice: ${newv}`;
});
const out = before + replaced + after;
fs.writeFileSync(file, out, 'utf8');
console.log('Updated file:', file);
