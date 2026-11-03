"""Split sung words into syllables for the note bars: There's · gra-vi-ty · dan-de-li-ons.
Vowel groups make syllables (a silent final e, -es, -ed and -ely/-less/-ful/-ment/-ness don't); consonants between two
vowels go to the next syllable when they can start an English syllable (pa-per, re-grets), otherwise they're shared
(win-dow, sum-mer). Words the rules get wrong are listed in EXCEPT."""
import re
EXCEPT = {'dandelions': 'dan-de-li-ons', 'realized': 're-a-lized', 'diamond': 'di-a-mond', 'anything': 'an-y-thing', 'every': 'ev-ery',
          'squiggle': 'squig-gle', 'puget': 'pu-get', 'afterglow': 'af-ter-glow', 'pollywog': 'pol-ly-wog', 'rockabye': 'rock-a-bye',
          'decaf': 'de-caf', 'history': 'his-to-ry', 'natural': 'nat-ur-al', 'reaction': 're-ac-tion', 'distraction': 'dis-trac-tion',
          'seaside': 'sea-side', 'upstairs': 'up-stairs', 'downstairs': 'down-stairs', 'headlines': 'head-lines', 'tadpole': 'tad-pole',
          'mayfly': 'may-fly', 'sunshine': 'sun-shine', 'rainbow': 'rain-bow', 'sidewalk': 'side-walk', 'myself': 'my-self',
          'routine': 'rou-tine', 'another': 'an-oth-er', 'coffee': 'cof-fee', 'morning': 'mor-ning', 'gravity': 'gra-vi-ty',
          'orbit': 'or-bit', 'magnet': 'mag-net', 'restriction': 're-stric-tion', 'friction': 'fric-tion', 'secretly': 'se-cret-ly',
          'delighted': 'de-light-ed', 'lovely': 'love-ly', 'careless': 'care-less', 'regrets': 're-grets', 'productive': 'pro-duc-tive',
          'ticket': 'tick-et', 'thicket': 'thick-et', 'shadow': 'sha-dow', 'bathing': 'ba-thing', 'only': 'on-ly', 'baby': 'ba-by',
          'over': 'o-ver', 'wanna': 'wan-na', 'gonna': 'gon-na', 'shattered': 'shat-tered', 'blinded': 'blind-ed', 'never': 'nev-er',
          'brighter': 'bright-er', 'skimming': 'skim-ming', 'skipping': 'skip-ping', 'waiting': 'wait-ing', 'singing': 'sing-ing',
          'dancing': 'danc-ing', 'living': 'liv-ing', 'shining': 'shin-ing', 'holding': 'hold-ing', 'sleeping': 'sleep-ing',
          'breaking': 'break-ing', 'clawing': 'claw-ing', 'kicking': 'kick-ing', 'heading': 'head-ing', 'buried': 'bur-ied',
          'naked': 'na-ked', 'falling': 'fall-ing', 'master': 'mas-ter', 'disaster': 'di-sas-ter', 'middle': 'mid-dle',
          'vanish': 'van-ish', 'corner': 'cor-ner', 'silent': 'si-lent', 'really': 'real-ly', 'again': 'a-gain', 'without': 'with-out',
          'twenty': 'twen-ty', 'seconds': 'sec-onds', 'fleeting': 'fleet-ing', 'mistake': 'mis-take', 'awake': 'a-wake',
          'paper': 'pa-per', 'email': 'e-mail', 'later': 'la-ter', 'boring': 'bor-ing', 'grounded': 'ground-ed', 'sitting': 'sit-ting',
          'forgot': 'for-got', 'dreaming': 'dream-ing', 'until': 'un-til', 'water': 'wa-ter', 'window': 'win-dow', 'summer': 'sum-mer',
          'georgia': 'geor-gia', 'bobbing': 'bob-bing', 'dimmed': 'dimmed', 'hour': 'hour', 'hour’s': 'hour’s', "hour's": "hour's",
          'lunch': 'lunch', 'decide': 'de-cide', 'answer': 'an-swer', 'firm': 'firm', 'into': 'in-to', 'toward': 'toward', 'away': 'a-way'}
ONSETS = set('bl br ch cl cr dr fl fr gl gr pl pr sc sh sk sl sm sn sp st sw th tr tw wh wr str spr scr squ qu ph'.split())
V = 'aeiouy'

def _clean(w): return re.sub(r"^[^A-Za-z]+|[^A-Za-z'’]+$", '', w)

def parts(w):
    core = _clean(w); key = core.lower()
    if key in EXCEPT: p = EXCEPT[key].split('-')
    else:
        base = re.sub(r"['’](s|re|ll|ve|d|m|t)$", '', key)
        # vowel groups, with silent endings folded into the syllable before
        groups = [m for m in re.finditer('[aeiouy]+', base)]
        if base.startswith('y') and groups and groups[0].start() == 0 and len(groups[0].group()) > 1: pass
        if len(groups) > 1 and re.search(r'[^aeiou](e|es|ed)$', base) and not re.search(r'[^aeiou]le$', base) and not re.search(r'[td]ed$', base) and not re.search(r'[szxcg]es$', base): groups = groups[:-1]
        if len(groups) > 1 and re.search(r'[^aeiou]e(less|ly|ful|ment|ness)$', base): groups = [g for g in groups if not (g.group() == 'e' and g.end() == len(base) - len(re.search('(less|ly|ful|ment|ness)$', base).group()))]
        if len(groups) < 2: return [w]
        cuts = []
        for a, b in zip(groups, groups[1:]):
            cons = base[a.end():b.start()]
            if not cons: cuts.append(a.end()); continue
            k = 0
            while k < len(cons) and cons[k:] not in ONSETS and len(cons[k:]) > 1: k += 1
            cuts.append(a.end() + k)
        p, last = [], 0
        for c in cuts: p.append(core[last:c]); last = c
        p.append(core[last:])
    # put back any leading/trailing punctuation
    pre = w[:len(w) - len(w.lstrip("\"“(")) ]; post = w[len(pre) + len(core):]
    p = [x for x in p if x]
    # keep the singer's own spelling and capitals
    out, i = [], 0
    for x in p: out.append(core[i:i + len(x)]); i += len(x)
    if i < len(core): out[-1] += core[i:]
    out[0] = pre + out[0]; out[-1] += post
    return [x + '-' for x in out[:-1]] + [out[-1]]

def count(w): return len(parts(w))
