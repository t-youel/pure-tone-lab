#!/usr/bin/env python3
"""Time every word of a song on the singer's voice alone (voice.wav from prepare_song.py).

  python3 tools/time_words.py voice.wav lyrics.txt spans.json timing.json [analysis.json]

analysis.json (optional): the app's analysis of his voice; where his pitch moves to a new note is extra evidence of a new syllable.

spans.json: [[line number, start seconds], ...] in singing order (a line may appear more than once). Each start is the
moment the line begins, found from the evidence (his phrases, the breaths between them, repeated melodies); it is snapped
to where his voice actually comes in nearby. A line ends where his voice stops before the next line (or at an optional
third value [line, start, end]).
Inside a line, each sung syllable is a peak in the loudness of his voice (300-3000 Hz) with a dip of 4 dB or more before
the next; the words' syllables are laid on those, in order (extra peaks skipped, missing ones shared out).
Prints, per line, the syllables in the words against the syllables heard, so doubtful lines can be checked.
"""
import sys, json, re, wave
import numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
from syllables import parts as split

def load(path):
    w = wave.open(path); sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32) / 32768
    N, H = 1024, sr // 100; win = np.hanning(N); f = np.fft.rfftfreq(N, 1 / sr); band = (f > 300) & (f < 3000); fr = (len(x) - N) // H
    E = np.empty(fr)
    for i in range(0, fr, 2000):
        j = min(fr, i + 2000); idx = np.arange(N)[None, :] + H * np.arange(i, j)[:, None]
        E[i:j] = (np.abs(np.fft.rfft(x[idx] * win, axis=1))[:, band] ** 2).sum(1)
    db = 10 * np.log10(np.convolve(E, np.ones(5) / 5, 'same') + 1e-9)
    return db  # 100 frames per second

