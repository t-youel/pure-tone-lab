#!/usr/bin/env python3
"""Prepare a song for Learn from the pros: his voice, his sung phrases, and the timing of every word.

  python3 tools/prepare_song.py "songs/Crazy Glue - Josh Woodward.mp3" "songs/Crazy Glue (Instrumental) - Josh Woodward.mp3" out_dir

Steps (all measured, nothing guessed):
  1. Line the song and its official instrumental up to the sample (cross-correlation).
  2. Take the band out frequency by frequency (spectral subtraction, robust to small MP3 differences): his voice alone.
  3. Find his sung phrases (voice present, breaths of 0.25 s or more between) and his syllable onsets in each.
  4. Print a table of phrases (start, length, syllable onsets) to set beside the lyric lines and their syllable counts.
     A person then writes the plan (which lines go on which phrases) as JSON: [[[line numbers], [phrase numbers]], ...].
  5. With the plan: each phrase's first syllable pinned where he starts singing, the rest placed on his syllable onsets
     in order (extra onsets skipped, missing ones shared out evenly) -> timing.json.
Outputs: voice.wav (his voice alone), phrases.json, onsets.json, and timing.json when a plan is given (plan.json in out_dir).
The app's own analysis is then run on voice.wav for his notes and pitch line, and everything is embedded as a PREPARED song.
Needs: ffmpeg, numpy.
"""
import sys, os, json, re, subprocess, wave
import numpy as np

SR, N, H = 44100, 2048, 512

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()

def stft(x):
    w = np.hanning(N).astype(np.float32); fr = (len(x) - N) // H
    idx = np.arange(N)[None, :] + H * np.arange(fr)[:, None]
    return np.fft.rfft(x[idx] * w, axis=1)

def main(song, inst, out):
    os.makedirs(out, exist_ok=True)
    m, i = decode(song), decode(inst)
    # 1. offset
    seg = slice(20 * SR, 40 * SR); a, b = m[seg], i[seg]; n = len(a) + len(b)
    c = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n)), n); maxlag = 2 * SR
    c = np.concatenate([c[-maxlag:], c[:maxlag + 1]]); lag = int(np.argmax(c) - maxlag)
    if lag > 0: i = np.concatenate([np.zeros(lag, np.float32), i])
    elif lag < 0: i = i[-lag:]
    L = min(len(m), len(i)); m, i = m[:L], i[:L]
    print('offset', lag, 'samples')
    # 2. his voice
    M, I = stft(m), stft(i); aM, aI = np.abs(M), np.abs(I); f = np.fft.rfftfreq(N, 1 / SR)
    g = np.array([np.median((aM[:, k] / (aI[:, k] + 1e-9))[aI[:, k] > np.percentile(aI[:, k], 70)]) if aI[:, k].max() > 0 else 1 for k in range(aM.shape[1])])
    g = np.clip(g, 0.5, 2.0); V = np.maximum(aM - 1.1 * g[None, :] * aI, 0)
    X = V * np.exp(1j * np.angle(M)); fr = X.shape[0]; y = np.zeros(fr * H + N, np.float32); ws = np.zeros_like(y); w = np.hanning(N).astype(np.float32)
    frames = np.fft.irfft(X, N, axis=1).astype(np.float32)
    for k in range(fr): y[k * H:k * H + N] += frames[k] * w; ws[k * H:k * H + N] += w * w
    y /= np.maximum(ws, 1e-3); y /= max(1e-6, np.abs(y).max()) / 0.9
    with wave.open(os.path.join(out, 'voice.wav'), 'wb') as wf: wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes((y * 32767).astype('<i2').tobytes())
    # 3. phrases and syllable onsets
    band = (f >= 150) & (f <= 4000); share = np.sqrt((V[:, band] ** 2).sum(1)) / (np.sqrt((aM[:, band] ** 2).sum(1)) + 1e-9)
    t = np.arange(len(share)) * H / SR; on = np.convolve(share, np.ones(5) / 5, 'same') > 0.15
    ph, s0 = [], None
    for k, v in enumerate(on):
        if v and s0 is None: s0 = k
        if not v and s0 is not None: ph.append([float(t[s0]), float(t[k])]); s0 = None
    mer = []
    for a2, b2 in ph:
        if mer and a2 - mer[-1][1] < 0.25: mer[-1][1] = b2
        else: mer.append([a2, b2])
    ph = [p for p in mer if p[1] - p[0] >= 0.3]
    vb = (f >= 300) & (f <= 5000); E = np.log1p(V[:, vb] * 10); flux = np.concatenate([[0], np.maximum(np.diff(E, axis=0), 0).sum(1)]); fl = np.convolve(flux, np.ones(3) / 3, 'same')
    th = np.median(fl[fl > 0]) * 2.2
    def onsets(a2, b2):
        mm = (t >= a2 - 0.06) & (t < b2); x = fl[mm]; tt = t[mm]; pk = []
        for q in range(1, len(x) - 1):
            if x[q] > th and x[q] >= x[q - 1] and x[q] >= x[q + 1] and (not pk or tt[q] - pk[-1] > 0.11): pk.append(float(tt[q]))
        return pk
    ons = [onsets(*p) for p in ph]
    json.dump(ph, open(os.path.join(out, 'phrases.json'), 'w')); json.dump(ons, open(os.path.join(out, 'onsets.json'), 'w'))
    print('phrase  start    length  syllable onsets')
    for n2, (p, o) in enumerate(zip(ph, ons)): print(f'{n2 + 1:5d}  {int(p[0] // 60)}:{p[0] % 60:05.2f}  {p[1] - p[0]:5.1f}s  {len(o):3d}')
    plan_path = os.path.join(out, 'plan.json')
    if os.path.exists(plan_path) and len(sys.argv) > 4: write_timing(json.load(open(plan_path)), open(sys.argv[4]).read().splitlines(), ph, ons, out)

