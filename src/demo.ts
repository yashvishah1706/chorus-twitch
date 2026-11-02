import { createChorus } from './server.js';
const chorus = createChorus(true);
chorus.listen();
const names = ['LunaLoops','PixelPilot','CozyComet','SynthSage','NeonNori','BassBean','VelvetFox','MoonMochi','OrbitOtter','Yashvi'];
const messages = ['this sounds amazing','hello chorus!','we are the band','pentatonic party','!drum kick','!drum snare','!drum hat','more synth please','TwitchCon energy'];
let count = 0;
let timer: ReturnType<typeof setTimeout>;
function next() {
  const name = names[Math.floor(Math.random() * names.length)]!;
  chorus.chat(name.toLowerCase(), name, messages[Math.floor(Math.random() * messages.length)]!, true);
  if (++count % 36 === 0) chorus.celebrate(count % 72 === 0 ? 'raid' : 'follow', 'DemoCrew', true);
  timer = setTimeout(next, 180 + Math.random() * 650);
}
timer = setTimeout(next, 1500);
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { clearTimeout(timer); chorus.close(); });
