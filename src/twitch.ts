import WebSocket from 'ws';
export interface TwitchOptions {
  clientId: string; token: () => Promise<string>; broadcasterId: string; userId: string;
  onChat: (username: string, displayName: string, text: string) => void;
  onFollow: (name: string) => void; onRaid: (name: string) => void;
  onStatus: (status: string) => void;
}
export class TwitchClient {
  private sockets = new Set<WebSocket>();
  private active?: WebSocket;
  private seen = new Map<string, number>();
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  constructor(private options: TwitchOptions) {}
  start() { this.stopped = false; this.connect('wss://eventsub.wss.twitch.tv/ws'); }
  stop() { this.stopped = true; clearTimeout(this.retry); for (const ws of this.sockets) ws.close(); this.sockets.clear(); }
  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.options.onStatus('Reconnecting to Twitch…');
    this.retry = setTimeout(() => { this.retry = undefined; if (!this.sockets.size) this.connect('wss://eventsub.wss.twitch.tv/ws'); }, Math.min(30_000, 1000 * 2 ** this.attempts++));
  }
  private connect(url: string, previous?: WebSocket) {
    if (this.stopped) return;
    const ws = new WebSocket(url); this.sockets.add(ws);
    let welcomed = false;
    let watchdog: ReturnType<typeof setTimeout>;
    let timeout = 15_000;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ws.terminate(), timeout); };
    arm();
    ws.on('message', raw => {
      arm();
      void (async () => {
        const message = JSON.parse(raw.toString());
        const { metadata, payload } = message;
        const now = Date.now();
        for (const [id, at] of this.seen) if (now - at > 600_000) this.seen.delete(id);
        if (this.seen.has(metadata.message_id)) return;
        this.seen.set(metadata.message_id, now);
        if (this.seen.size > 20_000) this.seen.delete(this.seen.keys().next().value!);
        switch (metadata.message_type) {
          case 'session_welcome': {
            welcomed = true; this.active = ws; this.attempts = 0;
            timeout = (payload.session.keepalive_timeout_seconds ?? 10) * 1000 + 3000; arm();
            if (previous) previous.close();
            else await this.subscribe(payload.session.id);
            this.options.onStatus('Twitch connected · chat / follows / raids');
            break;
          }
          case 'session_keepalive': break;
          case 'session_reconnect': {
            const target = new URL(payload.session.reconnect_url);
            if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Invalid reconnect URL');
            // Subscriptions migrate; the old socket stays alive until the new welcome.
            this.connect(target.href, ws); break;
          }
          case 'revocation': this.options.onStatus(`Subscription revoked: ${payload.subscription.type}. Reconnect with Twitch.`); break;
          case 'notification': {
            const event = payload.event;
            if (metadata.subscription_type === 'channel.chat.message') this.options.onChat(event.chatter_user_login, event.chatter_user_name, event.message.text);
            if (metadata.subscription_type === 'channel.follow') this.options.onFollow(event.user_name);
            if (metadata.subscription_type === 'channel.raid') this.options.onRaid(event.from_broadcaster_user_name);
          }
        }
      })().catch(() => { this.options.onStatus('Twitch connection/subscription failed. Check credentials and reconnect.'); ws.terminate(); });
    });
    ws.on('error', () => { this.options.onStatus('Twitch socket error'); });
    ws.on('close', () => {
      clearTimeout(watchdog); this.sockets.delete(ws);
      if (this.stopped) return;
      if (this.active === ws || !welcomed && (!previous || previous.readyState !== WebSocket.OPEN)) this.scheduleRetry();
      else if (!welcomed && previous?.readyState === WebSocket.OPEN) { previous.terminate(); this.scheduleRetry(); }
    });
  }
  private async subscribe(sessionId: string) {
    const o = this.options;
    for (const [type, version, condition] of [
      ['channel.chat.message', '1', { broadcaster_user_id: o.broadcasterId, user_id: o.userId }],
      ['channel.follow', '2', { broadcaster_user_id: o.broadcasterId, moderator_user_id: o.userId }],
      ['channel.raid', '1', { to_broadcaster_user_id: o.broadcasterId }],
    ] as const) {
      const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST', headers: { 'Client-Id': o.clientId, Authorization: `Bearer ${await o.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: sessionId } }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Subscription ${type}: ${response.status}`);
    }
  }
}