def syl(w):
    x = re.sub(r"['’](s|re|ll|ve|d|m|t)$", '', w.lower()); x = re.sub('[^a-z]', '', x)
    if not x: return 0
    g = len(re.findall('[aeiouy]+', x))
    if re.search('[^aeiou]e$', x) and g > 1 and not re.search('[^aeiou]le$', x): g -= 1
    if re.search('[^aeiou]ely$', x) and g > 1: g -= 1
    if re.search('[^aeioutd]ed$', x) and g > 1: g -= 1
    return max(1, g)

def split(w):
    n = syl(w)
    if n < 2: return [w]
    parts = re.findall(r'[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?', w, flags=re.I) or [w]
    used = ''.join(parts)
    if len(used) < len(w): parts[-1] += w[len(used):]
    while len(parts) > n: z = parts.pop(); parts[-1] += z
    return [p + ('-' if k < len(parts) - 1 else '') for k, p in enumerate(parts)]

def write_timing(plan, lines, ph, ons, out):
    res = []
    for L, P in plan:
        toks = [(li, s) for li in L for w in lines[li - 1].split() for s in split(w)]
        a0, b0 = ph[P[0] - 1][0], ph[P[-1] - 1][1]; o = [x for p in P for x in ons[p - 1]]
        near = [x for x in o if abs(x - a0) < 0.25]; start = near[0] if near else a0
        rest = [x for x in o if x > start + 0.08]; A, B = len(toks) - 1, len(rest)
        D = np.full((A + 1, B + 1), 1e9); D[0, 0] = 0; bk = {}
        for i2 in range(A + 1):
            for j in range(B + 1):
                if i2 == 0 and j == 0: continue
                c = []
                if i2 and j: c.append((D[i2 - 1, j - 1], 1))
                if j: c.append((D[i2, j - 1] + 0.35, 2))
                if i2: c.append((D[i2 - 1, j] + 1.0, 3))
                v, mv = min(c); D[i2, j] = v; bk[(i2, j)] = mv
        i2, j = A, B; at = [None] * A
        while i2 > 0 or j > 0:
            mv = bk[(i2, j)]
            if mv == 1: at[i2 - 1] = rest[j - 1]; i2 -= 1; j -= 1
            elif mv == 2: j -= 1
            else: i2 -= 1
        at = [start] + at
        for k in range(len(at)):
            if at[k] is None:
                p = k - 1
                while at[p] is None: p -= 1
                n2 = k + 1
                while n2 < len(at) and at[n2] is None: n2 += 1
                hi = at[n2] if n2 < len(at) else b0; at[k] = at[p] + (hi - at[p]) * (k - p) / (n2 - p)
        for li in L:
            ks = [k for k, (l2, _) in enumerate(toks) if l2 == li]
            tk = [{'txt': toks[k][1], 't0': round(at[k], 2), 't1': round(at[k + 1] if k + 1 < len(at) else b0, 2)} for k in ks]
            res.append({'li': li - 1, 't0': tk[0]['t0'], 't1': tk[-1]['t1'], 'toks': tk})
    json.dump(res, open(os.path.join(out, 'timing.json'), 'w')); print('timing.json written:', len(res), 'lines')

if __name__ == '__main__':
    if len(sys.argv) < 4: print(__doc__); sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
