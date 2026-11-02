# Chorus

Your Twitch chat is a live synthesized band. Every message becomes a note in C major pentatonic, quantized to a sixteenth-note grid. No samples: all melodic voices, kick, snare, hats, bells, and fanfares use Web Audio oscillators.

## Run the demo

Requires Node.js 22.9+ and npm.

```sh
npm install
npm test
npm run demo
```

Open http://localhost:3000 for the mixing desk. Open http://localhost:3000/overlay.html in a separate browser tab and click **Enable audio**. The dashboard itself does not play audio. Demo chat, follow arpeggios, and raid fanfares are labeled **SIMULATED**. Demo requires no Twitch credentials. Stop with Ctrl-C before starting live mode.

## Connect Twitch

```sh
cp .env.example .env
# Fill TWITCH_CLIENT_SECRET in .env locally.
npm run dev
```

All Twitch configuration is read from `process.env`. Node loads the local `.env` through the npm scripts. The supplied public client ID and channel are examples in `.env.example`; no credentials are embedded in source. `.env` and variants are ignored by Git. Keep the secret private.

Register `http://localhost:3000/callback` as an OAuth redirect in the Twitch developer console for your application. Set these four variables:

| Variable | Purpose |
| --- | --- |
| TWITCH_CLIENT_ID | Your Twitch application's client ID |
| TWITCH_CLIENT_SECRET | Your local client secret |
| TWITCH_CHANNEL | Channel login to listen to |
| TWITCH_REDIRECT_URI | Exact registered callback URI |

Click **Connect Twitch** on the dashboard and authorize **as the configured broadcaster**. Chorus requests `user:read:chat` and `moderator:read:followers`. Tokens remain in server memory, refresh automatically, and are validated hourly; restart requires signing in again. This broadcaster-only flow simplifies follow authorization. EventSub subscriptions cover `channel.chat.message` v1, `channel.follow` v2, and incoming `channel.raid` v1. Connection and subscription failures appear in the dashboard.

## OBS setup

1. Add a Browser Source with URL `http://localhost:3000/overlay.html`, width 1920, height 1080. The background is transparent.
2. Right-click the source → **Interact** → click **Enable audio**. Browser autoplay requires this gesture. If OBS reloads the source, enable it again.
3. Enable **Control audio via OBS** in source properties to route browser sound through the OBS mixer. Avoid opening another audible overlay simultaneously, which doubles the sound.
4. Keep the dashboard open for tempo (40–240 BPM), master volume, nine instrument mutes, and **PANIC STOP**. Panic immediately stops audio and clears pending notes, pauses new notes, and remains paused until **RESUME BAND**. Tempo changes clear the pending grid before scheduling new notes.

Send normal chat for pitched notes. Send `!drum kick`, `!drum snare`, or `!drum hat` for percussion. Every chatter gets a stable instrument and color from a case-insensitive username hash. Follows play a bell arpeggio; raids play a fanfare. **SIMULATE follow** and **SIMULATE raid** are local tests and always visibly labeled, even in live mode.

## Timing and rendering

The pure engine uses millisecond timestamps and a sixteenth-note step of `60000 / BPM / 4` (125 ms at 120 BPM). Notes are scheduled about 1.3 seconds ahead so they can visibly fall toward the hit line. A WebSocket clock ping estimates the server offset using the round-trip midpoint. The overlay checks its audio queue every 25 ms and schedules 120 ms ahead using `AudioContext.currentTime`. Late notes over 70 ms are discarded. Background browser throttling can affect timing; keep the OBS source active.

Melodic pitches use C/D/E/G/A across octaves; percussion intentionally uses nonpitched oscillator stacks. Master gain, envelopes, a compressor, and a 96-oscillator ceiling bound output. Queues and socket buffers are bounded for busy channels. Energy is a smoothed chat-rate indicator on the dashboard. The app binds only `127.0.0.1:3000`; it is a local stream tool, not a hosted multi-user service. Pages and mutations must use the same host (`localhost` recommended).

## Development

```sh
npm test             # Vitest engine invariants
npm run check        # strict TypeScript
npm run build        # compile into dist/
npm start            # run compiled live server
```

- `src/engine.ts`: pure scale, grid, voice/color hash, energy smoothing, note/celebration construction.
- `src/twitch.ts`: EventSub lifecycle, keepalive watchdog, reconnect handoff, bounded ten-minute message-ID deduplication, subscriptions.
- `src/server.ts`: Express, OAuth, token refresh/validation, local controls, WebSocket fan-out, static assets.
- `public/overlay.html`: transparent Canvas stage and oscillator scheduler.
- `public/dashboard.html`: responsive mixing desk and simulation controls.
- `public/client.js`: shared reconnecting WebSocket and clock sync.
- `src/demo.ts`: synthetic chat and periodic simulated celebrations.
- `tests/engine.test.ts`: grid alignment, scale membership, deterministic voices, and note behavior.

Twitch references: [WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), [OAuth authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow).
