#!/usr/bin/env node
// watch-and-reload.js
// Enhanced watcher: starts Expo with cache clear and watches multiple log sources
// (start.log, iOS Simulator logs via `xcrun simctl`, and Android device logs via `adb`) for
// our schedule debug markers. If markers don't appear within a timeout, restarts the bundler
// up to a retry limit. The script prefers the most reliable sources available on the host.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.resolve(process.cwd(), 'start.log');
const MARKER_REGEX = /\[Schedule Debug\]|\[Schedule\]/;
const RETRY_LIMIT = 5;
const TIMEOUT_MS = 30_000; // 30s to see first marker

function spawnExpo() {
  // Use npx expo start -c to clear the cache
  const proc = spawn('npx', ['expo', 'start', '-c'], { stdio: 'inherit', shell: true });
  return proc;
}

function spawnSimctlLog() {
  try {
    const p = spawn('xcrun', ['simctl', 'spawn', 'booted', 'log', 'stream', '--style', 'syslog', '--predicate', `eventMessage CONTAINS "[Schedule Debug]" OR eventMessage CONTAINS "[Schedule]"`], { shell: true });
    return p;
  } catch (e) {
    return null;
  }
}

function spawnAdbLog() {
  try {
    const p = spawn('adb', ['logcat', '-s', 'ReactNativeJS'], { shell: true });
    return p;
  } catch (e) {
    return null;
  }
}

async function waitForMarker(timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;
    const timers = [];
    const children = [];

    function finish(ok) {
      if (resolved) return;
      resolved = true;
      // cleanup
      for (const c of children) {
        try { c.kill && c.kill(); } catch (e) {}
      }
      for (const t of timers) clearTimeout(t);
      resolve(ok);
    }

    // 1) watch start.log (if present)
    if (fs.existsSync(LOG_PATH)) {
      const stream = fs.createReadStream(LOG_PATH, { encoding: 'utf8', flags: 'r' });
      let buf = '';
      stream.on('data', chunk => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) {
          if (MARKER_REGEX.test(l)) return finish(true);
        }
      });
      children.push(stream);
    }

    // 2) spawn simctl log stream if available
    const simctl = spawnSimctlLog();
    if (simctl) {
      children.push(simctl);
      simctl.stdout && simctl.stdout.on('data', d => {
        const s = String(d);
        if (MARKER_REGEX.test(s)) finish(true);
      });
      simctl.stderr && simctl.stderr.on('data', () => {});
    }

    // 3) spawn adb logcat if available
    const adb = spawnAdbLog();
    if (adb) {
      children.push(adb);
      adb.stdout && adb.stdout.on('data', d => {
        const s = String(d);
        if (MARKER_REGEX.test(s)) finish(true);
      });
      adb.stderr && adb.stderr.on('data', () => {});
    }

    // 4) fallback: follow start.log file creation if it doesn't exist
    if (!fs.existsSync(LOG_PATH)) {
      const waiter = setInterval(() => {
        if (fs.existsSync(LOG_PATH)) {
          clearInterval(waiter);
          // restart waiting to pick up file contents
          waitForMarker(timeoutMs).then(ok => finish(ok));
        }
      }, 500);
      timers.push(waiter);
    }

    // overall timeout
    const t = setTimeout(() => finish(false), timeoutMs);
    timers.push(t);
  });
}

(async function main() {
  let retries = 0;
  while (retries <= RETRY_LIMIT) {
    console.log(`[watch-and-reload] Starting Expo (attempt ${retries + 1}/${RETRY_LIMIT + 1})`);
    const expoProc = spawnExpo();

    // Wait for markers from any source
    const ok = await waitForMarker(TIMEOUT_MS);
    if (ok) {
      console.log('[watch-and-reload] Detected schedule debug marker — leaving bundler running.');
      // Let the expo process continue running; don't kill it
      break;
    }

    console.log('[watch-and-reload] No debug markers detected within timeout — restarting bundler.');
    try { expoProc.kill('SIGTERM'); } catch (e) {}
    retries += 1;
    if (retries > RETRY_LIMIT) {
      console.log('[watch-and-reload] Reached retry limit. Will attempt automated fixes (probe hockeywriters, commit & push) and restart.');
      try {
        // run the probe script that may update constants/leagues.ts
        console.log('[watch-and-reload] Running probe-hw-and-persist.js ...');
        const { execSync } = require('child_process');
        execSync('node ./scripts/probe-hw-and-persist.js', { stdio: 'inherit' });

        // if leagues.ts changed, commit and push
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (status.includes('constants/leagues.ts')) {
          console.log('[watch-and-reload] Detected changes to constants/leagues.ts — committing and pushing.');
          try {
            execSync('git add constants/leagues.ts', { stdio: 'inherit' });
            execSync('git commit -m "chore: persist verified hockeywriters NHL logos"', { stdio: 'inherit' });
            execSync('git push origin main', { stdio: 'inherit' });
            console.log('[watch-and-reload] Pushed updated leagues.ts to origin/main.');
          } catch (e) {
            console.log('[watch-and-reload] Git commit/push failed:', e.message);
          }
        } else {
          console.log('[watch-and-reload] No changes detected after probe.');
        }
      } catch (e) {
        console.log('[watch-and-reload] Automated probe or git step failed:', e && e.message ? e.message : e);
      }

      // reset retries to try bundler again
      retries = 0;
      console.log('[watch-and-reload] Restarting watcher loop after automated attempt.');
    }
    await new Promise(r => setTimeout(r, 1500));
  }
})();
