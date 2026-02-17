import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";

const app = new Hono();

console.log('[TRPC_SERVER] Hono server initializing...');
console.log('[TRPC_SERVER] tRPC mounted at /trpc/* internally, endpoint set to /api/trpc (full path after platform mount)');

// Masked verification logging for Ticketmaster API key
const tmKeyPresent = Boolean((globalThis as any).TICKETMASTER_API_KEY || process?.env?.TICKETMASTER_API_KEY);
const tmKeyLength = (globalThis as any).TICKETMASTER_API_KEY?.length ?? process?.env?.TICKETMASTER_API_KEY?.length ?? 0;
const tmKeyLast4 = tmKeyPresent ? (((globalThis as any).TICKETMASTER_API_KEY || process?.env?.TICKETMASTER_API_KEY)?.slice(-4)) : 'N/A';
console.log('[TRPC_SERVER] TICKETMASTER_API_KEY check:');
console.log('[TRPC_SERVER]   hasKey:', tmKeyPresent);
console.log('[TRPC_SERVER]   keyLength:', tmKeyLength);
console.log('[TRPC_SERVER]   last4:', tmKeyLast4);

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use(
  "/api/trpc/*",
  async (c, next) => {
    console.log('[TRPC_SERVER] ========== INCOMING REQUEST ==========');
    console.log('[TRPC_SERVER] Method:', c.req.method);
    console.log('[TRPC_SERVER] URL:', c.req.url);
    console.log('[TRPC_SERVER] Path:', c.req.path);
    try {
      const body = await c.req.text();
      console.log('[TRPC_SERVER] Request body:', body);
    } catch (e) {
      console.log('[TRPC_SERVER] Could not read request body:', e);
    }
    const startTime = Date.now();
    await next();
    const elapsed = Date.now() - startTime;
    console.log('[TRPC_SERVER] Response completed in', elapsed, 'ms');
    console.log('[TRPC_SERVER] ========================================');
  },
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  console.log('[TRPC_SERVER] Health check hit');
  return c.json({ status: "ok", message: "API is running", timestamp: new Date().toISOString() });
});

// Debug endpoint: summarize the runtime panthers seed JSON (if present)
app.get('/debug/panthers-seed-summary', async (c) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require('../scripts/panthers_seed.json');
    const candidates: any[] = [];
    function collect(x: any) {
      if (x && typeof x === 'object') {
        if (Array.isArray(x)) { x.forEach(collect); return; }
        if (typeof x.totalPrice === 'number' || typeof x.price === 'number' || (typeof x.totalPrice === 'string' && /^\s*\d/.test(x.totalPrice)) || (typeof x.price === 'string' && /^\s*\d/.test(x.price))) { candidates.push(x); return; }
        Object.values(x).forEach(collect);
      }
    }
    collect(raw);

    function parseSeatsString(seatsRaw: string): number[] {
      const out: number[] = [];
      if (!seatsRaw || typeof seatsRaw !== 'string') return out;
      const parts = seatsRaw.split(/[,;|]/).map((p: string) => p.trim()).filter(Boolean);
      for (const p of parts) {
        const rangeMatch = p.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
          const a = Number(rangeMatch[1]);
          const b = Number(rangeMatch[2]);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            const start = Math.min(a, b);
            const end = Math.max(a, b);
            for (let n = start; n <= end; n++) out.push(n);
            continue;
          }
        }
        const num = Number(p.match(/\d+/)?.[0] || NaN);
        if (Number.isFinite(num)) out.push(num);
      }
      return out;
    }

    const mapped = candidates.map((o: any) => {
      let totalPrice = 0;
      if (o.totalPrice != null) totalPrice = Number(o.totalPrice);
      else if (o.price != null) totalPrice = Number(o.price);
      else if (o.priceTotal != null) totalPrice = Number(o.priceTotal);
      if (!Number.isFinite(totalPrice)) totalPrice = 0;
      let tickets: any[] = [];
      if (Array.isArray(o.tickets) && o.tickets.length) {
        tickets = o.tickets.map((t: any) => ({ section: String(t.section || ''), row: String(t.row || ''), seat_number: Number(t.seat_number || t.seat || t.seatNumber || 0) }));
      } else if (Array.isArray(o.seatPairs)) {
        tickets = o.seatPairs.flatMap((sp: any) => (sp.seats || []).map((s: any) => ({ section: sp.section || '', row: sp.row || '', seat_number: Number(s) })));
      } else if (typeof o.seats === 'string' && (o.section || o.row || o.seatCount)) {
        const seatNumbers = parseSeatsString(o.seats);
        const sectionVal = o.section || o.sectionName || '';
        const rowVal = o.row || o.rowName || '';
        if (seatNumbers.length) tickets = seatNumbers.map((n) => ({ section: String(sectionVal), row: String(rowVal), seat_number: Number(n) }));
        else if (typeof o.seatCount === 'number' && o.seatCount > 0) {
          for (let i = 0; i < Number(o.seatCount); i++) tickets.push({ section: String(o.section || ''), row: String(o.row || ''), seat_number: i + 1 });
        }
      }
      return { totalPrice: Math.round(totalPrice * 100) / 100, ticketsCount: tickets.length };
    });

    const total = mapped.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
    const seats = mapped.reduce((s, r) => s + (Number(r.ticketsCount) || 0), 0);

    return c.json({ candidates: candidates.length, mapped: mapped.length, total, seats, sample: mapped.slice(0, 10) });
  } catch (e: any) {
    console.error('[DEBUG] panthers-seed-summary error:', e);
    return c.json({ error: 'FAILED', message: String(e?.message || e) });
  }
});

