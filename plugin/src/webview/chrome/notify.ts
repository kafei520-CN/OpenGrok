import type { NotifyCue } from '../../core/runtime/notify';

let ctx: AudioContext | undefined;
let master: DynamicsCompressorNode | undefined;

export function playNotify(cue: NotifyCue): void {
  const audio = context();
  if (!audio || !master) {
    return;
  }
  void audio.resume().then(() => {
    const t0 = audio.currentTime + 0.02;
    if (cue === 'done') {
      tone(audio, t0, 988, 0.16, 0.9);
      tone(audio, t0 + 0.14, 1319, 0.22, 1);
      return;
    }
    tone(audio, t0, 392, 0.2, 0.95);
    tone(audio, t0 + 0.18, 294, 0.28, 1);
  }).catch(() => undefined);
}

function context(): AudioContext | undefined {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return undefined;
  }
  if (!ctx) {
    ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    comp.connect(makeup);
    makeup.connect(ctx.destination);
    master = comp;
  }
  return ctx;
}

function tone(audio: AudioContext, at: number, freq: number, dur: number, peak: number): void {
  if (!master) {
    return;
  }
  const mix = audio.createGain();
  mix.gain.setValueAtTime(0.0001, at);
  mix.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  mix.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  mix.connect(master);
  for (const [type, ratio, amp] of [
    ['triangle', 1, 0.7],
    ['square', 1, 0.35],
    ['sine', 2, 0.22],
  ] as const) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq * ratio;
    gain.gain.value = amp;
    osc.connect(gain);
    gain.connect(mix);
    osc.start(at);
    osc.stop(at + dur + 0.04);
  }
}
