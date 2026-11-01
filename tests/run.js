// Pure Tone Lab end-to-end tests.
// Runs the real page in headless Chromium and feeds it a simulated voice (an oscillator wired into the
// analyser), so pitch, purity, levels, songs and buttons can be checked without a microphone.
// Usage: node tests/run.js            (needs the playwright package and its Chromium)
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const IPAD = { width: 1180, height: 760 };
const results = [];

async function open(browser, viewport = IPAD) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(PAGE);
  await page.waitForTimeout(300);
  return page;
}

// A controllable fake singer: V.on, V.m (MIDI pitch), V.noise (0..1 breath), V.wave (harmonic amplitudes).
async function voice(page) {
  await page.evaluate(async () => {
    await ensureAudio();
    const o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0; o.connect(g); g.connect(analyser); o.start();
    const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const nz = ac.createBufferSource(); nz.buffer = nb; nz.loop = true; const ng = ac.createGain(); ng.gain.value = 0; nz.connect(ng); ng.connect(analyser); nz.start();
    liveNodes.push(o, g, nz, ng); setMode('mic', 'test voice');
    window.V = { on: false, m: 50, noise: 0, wave: [1, .3, .15, .07], follow: false, off: 0 };
    let wv = '';
    setInterval(() => {
      if (V.follow) { const tg = G.seq[G.idx]; V.on = G.run === 'singing'; if (tg) V.m = tg.m + V.off; }
      g.gain.value = V.on ? .35 : 0; ng.gain.value = V.on ? V.noise : 0;
      const k = V.wave.join(); if (k !== wv) { wv = k; o.setPeriodicWave(makeWave(V.wave)); }
      o.frequency.setTargetAtTime(m2f(V.m), ac.currentTime, .03);
    }, 25);
  });
}
const setLevel = (page, n) => page.evaluate(n => { store.level = n; if (!store.lessons || !store.lessons.length) store.lessons = ['1.0']; save(); applyLevel(); }, n);
const tab = (page, id) => page.evaluate(id => $(id).click(), id);