// Compatibility REST endpoint for POSTing schedule requests from clients that
// cannot call tRPC queries via POST. Returns the same shape as the tRPC
// procedures: { events: [...], error: null|string }
app.post('/compat/espn/getFullSchedule', async (c) => {
  try {
    const body = await c.req.json();
    const input = body || {};
    const leagueId = String(input.leagueId || '').toLowerCase();
    const teamAbbr = input.teamAbbreviation || '';
    const teamName = input.teamName || '';

    const ESPN_SITE_BASE = 'https://site.api.espn.com/apis/site/v2';
    // fetch teams
    const teamsUrl = `${ESPN_SITE_BASE}/sports/${leagueId === 'usa.1' ? 'soccer' : (leagueId === 'nba' ? 'basketball' : leagueId)}/${leagueId}/teams`;
    const teamsController = new AbortController();
    const teamsTimeoutId = setTimeout(() => teamsController.abort(), 15000);
    const teamsRes = await fetch(teamsUrl, { signal: teamsController.signal }).catch(() => null);
    clearTimeout(teamsTimeoutId);
    if (!teamsRes || !teamsRes.ok) return c.json({ events: [], error: 'TEAMS_FETCH_FAILED' });
    const teamsData: any = await teamsRes.json();
    let teams: any[] = [];
    if (teamsData?.sports?.[0]?.leagues?.[0]?.teams) teams = teamsData.sports[0].leagues[0].teams.map((t: any) => t.team).filter(Boolean);
    else if (teamsData?.teams) teams = teamsData.teams.map((t: any) => t.team).filter(Boolean);

    const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const wantedAbbr = norm(teamAbbr);
    const wantedName = norm(teamName);

    const match = teams.find((t) => norm(t?.abbreviation) === wantedAbbr) ||
                  teams.find((t) => norm(t?.displayName) === wantedName) ||
                  teams.find((t) => norm(t?.shortDisplayName) === wantedName) ||
                  teams.find((t) => norm(t?.name) === wantedName) || null;

    if (!match?.id) return c.json({ events: [], error: 'TEAM_NOT_FOUND' });
    const espnTeamId = String(match.id);

    // Try season parameter and default
    const season = new Date().getFullYear();
    const scheduleUrl = `${ESPN_SITE_BASE}/sports/${leagueId === 'usa.1' ? 'soccer' : (leagueId === 'nba' ? 'basketball' : leagueId)}/${leagueId}/teams/${espnTeamId}/schedule?season=${season}`;
    const schedController = new AbortController();
    const schedTimeoutId = setTimeout(() => schedController.abort(), 20000);
    const schedRes = await fetch(scheduleUrl, { signal: schedController.signal }).catch(() => null);
    clearTimeout(schedTimeoutId);
    if (!schedRes || !schedRes.ok) return c.json({ events: [], error: 'SCHEDULE_FETCH_FAILED' });
    const schedData: any = await schedRes.json();
    const rawEvents: any[] = schedData?.events || [];

    const homeEvents = rawEvents.filter((ev: any) => {
      const comp = (ev?.competitions || [])[0] || {};
      const competitors = comp.competitors || [];
      const ourTeam = competitors.find((c2: any) => String(c2?.team?.id) === espnTeamId);
      return ourTeam?.homeAway === 'home';
    });

    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mapped = homeEvents.map((ev: any, idx: number) => {
      const eventDate = new Date(ev.date);
      const competitions = ev?.competitions || [];
      const comp = competitions[0] || {};
      const competitors = comp?.competitors || [];
      let opponent = competitors.find((c2: any) => String(c2?.team?.id) !== espnTeamId);
      if (!opponent && competitors.length === 1) opponent = competitors[0];
      const opponentName = opponent?.team?.displayName || opponent?.team?.name || ev.name || 'TBD';
      return {
        id: `espn_${leagueId}_${espnTeamId}_${ev.id || idx}`,
        date: `${monthNames[eventDate.getMonth()]} ${eventDate.getDate()}`,
        month: monthNames[eventDate.getMonth()],
        day: String(eventDate.getDate()),
        opponent: opponentName,
        opponentLogo: opponent?.team?.logo || undefined,
        venueName: (comp?.venue || ev?.venue)?.fullName || undefined,
        time: eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        ticketStatus: 'Available',
        isPaid: false,
        gameNumber: idx + 1,
        type: 'Regular',
        dateTimeISO: eventDate.toISOString(),
      };
    });

    return c.json({ events: mapped, error: null });
  } catch (e: any) {
    console.error('[COMPAT][ESPN] Error:', e?.message || e);
    return c.json({ events: [], error: 'SERVER_ERROR' });
  }
});

