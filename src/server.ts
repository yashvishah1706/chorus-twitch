import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { INSTRUMENTS, chatNote, celebration, smoothEnergy, type Instrument, type Note } from './engine.js';
import { TwitchClient } from './twitch.js';
export function createChorus(demo = false) {
  const app = express(); const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const state = { bpm: 120, volume: 0.45, muted: Object.fromEntries(INSTRUMENTS.map(i => [i, false])) as Record<Instrument, boolean>, stopped: false, demo, twitch: demo ? 'SIMULATED · demo mode' : 'Twitch disconnected', energy: 0 };
  let twitch: TwitchClient | undefined;
  let tokens: { access_token: string; refresh_token: string; expires_in: number } | undefined;
  let expires = 0; let refreshTask: Promise<string> | undefined;
  let validationTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const oauthStates = new Map<string, number>();
  let messages = 0; let sequence = 0;
  const broadcast = (event: unknown) => {
    const data = JSON.stringify(event);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 1_000_000) ws.terminate(); else ws.send(data); }
  };
  const sendState = () => broadcast({ type: 'state', state, serverTime: Date.now() });
  const emitNotes = (notes: Note[]) => { if (!state.stopped) for (const note of notes) broadcast({ ...note, id: `${note.id}-${sequence++}` }); };
  const chat = (username: string, name: string, text: string, simulated = demo) => { messages++; emitNotes([chatNote(username, name, text, Date.now(), state.bpm, simulated)]); };
  const celebrate = (kind: 'follow' | 'raid', name: string, simulated = demo) => emitNotes(celebration(kind, name, Date.now(), state.bpm, simulated));
  const energyTimer = setInterval(() => { state.energy = smoothEnergy(state.energy, messages, 1); messages = 0; sendState(); }, 1000);
  function config() {
    const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: secret, TWITCH_CHANNEL: channel, TWITCH_REDIRECT_URI: redirect } = process.env;
    if (!clientId || !secret || !channel || !redirect) throw new Error('Set all four Twitch environment variables in .env first.');
    return { clientId, secret, channel, redirect };
  }
  async function token(): Promise<string> {
    if (!tokens) throw new Error('Login required');
    if (Date.now() < expires - 60_000) return tokens.access_token;
    if (!refreshTask) refreshTask = (async () => {
      const c = config();
      const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens!.refresh_token, client_id: c.clientId, client_secret: c.secret }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Token refresh failed; reconnect with Twitch');
      tokens = await response.json() as typeof tokens;
      expires = Date.now() + tokens!.expires_in * 1000; return tokens!.access_token;
    })().finally(() => { refreshTask = undefined; });
    return refreshTask;
  }
  // Local control surface: bind loopback and reject cross-origin mutations/upgrades.
  const sameOrigin = (origin: string | undefined, host: string | undefined) => !origin || origin === `http://${host}`;
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST' && (!sameOrigin(req.headers.origin, req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site')) { res.sendStatus(403); return; }
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !sameOrigin(req.headers.origin, req.headers.host)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'state', state, serverTime: Date.now() }));
    ws.on('message', raw => { try { const event = JSON.parse(raw.toString()); if (event.type === 'ping') ws.send(JSON.stringify({ type: 'pong', sent: event.sent, serverTime: Date.now() })); } catch { /* ignore malformed client messages */ } });
    ws.on('error', () => {});
  });
  app.get('/api/state', (_req, res) => res.json({ state, serverTime: Date.now() }));
  app.post('/api/controls', (req, res) => {
    const b = req.body ?? {};
    if (b.bpm !== undefined && (!Number.isFinite(b.bpm) || b.bpm < 40 || b.bpm > 240) || b.volume !== undefined && (!Number.isFinite(b.volume) || b.volume < 0 || b.volume > 1) || b.stopped !== undefined && typeof b.stopped !== 'boolean' || b.muted !== undefined && (!b.muted || typeof b.muted !== 'object' || Object.entries(b.muted).some(([k,v]) => !INSTRUMENTS.includes(k as Instrument) || typeof v !== 'boolean'))) { res.status(400).json({ error: 'Invalid controls' }); return; }
    if (b.bpm !== undefined && b.bpm !== state.bpm) { state.bpm = b.bpm; broadcast({type:'clear'}); }
    if (b.volume !== undefined) state.volume = b.volume;
    if (b.muted) Object.assign(state.muted, b.muted);
    if (b.stopped !== undefined) state.stopped = b.stopped;
    if (state.stopped) broadcast({type:'panic'});
    sendState(); res.json(state);
  });
  for (const kind of ['follow', 'raid'] as const) app.post(`/simulate/${kind}`, (_req, res) => { celebrate(kind, 'DemoChatter', true); res.json({ simulated: true, kind }); });
  app.get('/login', (_req, res) => {
    if (demo) { res.status(400).send('Stop demo and run npm run dev to connect live Twitch.'); return; }
    try {
      const c = config(); const nonce = randomBytes(32).toString('hex');
      for (const [id, until] of oauthStates) if (until < Date.now()) oauthStates.delete(id);
      if (oauthStates.size > 100) oauthStates.clear();
      oauthStates.set(nonce, Date.now() + 600_000);
      res.cookie('chorus_oauth', nonce, { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/callback' });
      res.redirect('https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirect, response_type: 'code', scope: 'user:read:chat moderator:read:followers', state: nonce }));
    } catch (error) { res.status(400).send((error as Error).message); }
  });
  app.get('/callback', async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    const nonce = typeof req.query.state === 'string' ? req.query.state : '';
    const cookie = req.headers.cookie?.split('; ').find(v => v.startsWith('chorus_oauth='))?.slice(13) ?? '';
    const until = oauthStates.get(nonce) ?? 0; oauthStates.delete(nonce);
    res.clearCookie('chorus_oauth', {path:'/callback'});
    if (!nonce || cookie.length !== nonce.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(nonce)) || until < Date.now() || typeof req.query.code !== 'string') { res.status(400).send('Invalid or expired OAuth session. Try /login again.'); return; }
    try {
      const c = config();
      const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, code: req.query.code, grant_type: 'authorization_code', redirect_uri: c.redirect }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('OAuth token exchange failed');
      const candidate = await response.json() as NonNullable<typeof tokens>;
      const headers = { 'Client-Id': c.clientId, Authorization: `Bearer ${candidate.access_token}` };
      const validation = await fetch('https://id.twitch.tv/oauth2/validate', {headers:{Authorization:`OAuth ${candidate.access_token}`}, signal:AbortSignal.timeout(10_000)});
      if (!validation.ok) throw new Error('OAuth validation failed');
      const identity = await validation.json() as {user_id:string; client_id:string; scopes:string[]};
      if (identity.client_id !== c.clientId || !['user:read:chat','moderator:read:followers'].every(s => identity.scopes.includes(s))) throw new Error('Required Twitch permissions missing');
      const users = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(c.channel)}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!users.ok) throw new Error('Channel lookup failed');
      const channel = (await users.json() as { data: {id:string}[] }).data[0];
      if (!channel || identity.user_id !== channel.id) throw new Error('Sign in as the configured channel broadcaster.');
      twitch?.stop(); tokens = candidate; expires = Date.now() + tokens.expires_in * 1000;
      twitch = new TwitchClient({clientId:c.clientId, token, broadcasterId:channel.id, userId:identity.user_id, onChat:chat, onFollow:name=>celebrate('follow',name,false), onRaid:name=>celebrate('raid',name,false), onStatus:status=>{state.twitch=status;sendState();}});
      twitch.start(); clearInterval(validationTimer); clearInterval(refreshTimer);
      refreshTimer = setInterval(() => { void token().catch(() => { twitch?.stop(); clearInterval(refreshTimer); state.twitch='Token refresh failed · reconnect with Twitch'; sendState(); }); }, 60_000);
      validationTimer = setInterval(() => { void (async () => {
        const check = await fetch('https://id.twitch.tv/oauth2/validate', {headers:{Authorization:`OAuth ${await token()}`},signal:AbortSignal.timeout(10_000)});
        if (!check.ok) throw new Error('Session invalid');
      })().catch(() => {twitch?.stop(); state.twitch='Session expired · reconnect with Twitch';sendState();}); }, 3_600_000);
      res.redirect('/dashboard.html');
    } catch (error) { res.status(400).send((error as Error).message); }
  });
  app.get('/', (_req, res) => res.redirect('/dashboard.html'));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({error:'Invalid request'}); });
  return { app, server, state, chat, celebrate, listen: () => server.listen(3000, '127.0.0.1', () => console.log(`Chorus ${demo ? 'SIMULATED demo' : 'live'} · http://localhost:3000`)), close: () => {clearInterval(energyTimer);clearInterval(validationTimer);clearInterval(refreshTimer);twitch?.stop();for(const ws of wss.clients)ws.terminate();wss.close();server.close();} };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chorus = createChorus(); chorus.listen();
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => chorus.close());
}
