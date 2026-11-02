// builds a synthetic "pro" recording inside the page and returns a WAV blob; shared by the check script and the test
window.makeProSong = async function (opts = {}) {
  const SR = 44100, beat = 0.6, tune = 0.10; // 100 bpm, recording 10 cents sharp
  // [midi, beats, cents off, vibrato, slide-in]
  let mel = [[60,1,0],[62,1,0],[64,1,0],[65,1,0],[67,2,0,1],[69,1,0],[67,1,-40],[65,1,0],[64,1,0],[62,2,0,1],[60,1,0,0,1],[64,1,0],[67,3,0,1]];
  // the hard case: an in-key note sung 60 cents flat, and a quick 80 ms grace note
  if (opts.hard) { mel[8] = [64, 1, -60]; mel.splice(3, 0, [67, 0.15, 0]); }
  const lead = opts.bass ? 3.6 : 1.2, total = lead + mel.reduce((a, n) => a + n[1], 0) * beat + 1;
  const off = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
  const vox = off.createGain(); vox.gain.value = 0.5; vox.connect(off.destination);
  let t = lead;
  for (const [m, b, c, vib, slide] of mel) {
    const f = 440 * Math.pow(2, (m + tune + c / 100 - 69) / 12), d = b * beat * 0.9;
    const o = off.createOscillator(); o.setPeriodicWave(off.createPeriodicWave(new Float32Array([0, 1, .5, .35, .2, .12, .08]), new Float32Array(7)));
    if (slide) { o.frequency.setValueAtTime(f * Math.pow(2, -1.5 / 12), t); o.frequency.linearRampToValueAtTime(f, t + 0.18); } else o.frequency.setValueAtTime(f, t);
    if (vib) { const l = off.createOscillator(), lg = off.createGain(); l.frequency.value = 5.5; lg.gain.value = f * 0.02; l.connect(lg); lg.connect(o.frequency); l.start(t + 0.35); l.stop(t + d); }
    const g = off.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.04); g.gain.setValueAtTime(0.4, t + d - 0.05); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(g); g.connect(vox); o.start(t); o.stop(t + d + 0.02); t += b * beat;
  }
  // optional bass guitar: low root notes, two beats each, an octave and more below the voice
  if (opts.bass) for (let k = 0, tt = lead - beat * 4; tt < total - 1; k++, tt += beat * 2) {
    const o = off.createOscillator(), lp = off.createBiquadFilter(), g = off.createGain(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, ([40, 45, 43, 38][k % 4] + tune - 69) / 12);
    lp.type = 'lowpass'; lp.frequency.value = 350; g.gain.setValueAtTime(0.14, tt); g.gain.setValueAtTime(0.14, tt + beat * 1.8); g.gain.linearRampToValueAtTime(0, tt + beat * 1.95);
    o.connect(lp); lp.connect(g); g.connect(off.destination); o.start(tt); o.stop(tt + beat * 2);
  }
  // drums: kick on every beat, hats on the eighths
  const nb = off.createBuffer(1, SR, SR), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (let k = 0; lead + k * beat / 2 < total - 0.5; k++) {
    const tt = lead + k * beat / 2;
    if (k % 2 === 0) { const o = off.createOscillator(), g = off.createGain(); o.frequency.setValueAtTime(120, tt); o.frequency.exponentialRampToValueAtTime(45, tt + 0.12); g.gain.setValueAtTime(0.6, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.25); o.connect(g); g.connect(off.destination); o.start(tt); o.stop(tt + 0.3); }
    const n = off.createBufferSource(), hp = off.createBiquadFilter(), g2 = off.createGain(); n.buffer = nb; hp.type = 'highpass'; hp.frequency.value = 7000; g2.gain.setValueAtTime(0.12, tt); g2.gain.exponentialRampToValueAtTime(0.001, tt + 0.04); n.connect(hp); hp.connect(g2); g2.connect(off.destination); n.start(tt); n.stop(tt + 0.06);
  }
  const buf = await off.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, dv = new DataView(new ArrayBuffer(44 + n * 4));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); ws(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  return new Blob([dv.buffer], { type: 'audio/wav' });
};