app.post('/compat/tm/getSchedule', async (c) => {
  try {
    const body = await c.req.json();
    const input = body || {};
    const apiKey = process.env.TICKETMASTER_API_KEY || '';
    if (!apiKey) return c.json({ events: [], error: 'API_KEY_MISSING' });

    const teamKeyword = (input.teamName) || '';
      const now = new Date();
      const dateRangeStart = new Date(now.getFullYear() - 1, 8, 1).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const dateRangeEnd = new Date(now.getFullYear(), 5, 30).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({ apikey: apiKey, keyword: teamKeyword, size: '200', sort: 'date,asc', startDateTime: dateRangeStart, endDateTime: dateRangeEnd });
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
    const res = await fetch(url).catch((e) => { console.error('[COMPAT][TM] fetch error', e); return null; });
    if (!res) {
      console.error('[COMPAT][TM] no response from Ticketmaster');
      return c.json({ events: [], error: 'FETCH_FAILED' });
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      console.error('[COMPAT][TM] non-ok response', res.status, txt.slice(0, 1000));
      return c.json({ events: [], error: 'FETCH_FAILED' });
    }
    const data: any = await res.json();
    const rawEvents: any[] = data?._embedded?.events || [];
    const homeEvents = rawEvents.filter((ev: any) => {
      const eventVenueName = ev?._embedded?.venues?.[0]?.name || '';
      const eventName = (ev.name || '').toLowerCase();
      const teamFirstWord = (teamKeyword || '').split(' ')[0].toLowerCase();
      if (eventName.includes(teamFirstWord + ' vs') || eventName.startsWith(teamFirstWord)) return true;
      if (eventName.includes(' at ')) {
        const parts = eventName.split(' at ');
        if (parts.length === 2) {
          const homeTeamPart = parts[1].toLowerCase();
          if (homeTeamPart.includes(teamFirstWord)) return true;
        }
      }
      return false;
    });
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mapped = homeEvents.map((ev: any, idx: number) => {
      const eventDate = new Date(ev.dates?.start?.dateTime || ev.dates?.start?.localDate);
      const attractions: any[] = ev?._embedded?.attractions || [];
      const opponent = attractions.find((a: any) => !(a.name || '').toLowerCase().includes((teamKeyword || '').split(' ')[0].toLowerCase()));
      const opponentName = opponent?.name || ev.name || 'TBD';
      const opponentLogo = opponent?.images?.[0]?.url;
      const venue = ev?._embedded?.venues?.[0];
      return {
        ticketmasterEventId: ev.id,
        id: `tm_${input.leagueId || 'unk'}_${input.teamId || 'unk'}_${ev.id}`,
        date: `${monthNames[eventDate.getMonth()]} ${eventDate.getDate()}`,
        month: monthNames[eventDate.getMonth()],
        day: String(eventDate.getDate()),
        opponent: opponentName,
        opponentLogo: opponentLogo || undefined,
        venueName: venue?.name || undefined,
        time: eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        ticketStatus: 'Available',
        isPaid: false,
        gameNumber: idx + 1,
        type: 'Regular',
        dateTimeISO: eventDate.toISOString(),
      };
    });
    return c.json({ events: mapped, error: null });
  } catch (e: any) {
    console.error('[COMPAT][TM] Error:', e?.message || e);
    return c.json({ events: [], error: 'SERVER_ERROR' });
  }
});

const port = 8788;
try {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`Server running on http://localhost:${port}`);
} catch (error) {
  console.error('Error starting server:', error);
}
