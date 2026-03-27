#!/usr/bin/env node
/**
 * watch-rork-status.js
 * Run a local command and poll a remote build/status URL concurrently.
 * Usage:
 *   node scripts/watch-rork-status.js --cmd="npm run start" --poll-url="https://rork.example/builds/123/status" --interval=5000
 *
 * Optional env:
 *   RORK_AUTH_TOKEN - Bearer token for polling if required
 */

const { spawn } = require('child_process');
const { argv, env } = require('process');

function parseArgs() {
  const args = {};
  argv.slice(2).forEach(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  });
  return args;
}

async function pollStatus(url, interval = 5000, headers = {}) {
  // Use global fetch (Node 18+) or fall back to node-fetch if not available
  const hasFetch = typeof fetch === 'function';
  const doFetch = hasFetch ? fetch : (u, opts) => import('node-fetch').then(({default: f}) => f(u, opts));

  let last = null;
  try {
    const res = await doFetch(url, { headers });
    const text = await res.text();
    return { status: res.status, body: text };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

(async () => {
  const args = parseArgs();
  const cmd = args.cmd;
  const pollUrl = args['poll-url'];
  const interval = Number(args.interval || 5000);

  if (!cmd || !pollUrl) {
    console.error('Usage: node scripts/watch-rork-status.js --cmd="npm run start" --poll-url="https://.../status" [--interval=5000]');
    process.exit(2);
  }

  const token = env.RORK_AUTH_TOKEN || env.RORK_TOKEN || null;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  console.log(new Date().toISOString(), '[watch] Running command ->', cmd);
  const parts = cmd.split(' ');
  const proc = spawn(parts[0], parts.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });

  proc.stdout.on('data', chunk => {
    process.stdout.write(new Date().toISOString() + ' [cmd] ' + chunk.toString());
  });
  proc.stderr.on('data', chunk => {
    process.stderr.write(new Date().toISOString() + ' [cmd:err] ' + chunk.toString());
  });

  let polling = true;

  const pollLoop = async () => {
    while (polling) {
      const result = await pollStatus(pollUrl, interval, headers);
      const out = `[poll] ${new Date().toISOString()} status=${result.status} body=${truncate(result.body, 300)}`;
      process.stdout.write(out + '\n');
      await new Promise(r => setTimeout(r, interval));
    }
  };

  const truncate = (s, n) => s && s.length > n ? s.slice(0,n) + '…' : s;

  pollLoop().catch(err => {
    console.error('[watch] polling error', err);
  });

  proc.on('exit', (code, sig) => {
    polling = false;
    console.log(new Date().toISOString(), `[watch] command exited code=${code} signal=${sig}`);
    process.exit(code === null ? 0 : code);
  });

  proc.on('error', err => {
    polling = false;
    console.error('[watch] command spawn error', err);
    process.exit(1);
  });
})();