async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const t0 = Date.now();
  try {
    const page = await open(browser);
    await fn(page, browser);
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
    results.push([true, name, Date.now() - t0]);
  } catch (e) {
    results.push([false, name, Date.now() - t0, e.message.split('\n')[0]]);
  } finally { await browser.close(); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  await test('Home: four numbered steps, "Find your voice" first, nothing else on screen', async page => {
    const s = await page.evaluate(() => {
      const vis = e => !!e && e.offsetParent !== null;
      return { cards: [...document.querySelectorAll('#homeCards .hc h3')].map(h => h.textContent), next: $('#homeCards .hc.is-next h3')?.textContent, btn: $('#homeCards .hc.is-next .primary')?.textContent,
        tabs: vis($('.tabs')), meters: vis($('.live')), status: vis($('.status')), back: vis($('#backBar')) };
    });
    expect(s.cards.join('|') === 'Find your voice|Find your best notes|Practise|Sing songs', JSON.stringify(s.cards));
    expect(s.next === 'Find your voice' && /Start/.test(s.btn), JSON.stringify(s));
    expect(!s.tabs && !s.meters && !s.status && !s.back, 'too much on the first screen: ' + JSON.stringify(s));
  });

  await test('Level 1 lessons start with Find your voice, then Do-Re-Mi; no giant markers', async page => {
    const s = await page.evaluate(() => LEVELS[0].lessons.slice(0, 2).map(x => x.title));
    expect(s[0] === 'Find your voice' && s[1] === 'Sing Do-Re-Mi', JSON.stringify(s));
    await setLevel(page, 3);
    const big = await page.evaluate(() => { $('#t-path').click(); document.querySelectorAll('details').forEach(d => d.open = true); return Math.max(0, ...[...document.querySelectorAll('.lv-num, .ls-ic')].map(e => e.getBoundingClientRect().width)); });
    expect(big <= 34, 'markers too big: ' + big);
  });

  await test('Home step 1 opens the voice test with its five phases shown; result leads to step 2', async page => {
    await voice(page);
    await page.click('[data-card="voice"] .primary'); await page.waitForTimeout(400);
    const chips = await page.evaluate(() => ({ n: document.querySelectorAll('#vfStrip .vf-chip').length, screen: document.body.dataset.screen, title: $('#screenTitle').textContent }));
    expect(chips.n === 5 && chips.screen === 'voice' && /Find your voice/.test(chips.title), JSON.stringify(chips));
    await page.evaluate(() => { store.settings = { speak: false }; setInterval(() => { const ph = D.phase; V.on = ['speak', 'natural', 'low', 'high', 'stretch'].includes(ph); V.m = ph === 'low' ? 43 : ph === 'high' ? 60 : ph === 'stretch' ? 40 + ((performance.now() / 120) % 24) : ph === 'speak' ? 46 + Math.sin(performance.now() / 300) * 2 : 48; }, 30); });
    await page.click("#dBtns >> text=Let's go");
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 120000 });
    const done = await page.evaluate(() => [...document.querySelectorAll('#vfStrip .vf-chip.done')].length);
    expect(done === 5, 'chips done: ' + done);
    await page.click('#dBtns >> text=Next: find your best notes');
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ id: D.id, screen: document.body.dataset.screen, home: $('#homeCards [data-card="voice"] .result')?.textContent }));
    expect(s.id === 'scale' && s.screen === 'notes', JSON.stringify(s));
  });

  await test('first lesson: Do-Re-Mi with words, then "Strongest notes: …"', async page => {
    await voice(page);
    await page.click('[data-card="notes"] button'); await page.waitForTimeout(400);
    const words = await page.evaluate(() => [D.id, G.song.id, [...document.querySelectorAll('#staff .lyr')].map(t => t.textContent).join(' ')]);
    expect(words[0] === 'scale' && /Do Re Mi Fa So La Ti Do/.test(words[2]), JSON.stringify(words));
    await page.evaluate(() => { window.badNotes = [5, 6]; setInterval(() => { const tg = G.seq[G.idx]; V.on = G.run === 'singing'; if (tg) V.m = tg.m + (badNotes.includes(G.idx) ? 1.2 : 0); }, 25); });
    await page.click('[data-tempo="normal"]'); await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(1800);
    const s = await page.evaluate(() => ({ head: document.querySelector('.cheer-big').textContent, done: (store.lessons || []).includes('1.2') }));
    expect(/Strongest notes: Do, Re, Mi, Fa and So\./.test(s.head) && s.done, JSON.stringify(s));
    await page.click('#btnHome'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ screen: document.body.dataset.screen, r: $('#homeCards [data-card="notes"] .result')?.textContent }));
    expect(after.screen === 'home' && /Strongest notes: Do, Re, Mi, Fa and So/.test(after.r), JSON.stringify(after));
  });

  await test('Level 1 is four lessons, then Level 2 opens; no exercise repeats across levels; rock from Level 1', async page => {
    const shape = await page.evaluate(() => {
      const labs = LEVELS.flatMap(L => L.lessons.filter(x => x.kind === 'lab').map(x => x.lab));
      const songs = LEVELS.flatMap(L => L.lessons.map(x => x.title + '|' + x.goal));
      return { n1: LEVELS[0].lessons.length, total: LEVELS.reduce((a, L) => a + L.lessons.length, 0), labsUnique: new Set(labs).size === labs.length, songsUnique: new Set(songs).size === songs.length, days: LEVELS.some(L => L.lessons.some(x => x.kind === 'days')), rock1: LEVELS[0].lessons.some(x => x.kind === 'song' && x.songs.includes('saints')) };
    });
    expect(shape.n1 === 4 && shape.total <= 14 && shape.labsUnique && shape.songsUnique && !shape.days && shape.rock1, JSON.stringify(shape));
    await page.evaluate(() => {
      store.profile = { low: 41, high: 63, type: 'Bass', zlo: 43, zhi: 60 };
      store.lab = { match: { best: 55 } };
      store.runs = [{ id: 'doremi', ok: 6, pure: 4, n: 8, avg: 80 }]; checkLevel();
    });
    const lv = await page.evaluate(() => level());
    expect(lv === 1, 'moved on before the first song: ' + lv);
    await page.evaluate(() => { store.runs.push({ id: 'saints', ok: 20, pure: 10, n: 33, avg: 80 }); checkLevel(); });
    const s = await page.evaluate(() => ({ lv: level(), cel: !$('#celebrate').hidden, live: $('.live').hidden }));
    expect(s.lv === 2 && s.cel && !s.live, JSON.stringify(s));
  });

  await test('every song: words line up with the notes; songs are grouped (rock, folk, hymns, classics)', async page => {
    await setLevel(page, 1); await tab(page, '#t-sing');
    const s = await page.evaluate(() => SONGS.filter(x => !x.lab && x.id !== 'gen').map(song => { loadSong(song); return { id: song.id, ok: G.seq.length === G.seq.filter(x => x.w || x.cont).length && G.seq.length === song.notes.length }; }));
    const bad = s.filter(x => !x.ok).map(x => x.id);
    const grp = await page.evaluate(() => [...document.querySelectorAll('#songs .song-grp')].map(x => x.textContent).join());
    const n = await page.evaluate(() => ['midnight', 'johnhenry', 'risingsun', 'doxology', 'silent', 'joy', 'jesusloves', 'michael'].filter(id => SONGS.some(x => x.id === id) && SONG_LEVEL[id] === 1).length);
    expect(!bad.length && grp === 'Rock & roll,Folk & blues,Hymns,Classics' && n === 8, JSON.stringify({ bad, grp, n }));
  });

  await test('rock songs: words line up with the notes, and each opens at its level', async page => {
    const s = await page.evaluate(() => ROCK.map(id => { const song = SONGS.find(x => x.id === id); loadSong(song); return { id, n: G.seq.length, words: G.seq.filter(x => x.w || x.cont).length, lv: SONG_LEVEL[id] }; }));
    expect(s.length === 3 && s.every(x => x.n === x.words && x.n >= 30) && s.map(x => x.lv).join() === '1,2,3', JSON.stringify(s));
  });

  await test('gold band covers only the voice types the singer falls into', async page => {
    const h = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = rangeFigure({ low: 45, high: 69, natural: 55, type: 'Baritone', speak: 47 });
      const one = +box.querySelector('.you-band').getAttribute('height');
      box.innerHTML = rangeFigure({ low: 42, high: 66, natural: 52, type: 'Bass', speak: 47 });
      return [one, +box.querySelector('.you-band').getAttribute('height'), box.textContent.includes('also you')];
    });
    expect(h[0] === 20 && h[1] === 40 && h[2], 'band heights ' + JSON.stringify(h));
  });

  await test('Start over resets progress, and Undo brings it all back', async page => {
    await page.evaluate(() => { store.profile = { low: 45, high: 65, type: 'Baritone', zlo: 47, zhi: 62, natural: 52 }; store.lessons = ['1.1']; store.level = 1; save(); renderHome(); });
    await page.click('#btnStartOver'); await page.click('#btnStartOver'); await page.waitForLoadState('load'); await page.waitForTimeout(500);
    let s = await page.evaluate(() => ({ p: !!store.profile, undo: !$('#undoBar').hidden }));
    expect(!s.p && s.undo, 'after reset ' + JSON.stringify(s));
    await page.click('#btnUndo'); await page.waitForLoadState('load'); await page.waitForTimeout(500);
    s = await page.evaluate(() => ({ type: store.profile && store.profile.type, undo: !$('#undoBar').hidden }));
    expect(s.type === 'Baritone' && !s.undo, 'after undo ' + JSON.stringify(s));
  });

  await test('three singers each keep their own data, and can be renamed', async page => {
    await page.evaluate(() => { store.profile = { low: 45, high: 65, type: 'Baritone', zlo: 47, zhi: 62, natural: 52 }; store.lessons = ['1.1']; save(); });
    await page.click('#btnUser'); await page.click('#userMenu .um-row:nth-child(2) .um-pick'); await page.waitForLoadState('load'); await page.waitForTimeout(500);
    let s = await page.evaluate(() => ({ p: !!store.profile, who: $('#btnUser').textContent, fresh: document.body.classList.contains('fresh') }));
    expect(!s.p && /Singer 2/.test(s.who) && s.fresh, 'singer 2 ' + JSON.stringify(s));
    await page.click('#btnUser'); await page.click('#userMenu .um-row:nth-child(2) >> text=Rename');
    await page.fill('#userName1', 'Anna'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    expect(/Anna/.test(await page.evaluate(() => $('#btnUser').textContent)), 'rename failed');
    await page.click('#userMenu .um-row:nth-child(1) .um-pick'); await page.waitForLoadState('load'); await page.waitForTimeout(500);
    s = await page.evaluate(() => ({ type: store.profile && store.profile.type, who: $('#btnUser').textContent }));
    expect(s.type === 'Baritone' && /Singer 1/.test(s.who), 'back to singer 1 ' + JSON.stringify(s));
  });

  await test('vocal warm-up: 8 timed exercises, breathing guide, finishes on its own', async page => {
    await voice(page);
    await page.click('[data-card="practice"] >> text=Warm up'); await page.waitForTimeout(300);
    await page.click('#dBtns >> text=Start the warm-up'); await page.waitForTimeout(300);
    const first = await page.evaluate(() => [D.id, D.wi, $('#dPrompt').textContent]);
    expect(first[0] === 'warmup' && first[1] === 0 && /Release/.test(first[2]), JSON.stringify(first));
    await page.click('#dBtns >> text=Next →'); await page.waitForTimeout(400);
    expect(await page.evaluate(() => WARM[D.wi].breath && DRILLS.warmup.lane().breath), 'breathing guide not shown');
    await page.evaluate(() => { WARM.forEach(w => w.secs = 0.5); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 20000 });
    expect(await page.evaluate(() => (labRec('warmup') || {}).best === 100 && /warmed up/.test($('#dResult').textContent)), 'no result');
  });

  await test('focus view magnifies the previous, current and next notes, with the live voice', async page => {
    await voice(page); await tab(page, '#t-sing');
    await page.evaluate(() => { V.follow = true; V.off = -0.4; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'singing' && G.idx >= 2, null, { timeout: 30000 }); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ notes: $('#focus').querySelectorAll('ellipse').length, cur: !!$('#focus .f-now'), done: !!$('#focus [class^="st-"]'), you: /¢|✓/.test($('#focus').textContent) }));
    expect(s.notes === 3 && s.cur && s.done && s.you, JSON.stringify(s));
  });

  await test('a one-note monotone through a moving tune is caught and scored low', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { setInterval(() => { V.on = G.run === 'singing'; V.m = G.seq[0].m; }, 25); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ st: runStats(), head: $('.cheer-big').textContent }));
    expect(s.st.monotone && s.st.score < 40 && /one held note/.test(s.head) && !/Great start/.test(s.head), JSON.stringify({ score: s.st.score, mono: s.st.monotone, head: s.head }));
  });

  await test('zero notes in tune: honest and kind, never "Great start"', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { V.follow = true; V.off = 2.5; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ ok: runStats().ok, head: $('.cheer-big').textContent, rows: document.querySelectorAll('#report .sk-row').length }));
    expect(s.ok === 0 && !/Great start/.test(s.head) && /Your tone was clear|steady|ring|kept going|volume/.test(s.head) && s.rows === 9, JSON.stringify(s));
  });

  await test('steady hold: always gives a note, shows the band, in range vs too high', async page => {
    await voice(page);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; save(); openLab('hold'); });
    const intro = await page.evaluate(() => ({ prompt: $('#dPrompt').textContent, sel: $('#holdSel')?.value, target: D.target }));
    expect(intro.prompt === 'Your note: ' + 'D3' && intro.sel === '50' && intro.target === 50, JSON.stringify(intro));
    await page.click('#dBtns >> text=▶ Start');
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'wait' || D.phase === 'hold'; V.m = D.target + (window.sharp ? 0.6 : 0); }, 25); });
    await page.waitForFunction(() => D.phase === 'hold', null, { timeout: 10000 }); await page.waitForTimeout(800);
    expect(await page.evaluate(() => /In range/.test($('#dLive').textContent) && $('#dLive').classList.contains('in')), 'not shown in range');
    await page.evaluate(() => { window.sharp = true; }); await page.waitForTimeout(800);
    expect(await page.evaluate(() => /Too high/.test($('#dLive').textContent) && $('#dLive').classList.contains('out')), 'not shown too high');
    await page.evaluate(() => { window.sharp = false; });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ note: (store.holdNotes || {})[50], map: document.querySelectorAll('#dResult .nm').length }));
    expect(r.note > 0 && r.map === 22, JSON.stringify(r));
  });

  await test('coach: echo 3 notes with a second try on a miss, then climbs a rung', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => setCoach(true));
    expect(await page.evaluate(() => G.seq.length === 3 && !$('#coachBar').hidden), 'coach not set up for 3 notes');
    // first try at each note is a semitone sharp; the second try is right on it
    await page.evaluate(() => { setInterval(() => { const ph = G.echo && G.echo.phase; V.on = G.run === 'echo' && ph === 'sing'; const tg = G.seq[G.idx]; if (tg) V.m = tg.m + (G.echo && !G.echo.retried ? 1.2 : 0); }, 25); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ ok: runStats().ok, rung: CO.rung, msg: $('#report .coach-offer').textContent }));
    expect(s.ok === 3 && s.rung === 2 && /Level up/.test(s.msg), JSON.stringify(s));
    await page.click('#report .coach-offer button'); await page.waitForTimeout(300);
    expect(await page.evaluate(() => G.seq.length === 5 && G.run === 'echo'), 'did not move to 5 notes');
  });

  await test('coach: two hard runs step back down a rung', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { store.coach = { row: { rung: 2, fails: 0, v: 2 } }; setCoach(true); setInterval(() => { V.on = G.run === 'echo' && G.echo && G.echo.phase === 'sing'; const tg = G.seq[G.idx]; if (tg) V.m = tg.m + 2.5; }, 25); });
    for (let k = 0; k < 2; k++) {
      await page.evaluate(() => startRun());
      await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(300);
    }
    const s = await page.evaluate(() => ({ rung: CO.rung, msg: CO.msg, saved: store.coach.row.rung }));
    expect(s.rung === 1 && s.saved === 1 && /easier/.test(s.msg), JSON.stringify(s));
  });

  await test('after a hard run, the coach is offered', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { V.follow = true; V.off = 2.5; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(300);
    expect(await page.evaluate(() => /Start coach mode/.test($('#report').textContent)), 'no coach offer');
  });

  await test('pitch match: replays the note and gives more time until it is found; practical next steps', async page => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => openLab('match')); await page.click('#dBtns >> text=▶ Start');
    // lost for the first ~7 seconds of every round (a semitone sharp), then finds it
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target + (now() - D.t0 < 7 ? 1.0 : 0); }, 25); });
    await page.waitForFunction(() => D.rounds && D.rounds.length >= 1, null, { timeout: 20000 });
    const r0 = await page.evaluate(() => D.rounds[0]);
    expect(r0.rem >= 2 && r0.locked && Math.abs(r0.c) <= 30, 'round 1 ' + JSON.stringify(r0));
    await page.evaluate(() => { D.n = 2; });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 30000 }); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ done: $('#drillBox').classList.contains('is-finished'), promptHidden: getComputedStyle($('#dPrompt')).display === 'none', hum: /Hum along/.test($('#dResult').textContent) }));
    expect(s.done && s.promptHidden && s.hum, JSON.stringify(s));
  });

  await test('guide tone: the mic ignores the speaker playing the note, but still hears the singer', async page => {
    await page.evaluate(async () => {
      await ensureAudio(); setMode('mic', 'test');
      const leak = ac.createOscillator(); leak.setPeriodicWave(makeWave(GUIDE_WAVE)); leak.frequency.value = m2f(57); const lg = ac.createGain(); lg.gain.value = .35; leak.connect(lg); lg.connect(micIn); leak.start();
      window.T = { leak, lg };
    });
    await page.waitForTimeout(700);
    const bare = await page.evaluate(() => S.voiced && Math.abs(S.midi - 57) < .3);
    await page.evaluate(() => guideOn(57)); await page.waitForTimeout(900);
    const notched = await page.evaluate(() => S.voiced);
    // a real voice on the same note has overtones, so the app still hears it through the notch
    await page.evaluate(() => { const o = ac.createOscillator(); o.setPeriodicWave(makeWave([1, .5, .35, .2, .1])); o.frequency.value = m2f(57); const g = ac.createGain(); g.gain.value = .35; o.connect(g); g.connect(micIn); o.start(); T.v = o; });
    await page.waitForTimeout(900);
    const sung = await page.evaluate(() => ({ v: S.voiced, m: S.midi }));
    await page.evaluate(() => { guideOff(); T.leak.stop(); T.v.stop(); });
    expect(bare && !notched && sung.v && Math.abs(sung.m - 57) < .3, JSON.stringify({ bare, notched, sung }));
  });

  await test('pitch match: still lost after two reminders, the note keeps playing to sing along', async page => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => openLab('match')); await page.click('#dBtns >> text=▶ Start');
    // a semitone off until the guide tone comes on, then right on it
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target + (guideTone ? 0 : 1.0); }, 25); });
    await page.waitForFunction(() => guideTone && D.phase === 'sing', null, { timeout: 20000 });
    const mid = await page.evaluate(() => ({ live: $('#dLive').textContent, midi: guideTone.midi, target: D.target }));
    await page.waitForFunction(() => D.rounds && D.rounds.length >= 1, null, { timeout: 20000 });
    const r0 = await page.evaluate(() => ({ r: D.rounds[0], tone: !!guideTone }));
    expect(/keep the note playing/.test(mid.live) && mid.midi === mid.target && r0.r.guided && r0.r.locked && !r0.tone, JSON.stringify({ mid, r0 }));
  });

  await test('pitch match: "Keep the note playing" plays it from the start of each round', async page => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => { openLab('match'); });
    await page.check('#guideTog');
    await page.click('#dBtns >> text=▶ Start');
    await page.waitForFunction(() => D.phase === 'sing', null, { timeout: 8000 }); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ on: !!guideTone, pref: store.settings.guide, rem: D.rem, live: $('#dLive').textContent }));
    await page.evaluate(() => closeLab());
    const off = await page.evaluate(() => !guideTone);
    await page.evaluate(() => { store.settings.guide = false; });
    expect(s.on && s.pref && s.rem === 0 && /playing/.test(s.live) && off, JSON.stringify({ s, off }));
  });

  await test('steady hold: guide on keeps the note under the singer, and a guided hold is not a personal best', async page => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.holdNotes = {}; (store.settings ||= {}).guide = true; openLab('hold'); });
    expect(await page.evaluate(() => $('#guideTog').checked), 'toggle not shown checked');
    await page.click('#dBtns >> text=▶ Start');
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'wait' || D.phase === 'hold'; V.m = D.target; }, 25); });
    await page.waitForFunction(() => D.phase === 'hold', null, { timeout: 10000 }); await page.waitForTimeout(1500);
    const mid = await page.evaluate(() => ({ on: !!guideTone && guideTone.midi === D.target, soft: guideTone && guideTone.level < guideTone.vol }));
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 15000 });
    const end = await page.evaluate(() => ({ tone: !!guideTone, best: (store.holdNotes || {})[50] }));
    await page.evaluate(() => { store.settings.guide = false; });
    expect(mid.on && mid.soft && !end.tone && end.best == null, JSON.stringify({ mid, end }));
  });

  await test('coach: Sing along is the safety net below Echo 3, and old progress moves up a step', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    const mig = await page.evaluate(() => { store.coach = { row: { rung: 1, fails: 0 } }; return coachRec('row').rung; });
    await page.evaluate(() => { store.coach = { row: { rung: 0, fails: 0, v: 2 } }; setCoach(true); });
    expect(await page.evaluate(() => /Sing along/.test($('#coachBar').textContent) && G.seq.length === 3), 'Sing along rung not shown');
    const seen = await page.evaluate(() => { window.gs = []; setInterval(() => { V.on = G.run === 'echo' && G.echo.phase === 'sing'; const tg = G.seq[G.idx]; if (tg) V.m = tg.m; if (V.on) gs.push(guideTone ? guideTone.midi === tg.m : false); }, 25); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ ok: runStats().ok, rung: CO.rung, guided: gs.filter(Boolean).length / Math.max(1, gs.length), tone: !!guideTone }));
    expect(mig === 2 && s.ok === 3 && s.rung === 1 && s.guided > .8 && !s.tone, JSON.stringify({ mig, s }));
  });

  await test('notes play loud, with overtones a small speaker can reproduce', async page => {
    const s = await page.evaluate(async () => { await ensureAudio(); return { overtones: PURE.slice(1).reduce((a, b) => a + b, 0), vol: toneVol.gain.value, guide: GUIDE_WAVE.length }; });
    expect(s.overtones >= 1 && s.vol >= 1.5 && s.guide >= 2, JSON.stringify(s));
  });

  await test('Hear it sung: a synthetic voice sings the song in tune, following the words', async page => {
    const v = await page.evaluate(() => ['Do', 'Mi', 'saints', 'light', 'you', 'street', 'day', 'mm'].map(w => vowelOf(w).filter(Boolean).join('>')));
    expect(v.join() === 'oh,ee,eh>ee,ah>ee,oo,ee,eh>ee,mm', 'vowels: ' + v.join());
    const pitch = await page.evaluate(async () => { await ensureAudio(); toneVol.connect(analyser); setMode('file', 't'); sungNote(57, 1.6, 'saints', 0, false); await new Promise(r => setTimeout(r, 900)); const o = { v: S.voiced, m: S.midi }; toneVol.disconnect(analyser); setMode('idle', ''); return o; });
    expect(pitch.v && Math.abs(pitch.m - 57) < 0.3, 'sung pitch ' + JSON.stringify(pitch));
    await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => loadSong(SONGS.find(s => s.id === 'saints')));
    await page.click('#btnVoice'); await page.waitForTimeout(2500);
    const mid = await page.evaluate(() => ({ sung: playback && playback.sung, play: G.play, label: $('#btnVoice').textContent }));
    await page.click('#btnVoice');
    const end = await page.evaluate(() => ({ pb: !!playback, label: $('#btnVoice').textContent }));
    expect(mid.sung && mid.play >= 1 && /Stop/.test(mid.label) && !end.pb && /Hear it sung/.test(end.label), JSON.stringify({ mid, end }));
  });

  await test('Path: a unit passes with 70, or with three tries of 50+; two tries of 50+ are not enough', async page => {
    const r = await page.evaluate(() => {
      store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; store.tries = {}; store.passed = [];
      const u2 = UNITS[1], u3 = UNITS[2], out = {};
      out.u1 = unitPassed(UNITS[0]); out.u2open = unitOpen(u2); out.u3open0 = unitOpen(u3);
      recordTry('lab', 'hold', 64); out.after64 = unitPassed(u2);
      recordTry('lab', 'hold', 71); out.after71 = unitPassed(u2); out.u3open = unitOpen(u3);
      recordTry('song', 'hum', 55); recordTry('song', 'hum', 52); out.two50 = unitPassed(u3);
      recordTry('song', 'hum', 40); out.with40 = unitPassed(u3);
      recordTry('song', 'hum', 58); out.three50 = unitPassed(u3);
      out.status = unitStatus(UNITS[3]); out.cur = currentUnit().id;
      return out;
    });
    expect(r.u1 && r.u2open && !r.u3open0 && !r.after64 && r.after71 && r.u3open && !r.two50 && !r.with40 && r.three50 && r.cur === 'u4' && /Score 70\+/.test(r.status), JSON.stringify(r));
  });

  await test('Path: tries only count for open units; paywall switch locks units after Checkpoint A', async page => {
    const r = await page.evaluate(() => {
      store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; store.tries = {}; store.passed = [];
      recordTry('lab', 'vowels', 95);
      const early = unitTries(UNITS.find(u => u.id === 'u6')).length;
      const paid = UNITS.filter(u => unitPaid(u)).map(u => u.id).join();
      store.unlockAll = true; const allOpen = UNITS.every(unitOpen);
      return { early, paid, allOpen, pay: PAYWALL };
    });
    expect(r.early === 0 && r.paid === 'u6,u7,u8,u9,u10,u11,u12' && r.allOpen && r.pay === false, JSON.stringify(r));
  });

  await test('Path: the first song after Find your voice becomes the baseline and passes Unit 1', async page => {
    await voice(page);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = null; store.passed = []; save(); });
    await tab(page, '#t-sing');
    await page.evaluate(() => { loadSong(SONGS.find(s => s.id === 'mary')); G.tempo = 'normal'; V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ base: store.baseline && store.baseline.id, u1: unitPassed(UNITS[0]), cel: !$('#celebrate').hidden, cur: currentUnit().id }));
    expect(s.base === 'mary' && s.u1 && s.cel && s.cur === 'u2', JSON.stringify(s));
  });

  await test('Today: unit card first; voice check-in with a safety note; path and song cards', async page => {
    const first = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join(), btn: $('#homeCards [data-card="today"] button.primary').textContent }));
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; save(); checkLevel(true); $('#t-home').click(); });
    const later = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join(), title: $('#homeTitle').textContent }));
    await page.click('#homeCards [data-card="checkin"] >> text=Scratchy');
    const safe = await page.evaluate(() => $('#homeCards [data-card="checkin"]').textContent);
    await page.click('#homeCards [data-card="today"] button.primary');
    const unit = await page.evaluate(() => ({ screen: document.body.dataset.screen, page: !!document.querySelector('.unit-page'), title: $('.unit-card h2').textContent }));
    expect(first.cards === 'today' && /Find your voice/.test(first.btn) && later.cards === 'today,checkin,path,songs' && /Posture & breath/.test(later.title) && /ENT/.test(safe) && unit.screen === 'path' && unit.page && unit.title === 'Posture & breath', JSON.stringify({ first, later, safe: safe.slice(0, 60), unit }));
  });

  await test('Unit page: Experience, Name it, Practise; the skill check opens the right drill', async page => {
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; save(); openUnit(UNITS[1]); });
    const steps = await page.evaluate(() => [...document.querySelectorAll('.unit-steps button')].map(b => b.textContent).join('|'));
    await page.click('.unit-body >> text=Next: Name it');
    const name = await page.evaluate(() => ({ lead: $('.unit-lead').textContent, how: !!$('.unit-how') }));
    await page.click('.unit-body >> text=Next: Practise');
    await page.click('.unit-body >> text=Start the skill check');
    const d = await page.evaluate(() => D.id);
    expect(/Experience/.test(steps) && /Name it/.test(steps) && /Practise/.test(steps) && /breathe in low/.test(name.lead) && name.how && d === 'hold', JSON.stringify({ steps, name, d }));
  });

  await test('reference notes last at least 1.5 seconds', async page => {
    const s = await page.evaluate(() => ({ hear: RUNGS.filter(r => r.k === 'echo').map(r => r.hear) }));
    await page.evaluate(async () => { await ensureAudio(); window.durs = []; const pt = playTone; window.playTone = (m, d, a, w) => { durs.push(d); return pt(m, d, a, w); }; });
    await tab(page, '#t-sing'); await page.click('#btnRef');
    await page.evaluate(() => { openLab('match'); }); await page.click('#dBtns >> text=▶ Start'); await page.waitForTimeout(300);
    await page.evaluate(() => { closeLab(); store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; openLab('hold'); });
    await page.click('#dBtns >> text=Hear the note');
    const d = await page.evaluate(() => durs);
    expect(s.hear.every(h => h >= 1.5) && d.length >= 3 && d.every(x => x >= 1.5), JSON.stringify({ s, d }));
  });

  await test('Note on: the note plays the whole time in a sing-through, following the song', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.click('#btnGuide');
    expect(await page.evaluate(() => store.settings.guide && $('#btnGuide').getAttribute('aria-pressed') === 'true'), 'toggle did not turn on');
    await page.evaluate(() => { V.follow = true; window.gs = []; setInterval(() => { if (G.run === 'singing' && G.seq[G.idx]) { const into = now() - G.t0 - G.starts[G.idx]; if (into > .15) gs.push(!!guideTone && guideTone.midi === G.seq[G.idx].m); } }, 40); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ f: gs.filter(Boolean).length / Math.max(1, gs.length), n: gs.length, tone: !!guideTone, ok: runStats().ok, total: G.seq.length }));
    expect(s.n > 20 && s.f > .95 && !s.tone && s.ok >= s.total - 1, JSON.stringify(s));
  });

  await test('Note on in coach mode: the note keeps playing through every turn', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { (store.settings ||= {}).guide = true; setCoach(true); window.gs = []; setInterval(() => { V.on = G.run === 'echo' && G.echo.phase === 'sing'; const tg = G.seq[G.idx]; if (tg) V.m = tg.m; if (G.run === 'echo') gs.push(!!guideTone); }, 40); });
    expect(await page.evaluate(() => CO.rung === 1), 'not on Echo 3');
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 });
    const s = await page.evaluate(() => ({ f: gs.filter(Boolean).length / gs.length, ok: runStats().ok, tone: !!guideTone }));
    expect(s.f > .9 && s.ok === 3 && !s.tone, JSON.stringify(s));
  });

  await test('coach: tap a step to jump to it; tempo buttons work in coach mode; controls sit above the music', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { store.coach = { row: { rung: 5, fails: 0, v: 2 } }; setCoach(true); });
    const t0 = await page.evaluate(() => ({ tempo: G.tempo, above: $('#btnSing').getBoundingClientRect().bottom < $('#staff').getBoundingClientRect().top && $('#btnGuide').getBoundingClientRect().bottom < $('#coachBar').getBoundingClientRect().top }));
    await page.click('[data-tempo="normal"]');
    const t1 = await page.evaluate(() => ({ rung: CO.rung, tempo: G.tempo, saved: store.coach.row.rung }));
    await page.click('[data-tempo="medium"]');
    const t2 = await page.evaluate(() => ({ rung: CO.rung, tempo: G.tempo }));
    await page.click('#coachBar .rung >> text=Echo 3 notes');
    const t3 = await page.evaluate(() => ({ rung: CO.rung, n: G.seq.length }));
    expect(t0.tempo === 'vslow' && t0.above && t1.rung === 7 && t1.tempo === 'normal' && t1.saved === 7 && t2.rung === 6 && t2.tempo === 'medium' && t3.rung === 1 && t3.n === 3, JSON.stringify({ t0, t1, t2, t3 }));
  });

  await test("pitch match's trickiest notes open Steady hold on that note", async page => {
    await page.evaluate(() => { openLab('match'); D.rounds = [{ m: 52, c: 55, pts: 45, rem: 0 }, { m: 48, c: 5, pts: 95, rem: 0, locked: true }]; D.n = 2; DRILLS.match.finish(); });
    await page.click('#dResult >> text=Hold E3');
    const s = await page.evaluate(() => ({ id: D.id, target: D.target }));
    expect(s.id === 'hold' && s.target === 52, JSON.stringify(s));
  });

  await test('hidden toast never blocks taps', async page => {
    await page.evaluate(() => toast('hello'));
    const shown = await page.evaluate(() => { const r = $('#toast').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id; });
    expect(shown !== 'toast', 'visible toast intercepts taps');
    await page.waitForTimeout(3000);
    const hidden = await page.evaluate(() => { const t = $('#toast'); return getComputedStyle(t).visibility; });
    expect(hidden === 'hidden', 'toast still visible after hiding: ' + hidden);
  });

  await test('tempo buttons always apply, even mid-song', async page => {
    await voice(page); await setLevel(page, 10);
    await tab(page, '#t-sing');
    await page.click('[data-tempo="normal"]');
    let s = await page.evaluate(() => [G.tempo, document.querySelector('[data-tempo="normal"]').getAttribute('aria-pressed')]);
    expect(s[0] === 'normal' && s[1] === 'true', 'normal not applied: ' + s);
    await page.click('#btnSing'); await page.waitForTimeout(600);
    await page.click('[data-tempo="slow"]');
    s = await page.evaluate(() => [G.tempo, G.run]);
    expect(s[0] === 'slow' && s[1] === 'ready', 'slow mid-run not applied: ' + s);
  });

  await test('meters stay steady through tiny gaps in a soft voice', async page => {
    await voice(page);
    await page.evaluate(() => { V.on = true; V.m = 50; window.flips = 0; let last = null; setInterval(() => { if (last !== null && last !== S.voiced) flips++; last = S.voiced; }, 16); let k = 0; setInterval(() => { V.on = (k++ % 6) !== 0; }, 60); });
    await page.waitForTimeout(3000);
    const flips = await page.evaluate(() => flips);
    expect(flips <= 2, 'voiced flipped ' + flips + ' times');
  });

  const voiceTest = async (page, plan) => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => { store.settings = { speak: false }; store.discoveries = [43, 45, 47, 48, 50, 52].map(m => ({ midi: m, purity: 90, amps: [1], at: 0 })); });
    await page.evaluate(() => openLab('range')); await page.click("#dBtns >> text=Let's go");
    await page.evaluate(plan => {
      const t0 = {}; setInterval(() => {
        const ph = D.phase, f = plan[ph]; if (!f) { V.on = false; return; }
        t0[ph] = t0[ph] || performance.now(); const e = (performance.now() - t0[ph]) / 1000; V.on = true;
        V.m = ph === 'speak' ? 46 + Math.sin(e * 3) * 2 : ph === 'stretch' ? (e < 1.5 ? f[0] : e < 5 ? f[0] + (e - 1.5) / 3.5 * (f[1] - f[0]) : f[1]) : Array.isArray(f) ? Math.max(f[1], f[0] - e * 4) : f;
      }, 30);
    }, plan);
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 120000 });
    return page.evaluate(() => ({ p: store.profile, text: $('#dResult').hidden ? $('#dSub').textContent : $('#dResult').textContent, fits: document.querySelectorAll('#dResult .fit-row').length }));
  };

  await test('Find your voice: 5 timed steps, voice type, famous voices, songs that fit', async page => {
    const s = await voiceTest(page, { speak: 1, natural: 48, low: [48, 41], high: 63, stretch: [38, 68] });
    expect(s.p && s.p.type === 'Bass' && Math.abs(s.p.low - 41) <= 1 && Math.abs(s.p.high - 63) <= 1 && s.p.natural === 48, JSON.stringify(s.p));
    expect(s.p.xlo <= 39 && s.p.xhi >= 67, 'extremes ' + s.p.xlo + '–' + s.p.xhi);
    expect(/Johnny Cash/.test(s.text) && /Ring of Fire/.test(s.text) && s.fits === 3, 'result missing artists or song fits');
  });

  await test('Find your voice moves briskly: no countdowns, done in well under a minute', async page => {
    const t0 = Date.now();
    await voiceTest(page, { speak: 1, natural: 50, low: [50, 43], high: 60, stretch: [41, 64] });
    const secs = (Date.now() - t0) / 1000;
    expect(secs < 50, 'took ' + secs.toFixed(0) + ' s');
  });

  await test('if the mic gets switched off, the app says so and reconnects on the next tap', async page => {
    await page.evaluate(() => startMic()); await page.waitForTimeout(800);
    expect(await page.evaluate(() => mode) === 'mic', 'mic did not start');
    await page.evaluate(() => stream.getAudioTracks()[0].dispatchEvent(new Event('ended'))); await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({ mode, status: $('#status').textContent, warn: $('.status').classList.contains('warn'), shown: $('.status').offsetParent !== null }));
    expect(s.mode === 'idle' && /switched off/.test(s.status) && s.warn && s.shown, JSON.stringify(s));
    await page.mouse.click(600, 400); await page.waitForTimeout(800);
    expect(await page.evaluate(() => mode) === 'mic', 'did not reconnect after a tap');
  });

  await test('Find your voice is forgiving: low and high mixed up still gives a result', async page => {
    const s = await voiceTest(page, { speak: 1, natural: 55, low: 62, high: 50, stretch: [50, 64] });
    expect(s.p && s.p.low <= 50 && s.p.high >= 62 && s.fits === 3, JSON.stringify(s));
  });

  await test('pitch match spots a flat singer', async page => {
    await voice(page); await setLevel(page, 4);
    await page.evaluate(() => openLab('match')); await page.click('#dBtns >> text=Start');
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target - 0.25; }, 25); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 90000 });
    const t = await page.evaluate(() => [...document.querySelectorAll('#dResult .fix > b')].map(b => b.textContent).join(' | '));
    expect(/flat/.test(t), 'no flat finding: ' + t);
  });

  await test('first song lesson: When the Saints sung through', async page => {
    await voice(page);
    await page.evaluate(() => startLesson(LEVELS[0].lessons[3])); await page.waitForTimeout(300);
    await page.click('[data-tempo="normal"]'); await page.evaluate(() => { V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ song: G.song.id, done: store.lessons.includes('1.4'), lv: level() }));
    expect(s.song === 'saints' && s.done, JSON.stringify(s));
  });

  await test('metronome ticks through the song; starting note plays first', async page => {
    await voice(page);
    await tab(page, '#t-sing');
    await page.evaluate(() => { window.played = []; const pt = playTone; playTone = (m, ...r) => { played.push(m); return pt(m, ...r); }; $('#btnRef').click(); });
    await page.waitForTimeout(200);
    const first = await page.evaluate(() => [played[0], G.seq[0].m]);
    expect(first[0] === first[1], 'starting note ' + first);
    const on = await page.evaluate(() => [G.tempo, G.metro]);
    expect(on[0] === 'normal' && on[1] === true, 'defaults should be Normal + metronome: ' + on);
    await page.click('#btnSing'); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ ticks: G.ticks.length, beats: Math.ceil(G.seq.reduce((a, n) => a + n.b, 0)), under: played.includes(G.seq[0].m), metro: G.metro, focus: /starting note/.test($('#focus').textContent) }));
    expect(s.ticks >= s.beats + 3 && s.under && s.metro && s.focus, JSON.stringify(s));
    await page.click('#btnSing');
    expect(await page.evaluate(() => G.ticks.length === 0 && G.run === 'ready'), 'ticks not stopped');
  });

  await test('song feedback links to the right Lab exercise', async page => {
    await voice(page); await setLevel(page, 10);
    await tab(page, '#t-sing'); await page.click('[data-tempo="normal"]');
    await page.evaluate(() => { V.follow = true; V.off = -0.35; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(300);
    const b = await page.evaluate(() => [...document.querySelectorAll('.fix button')].map(x => x.textContent).join(' | '));
    expect(/Pitch match/.test(b), 'no lab link: ' + b);
  });

  await test('demo voice never changes your levels or notes', async page => {
    await page.evaluate(() => startDemo()); await page.waitForTimeout(9000);
    await page.evaluate(() => { stopSources(); setMode('idle', 'x'); });
    const s = await page.evaluate(() => ({ lv: level(), found: store.discoveries.length }));
    expect(s.lv === 1 && s.found === 0, JSON.stringify(s));
  });

  await test('every Lab exercise opens once unlocked', async page => {
    await setLevel(page, 10);
    for (const id of ['check', 'range', 'match', 'hold', 'vowels', 'scale', 'leaps', 'hum', 'explore']) {
      await page.evaluate(id => openLab(id), id);
      const ok = await page.evaluate(id => D.id === id && !$('#labStage').hidden, id);
      expect(ok, 'did not open ' + id);
      await page.evaluate(() => closeLab());
    }
  });

  await test('locked songs and exercises cannot be opened early', async page => {
    await setLevel(page, 1);
    const s = await page.evaluate(() => { openLab('vowels'); return { lab: D.id, twinkle: [...document.querySelectorAll('#songs button')].find(b => b.textContent.startsWith('Twinkle'))?.disabled }; });
    expect(s.lab !== 'vowels' && s.twinkle === true, JSON.stringify(s));
  });

  await test('Sing screen fits an iPad screen; phone has no sideways scroll', async (page, browser) => {
    await voice(page); await setLevel(page, 10);
    await tab(page, '#t-sing'); await page.evaluate(() => scrollTo(0, 0));
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(h <= 770, 'iPad page height ' + h);
    const phone = await open(browser, { width: 400, height: 860 });
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    expect(w <= 400, 'phone width ' + w);
  });

  let fails = 0;
  for (const [ok, name, ms, why] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${(ms / 1000).toFixed(1)} s)${ok ? '' : '\n      ' + why}`); if (!ok) fails++; }
  console.log(`\n${results.length - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
