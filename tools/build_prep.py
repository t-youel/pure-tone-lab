#!/usr/bin/env python3
"""Build a PREPARED song for the app from the app's analysis of his voice (analysis.json) and the word timing
(timing.json from time_words.py): one bar per sung syllable, its pitch the middle of his voice line over the syllable,
octave slips folded toward the syllables around it.
  python3 tools/build_prep.py analysis.json timing.json out.json"""
import sys, json
import numpy as np

def main(ap, tp, op):
    an = json.load(open(ap)); tm = json.load(open(tp)); hop, t0f = an['hop'], an['t0f']
    tr = np.array([v / 10 if v else np.nan for v in an['trace']])
    tm = [[li, [[txt.replace("'", '’'), t0, t1] for txt, t0, t1 in toks]] for li, toks in tm]
    syl = [(li, txt, t0, t1) for li, toks in tm for txt, t0, t1 in toks]
    raw = []
    for li, txt, t0, t1 in syl:
        d = t1 - t0; a = int((t0 + 0.15 * d - t0f) / hop); b = int((t1 - 0.1 * d - t0f) / hop) + 1
        v = tr[max(0, a):max(a + 1, b)]; v = v[~np.isnan(v)]
        raw.append(float(np.median(v)) if len(v) >= 2 else None)
    mids = []
    for k, m in enumerate(raw):
        if m is None: mids.append(None); continue
        around = [x for j, x in enumerate(raw) if x is not None and j != k and abs(syl[j][2] - syl[k][2]) < 4]
        if len(around) >= 3:
            med = float(np.median(around))
            while m - med > 7: m -= 12
            while med - m > 7: m += 12
        mids.append(m)
    notes = []; last = None
    for (li, txt, t0, t1), m in zip(syl, mids):
        if m is None: m = last if last is not None else float(np.nanmedian([x for x in mids if x is not None]))
        midi = int(round(m)); c = int(round((m - midi) * 100)); last = m
        notes.append([round(t0, 2), round(t1, 2), round(t0, 2), round(t1, 2), midi, c, c, 0, 0, None])
    ms = [n[4] for n in notes]
    trace = ''.join('%03x' % max(0, min(4095, int(round(v * 10)))) if not np.isnan(v) else '000' for v in tr)
    out = {k: an[k] for k in ('dur', 'hop', 't0f', 'tune', 'key', 'beat', 'sum', 'passes')}
    out.update(lo=min(ms), hi=max(ms), notes=notes, trace=trace, lines=tm)
    json.dump(out, open(op, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(len(notes), 'syllable bars, range', min(ms), max(ms), 'bytes', len(json.dumps(out, ensure_ascii=False, separators=(',', ':'))))

if __name__ == '__main__':
    if len(sys.argv) < 4: print(__doc__); sys.exit(1)
    main(*sys.argv[1:4])