def main(vp, lp, sp, op, ap=None):
    noteStarts = np.array([n[0] for n in json.load(open(ap))['notes']]) if ap else np.array([])
    db = load(vp); ref = np.percentile(db, 95); on = db > ref - 20; floor = ref - 25
    lines = [l for l in open(lp, encoding='utf8').read().splitlines()]
    spans = json.load(open(sp)); out = []
    def snap(t):  # the voice coming in nearest t (within 0.4 s)
        i = int(t * 100); best = i; bd = 1e9
        for k in range(max(1, i - 40), min(len(on) - 1, i + 40)):
            if on[k] and not on[k - 1] and abs(k - i) < bd: bd = abs(k - i); best = k
        return best / 100
    starts = [snap(s[1]) for s in spans]
    for n, s in enumerate(spans):
        li, t0 = s[0], starts[n]; nxt = starts[n + 1] if n + 1 < len(spans) else len(db) / 100
        if len(s) > 2: t1 = s[2]
        else:
            # the line ends at his first pause of 0.8 s or more (or where the next line starts)
            k = int(t0 * 100); lim = int(min(nxt, t0 + 20) * 100); last_on = k
            while k < lim:
                if on[k]: last_on = k
                elif k - last_on >= 80: break
                k += 1
            t1 = (last_on + 1) / 100
        d = db[int(t0 * 100):int(t1 * 100)]; pk = []; cand = None
        for i in range(1, len(d) - 1):
            if d[i] >= d[i - 1] and d[i] >= d[i + 1] and d[i] > floor:
                if cand is None or d[i] > d[cand]: cand = i
            if cand is not None and d[cand] - d[i] >= 4:
                if not pk or cand - pk[-1] >= 10: pk.append(cand)
                cand = None
        if cand is not None and (not pk or cand - pk[-1] >= 10): pk.append(cand)
        # each heard syllable starts at the low point before its peak
        ons = [t0]; depth = [99.0]
        for a, b in zip(pk, pk[1:]): m = a + int(np.argmin(d[a:b + 1])); ons.append(t0 + m / 100); depth.append(min(8.0, float(min(d[a], d[b]) - d[m])) + (6 if len(noteStarts) and np.min(np.abs(noteStarts - ons[-1])) < 0.1 else 0))  # a stop consonant (the d in fades) also makes a gap, so a gap counts only so much
        heard = len(ons)
        # where his pitch moves to a new note is a candidate too (a held vowel can change note without a dip)
        for ns in noteStarts[(noteStarts > t0 + 0.08) & (noteStarts < t1 - 0.08)]:
            k = int(np.argmin(np.abs(np.array(ons) - ns)))
            if abs(ons[k] - ns) < 0.1: continue
            ons.append(float(ns)); depth.append(6.0)
        o = np.argsort(ons); ons = [ons[k] for k in o]; depth = [depth[k] for k in o]
        toks = [p for w in lines[li - 1].split() for p in split(w)]; A, B = len(toks), len(ons)
        if B > A:  # more swells than syllables (held notes waver): choose A starts together - clear breaks (deep dips,
            # a new note), no syllable shorter than it can be sung, and the last one held (singers hold the line's end)
            lam = 4.0; NEG = -1e9; S = np.full((A, B), NEG); bp = np.zeros((A, B), int); S[0, 0] = 0
            for i in range(1, A):
                for j in range(i, B):
                    best, arg = NEG, 0
                    for p in range(i - 1, j):
                        if S[i - 1, p] <= NEG: continue
                        v = S[i - 1, p] + depth[j] + lam * np.log(max(0.05, ons[j] - ons[p]))
                        if v > best: best, arg = v, p
                    S[i, j] = best; bp[i, j] = arg
            fin = [S[A - 1, j] + 3 * lam * np.log(max(0.05, t1 - ons[j])) if S[A - 1, j] > NEG else NEG for j in range(B)]
            j = int(np.argmax(fin)); keep = [j]
            for i in range(A - 1, 0, -1): j = bp[i, j]; keep.append(j)
            ons = [ons[k] for k in reversed(keep)]; B = A
        # lay the word-syllables on the heard ones in order: the first on the line start; skip extra heard ones, share out missing
        D = np.full((A + 1, B + 1), 1e9); D[1, 1] = 0; bk = {}
        for i in range(1, A + 1):
            for j in range(1, B + 1):
                if i == 1 and j == 1: continue
                c = []
                if i > 1 and j > 1: c.append((D[i - 1, j - 1], 1))
                if j > 1: c.append((D[i, j - 1] + 0.35, 2))
                if i > 1: c.append((D[i - 1, j] + 1.0, 3))
                v, mv = min(c); D[i, j] = v; bk[(i, j)] = mv
        i, j = A, B; at = [None] * A
        while i > 1 or j > 1:
            mv = bk[(i, j)]
            if mv == 1: at[i - 1] = ons[j - 1]; i -= 1; j -= 1
            elif mv == 2: j -= 1
            else: i -= 1
        at[0] = t0
        for k in range(A):
            if at[k] is None:
                p = k - 1; q = k + 1
                while q < A and at[q] is None: q += 1
                hi = at[q] if q < A else t1; at[k] = at[p] + (hi - at[p]) * (k - p) / (q - p)
        toks_t = [[toks[k], round(at[k], 2), round(at[k + 1] if k + 1 < A else t1, 2)] for k in range(A)]
        out.append([li - 1, toks_t])
        flag = '' if heard >= A * 0.8 else '   <-- fewer heard than words'
        print(f"L{li:2d} {int(t0 // 60)}:{t0 % 60:05.2f}-{int(t1 // 60)}:{t1 % 60:05.2f}  words {A:2d}  heard {heard:2d}{flag}  {lines[li - 1][:50]}")
    json.dump(out, open(op, 'w'))

if __name__ == '__main__':
    if len(sys.argv) < 5: print(__doc__); sys.exit(1)
    main(*sys.argv[1:6])
