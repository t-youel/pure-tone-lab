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
      g.gain.value = V.on && V.osc !== false ? .35 * (V.vol == null ? 1 : V.vol) : 0; ng.gain.value = V.on ? V.noise : 0.0004; // a faint room hiss, as a real mic always has
      const k = V.wave.join(); if (k !== wv) { wv = k; o.setPeriodicWave(makeWave(V.wave)); }
      o.frequency.setTargetAtTime(m2f(V.m), ac.currentTime, .03);
    }, 25);
  });
}
const setLevel = (page, n) => page.evaluate(n => { store.unlockAll = n >= 4; save(); applyLevel(); }, n);
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
  await test('Home: a new singer sees one card, Unit 1 · Find your voice (First Notes only in Easy mode)', async page => {
    const s = await page.evaluate(() => {
      const vis = e => !!e && e.offsetParent !== null;
      return { cards: [...document.querySelectorAll('#homeCards .hc h3')].map(h => h.textContent), next: $('#homeCards .hc.is-next h3')?.textContent, btn: $('#homeCards .hc.is-next .primary')?.textContent,
        tabs: vis($('.tabs')), meters: vis($('.live')), status: vis($('.status')), back: vis($('#backBar')) };
    });
    expect(s.cards.join('|') === 'Unit 1 · Your voice today', JSON.stringify(s.cards));
    expect(s.next === 'Unit 1 · Your voice today' && /voice check-up/.test(s.btn), JSON.stringify(s));
    expect(!s.tabs && !s.meters && !s.status && !s.back, 'too much on the first screen: ' + JSON.stringify(s));
  });

  await test('Path: 12 units and Checkpoint A in 4 stages, Unit 1 first; small markers', async page => {
    const s = await page.evaluate(() => ({ n: UNITS.length, stages: STAGES.length, first: UNITS[0].title, gate: UNITS.findIndex(u => u.gate), labs: UNITS.filter(u => u.check.lab).map(u => u.check.lab) }));
    expect(s.n === 13 && s.stages === 4 && s.first === 'Your voice today' && s.gate === 5 && new Set(s.labs).size === s.labs.length, JSON.stringify(s));
    await setLevel(page, 10);
    const big = await page.evaluate(() => { $('#t-path').click(); return Math.max(0, ...[...document.querySelectorAll('.u-num')].map(e => e.getBoundingClientRect().width)); });
    expect(big <= 34, 'markers too big: ' + big);
  });

  await test('Home step 1 opens the starting-point check-up, then the voice test with its five phases shown; result leads to step 2', async page => {
    await voice(page);
    await page.click('[data-card="today"] button'); await page.waitForTimeout(200);
    expect(await page.evaluate(() => !!$('#asModal')), 'no check-up intro');
    await page.click('#asModal [data-act="start"]'); await page.waitForTimeout(400);
    const chips = await page.evaluate(() => ({ n: document.querySelectorAll('#vfStrip .vf-chip').length, screen: document.body.dataset.screen, title: $('#screenTitle').textContent }));
    expect(chips.n === 5 && chips.screen === 'voice' && /Find your voice/.test(chips.title), JSON.stringify(chips));
    await page.evaluate(() => { store.settings = { speak: false }; setInterval(() => { const ph = D.phase; V.on = ['speak', 'natural', 'low', 'high', 'stretch'].includes(ph); V.m = ph === 'low' ? 43 : ph === 'high' ? 60 : ph === 'stretch' ? 40 + ((performance.now() / 120) % 24) : ph === 'speak' ? 46 + Math.sin(performance.now() / 300) * 2 : 48; }, 30); });
    await page.click("#dBtns >> text=Let's go");
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 120000 });
    const done = await page.evaluate(() => [...document.querySelectorAll('#vfStrip .vf-chip.done')].length);
    expect(done === 5, 'chips done: ' + done);
    await page.click('#dBtns >> text=Next: step 2 of 5');
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ drill: D.id, step: ASSESS.step }));
    expect(s.drill === 'match' && s.step === 1, JSON.stringify(s));
  });

  await test('first lesson: Do-Re-Mi with words, then "Strongest notes: …"', async page => {
    await voice(page);
    await page.evaluate(() => { openLab('scale', true); $('#t-lab').click(); }); await page.waitForTimeout(400);
    const words = await page.evaluate(() => [D.id, G.song.id, [...document.querySelectorAll('#staff .lyr')].map(t => t.textContent).join(' ')]);
    expect(words[0] === 'scale' && /Do Re Mi Fa So La Ti Do/.test(words[2]), JSON.stringify(words));
    await page.evaluate(() => { window.badNotes = [5, 6]; setInterval(() => { const tg = G.seq[G.idx]; V.on = G.run === 'singing'; if (tg) V.m = tg.m + (badNotes.includes(G.idx) ? 1.2 : 0); }, 25); });
    await page.click('[data-tempo="normal"]'); await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(1800);
    const s = await page.evaluate(() => ({ head: document.querySelector('.cheer-big').textContent }));
    expect(/Strongest notes: Do, Re, Mi, Fa and So\./.test(s.head), JSON.stringify(s));
  });

  await test('every song: words line up with the notes; songs are grouped (rock, folk, hymns, solfège, classics)', async page => {
    await setLevel(page, 1); await tab(page, '#t-sing');
    const s = await page.evaluate(() => SONGS.filter(x => !x.lab && x.id !== 'gen').map(song => { loadSong(song); return { id: song.id, ok: G.seq.length === G.seq.filter(x => x.w || x.cont).length && G.seq.length === song.notes.length }; }));
    const bad = s.filter(x => !x.ok).map(x => x.id);
    const grp = await page.evaluate(() => [...document.querySelectorAll('#songs .song-grp')].map(x => x.textContent).join());
    const n = await page.evaluate(() => ['midnight', 'johnhenry', 'risingsun', 'doxology', 'silent', 'joy', 'jesusloves', 'michael'].filter(id => SONGS.some(x => x.id === id) && (SONG_LEVEL[id] || 1) === 1).length);
    expect(!bad.length && grp === 'Rock & roll,Folk & blues,Hymns,Solfège,Classics' && n === 8, JSON.stringify({ bad, grp, n }));
  });

  await test('rock songs: words line up with the notes, and each opens at its level', async page => {
    const s = await page.evaluate(() => ROCK.map(id => { const song = SONGS.find(x => x.id === id); loadSong(song); return { id, n: G.seq.length, words: G.seq.filter(x => x.w || x.cont).length, lv: SONG_LEVEL[id] }; }));
    expect(s.length === 3 && s.every(x => x.n === x.words && x.n >= 30) && s.every(x => (x.lv || 1) === 1), JSON.stringify(s));
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
    await page.evaluate(() => openLab('warmup', true)); await page.waitForTimeout(300);
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

  await test('Listen: one button plays a warm melody tone in tune over soft chords; Pitch pipe gives the first note', async page => {
    const pitch = await page.evaluate(async () => { await ensureAudio(); toneVol.connect(analyser); setMode('file', 't'); playedNote(57, 1.6, 0); await new Promise(r => setTimeout(r, 900)); const o = { v: S.voiced, m: S.midi }; toneVol.disconnect(analyser); setMode('idle', ''); return o; });
    expect(pitch.v && Math.abs(pitch.m - 57) < 0.25, 'played pitch ' + JSON.stringify(pitch));
    const ch = await page.evaluate(() => {
      const plan = id => { const song = SONGS.find(s => s.id === id); loadSong(song); return chordPlan(G.seq, 0.6, G.shift).map(c => c.k); };
      return { saints: plan('saints'), sun: plan('risingsun') };
    });
    expect(ch.saints[0] === 0 && ch.saints[ch.saints.length - 1] === 0 && new Set(ch.saints).size >= 2 && ch.sun[ch.sun.length - 1] === 0, JSON.stringify(ch));
    await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => loadSong(SONGS.find(s => s.id === 'saints')));
    await page.click('#btnListen'); await page.waitForTimeout(2500);
    const mid = await page.evaluate(() => ({ on: playback && playback.sung, play: G.play, label: $('#btnListen').textContent }));
    await page.click('#btnListen');
    const end = await page.evaluate(() => ({ pb: !!playback, label: $('#btnListen').textContent, one: !$('#btnVoice'), pipe: $('#btnRef').textContent }));
    expect(mid.on && mid.play >= 1 && /Stop/.test(mid.label) && !end.pb && end.label === '▶ Listen' && end.one && end.pipe === 'Pitch pipe', JSON.stringify({ mid, end }));
  });

  await test('Path: a unit passes with 70, or with three tries of 50+; two tries of 50+ are not enough', async page => {
    const r = await page.evaluate(() => {
      store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; store.tries = {}; store.passed = [];
      const u2 = UNITS[1], u3 = UNITS[2], out = {};
      out.u1 = unitPassed(UNITS[0]); out.u2open = unitOpen(u2); out.u3open0 = unitOpen(u3);
      recordTry('lab', 'hold', 64); out.after64 = unitPassed(u2);
      recordTry('lab', 'hold', 71); out.after71 = unitPassed(u2); out.u3open = unitOpen(u3);
      recordTry('lab', 'onset', 55); recordTry('lab', 'onset', 52); out.two50 = unitPassed(u3);
      recordTry('lab', 'onset', 40); out.with40 = unitPassed(u3);
      recordTry('lab', 'onset', 58); out.three50 = unitPassed(u3);
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
    const first = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join(), btn: $('#homeCards [data-card="today"] button').textContent }));
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; save(); checkLevel(true); $('#t-home').click(); });
    const later = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join(), title: $('#homeTitle').textContent }));
    await page.click('#homeCards [data-card="checkin"] >> text=Scratchy');
    const safe = await page.evaluate(() => $('#homeCards [data-card="checkin"]').textContent);
    await page.click('#homeCards [data-card="today"] >> text=Open Unit 2');
    const unit = await page.evaluate(() => ({ screen: document.body.dataset.screen, page: !!document.querySelector('.unit-page'), title: $('.unit-card h2').textContent }));
    expect(first.cards === 'today' && /voice check-up/.test(first.btn) && later.cards === 'today,checkin,path,progress,songs' && /Posture & breath/.test(later.title) && /ENT/.test(safe) && unit.screen === 'path' && unit.page && unit.title === 'Posture & breath', JSON.stringify({ first, later, safe: safe.slice(0, 60), unit }));
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

  await test("Today's session: check-in, then warm-up, skill, song and ear run by themselves, with a summary", async page => {
    await voice(page);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; store.passed = ['u1']; store.checkin = {}; save(); WARM.forEach(w => w.secs = 0.4); $('#t-home').click(); });
    await page.click('#homeCards [data-card="today"] >> text=Start today');
    const offer = await page.evaluate(() => ({ open: !$('#sesSheet').hidden, items: [...document.querySelectorAll('#sesCard .ses-plan li')].map(l => l.textContent) }));
    await page.click('#sesCard >> text=😊 Fresh');
    await page.click('#sesGo');
    await page.evaluate(() => {
      SES.blocks.forEach(b => b.secs = 2);
      G.tempo = 'normal';
      setInterval(() => {
        const sing = G.run === 'singing' && G.seq[G.idx];
        V.on = !!sing || (D.target != null && ['wait', 'hold', 'sing'].includes(D.phase));
        if (sing) V.m = G.seq[G.idx].m; else if (D.target != null) V.m = D.target;
      }, 25);
    });
    const seen = new Set();
    for (let k = 0; k < 120; k++) {
      const st = await page.evaluate(() => ({ on: SES.on, i: SES.i, k: SES.blocks[SES.i] && SES.blocks[SES.i].k, d: D.id, bar: !$('#sesBar').hidden }));
      if (st.on) seen.add(st.k + ':' + (st.k === 'song' ? 'song' : st.d));
      if (!st.on) break;
      await page.waitForTimeout(1000);
    }
    const end = await page.evaluate(() => ({ on: SES.on, sheet: !$('#sesSheet').hidden, title: $('#sesTitle').textContent, rows: [...document.querySelectorAll('#sesCard .ses-plan li')].map(l => l.textContent), saved: (store.sessions || []).length, tries: unitTries(UNITS[1]).length, checkin: store.checkin[today()] }));
    expect(offer.open && offer.items.length === 4 && [...seen].join() === 'warm:warmup,skill:hold,song:song,ear:match' && !end.on && end.sheet && /complete/.test(end.title) && end.rows.every(r => r.startsWith('✓')) && end.saved === 1 && end.tries >= 1 && end.checkin === 'fresh', JSON.stringify({ offer, seen: [...seen], end }));
  });

  await test('a scratchy voice gets a gentle warm-up only, with the see-a-doctor rule', async page => {
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'saints', score: 30 }; store.checkin = {}; save(); sesOffer(); });
    await page.click('#sesCard >> text=😣 Scratchy');
    const s = await page.evaluate(() => ({ title: $('#sesTitle').textContent, items: [...document.querySelectorAll('#sesCard .ses-plan li')].length, safety: /ENT/.test($('#sesCard').textContent) }));
    expect(/gentle/i.test(s.title) && s.items === 1 && s.safety, JSON.stringify(s));
  });

  await test('Easter egg: a singer named TedY-137 (or close) can open and skip every unit', async page => {
    const names = await page.evaluate(() => ['TedY-137', 'tedy 137', 'TEDY137', 'Ted Y-137', 'TedY-138', 'Tedy137!', 'Ted', 'Singer 1', 'Teddy'].map(n => { users.names[users.active] = n; return n + '=' + isTester(); }));
    const want = 'TedY-137=true,tedy 137=true,TEDY137=true,Ted Y-137=true,TedY-138=true,Tedy137!=true,Ted=false,Singer 1=false,Teddy=false';
    expect(names.join() === want, names.join());
    await page.evaluate(() => { users.names[users.active] = 'Singer 1'; store.devPass = []; applyLevel(); });
    const off = await page.evaluate(() => ({ open: UNITS.filter(unitOpen).length, tools: !!document.querySelector('.tester') }));
    await page.evaluate(() => { users.names[users.active] = 'Tedy-137'; applyLevel(); $('#t-home').click(); });
    const home = await page.evaluate(() => [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join());
    expect(home === 'tester,today', 'home in tester mode: ' + home);
    await page.click('#homeCards [data-card="tester"] >> text=Use a sample voice');
    const filled = await page.evaluate(() => [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card).join());
    expect(filled === 'tester,today,checkin,path,progress,songs', 'after sample voice: ' + filled);
    await page.evaluate(() => { store.devPass = []; store.passed = []; });
    await page.click('#homeCards [data-card="tester"] >> text=Unit 1');
    await page.click('.tester-row >> text=Mark passed');
    const after = await page.evaluate(() => ({ title: $('.unit-card h2').textContent, u1: unitPassed(UNITS[0]), open: UNITS.filter(unitOpen).length }));
    await page.evaluate(() => { unitView = null; renderPath(); });
    await page.click('.tester >> text=Mark all passed');
    const all = await page.evaluate(() => ({ passed: UNITS.filter(unitPassed).length, cel: $('#celebrate').hidden }));
    await page.evaluate(() => { users.names[users.active] = 'Singer 1'; applyLevel(); });
    const back = await page.evaluate(() => UNITS.filter(unitPassed).length);
    expect(off.open === 1 && !off.tools && after.title === 'Posture & breath' && after.u1 && after.open === 13 && all.passed === 13 && all.cel && back === 1, JSON.stringify({ off, after, all, back }));
  });

  await test('Solfège: hand signs under each note (toggle, ⓘ guide); patterns and Climb the Ladder line up; metronome ticks during Listen', async page => {
    await setLevel(page, 1); await tab(page, '#t-sing');
    const r = await page.evaluate(() => {
      const out = {};
      for (const id of ['patterns', 'ladder', 'doremi']) { loadSong(SONGS.find(s => s.id === id)); out[id] = G.seq.length === G.seq.filter(x => x.w).length; }
      loadSong(SONGS.find(s => s.id === 'doremi'));
      const lit = [];
      for (let i = 0; i < 8; i++) { G.idx = i; drawStaff(); const on = $('#staff .sg.on'); lit.push(on ? SIGN_NAME[signIndex(G.seq[i].m)] : '-'); }
      out.lit = lit.join(' '); out.signs = document.querySelectorAll('#staff .sg').length; out.shown = out.signs === 8 && $('#signs').hidden;
      loadSong(SONGS.find(s => s.id === 'saints')); out.hiddenRock = !document.querySelector('#staff .sg');
      $('#btnSigns').click(); out.rockOn = !!document.querySelector('#staff .sg') && store.settings.signs === true;
      $('#btnSigns').click(); out.rockOff = !document.querySelector('#staff .sg');
      out.u4 = UNITS[3].song + '/' + UNITS[3].extra; out.lab = !!LAB.find(x => x.id === 'patterns');
      return out;
    });
    expect(r.patterns && r.ladder && r.doremi && r.lit === 'Do Re Mi Fa So La Ti Do' && r.signs === 8 && r.shown && r.hiddenRock && r.rockOn && r.rockOff && r.u4 === 'ladder/patterns' && r.lab, JSON.stringify(r));
    await page.evaluate(() => { delete store.settings.signs; openLab('patterns'); });
    expect(await page.evaluate(() => D.id === 'patterns' && G.song.id === 'patterns' && !!document.querySelector('#staff .sg')), 'patterns lab did not open with signs');
    await page.click('#infoSigns');
    expect(await page.evaluate(() => !$('#infoSheet').hidden && document.querySelectorAll('#infoCard .sign-list li').length === 8 && document.querySelectorAll('#infoCard .sg').length === 8), 'hand-sign guide');
    // the metronome ticks while Listen plays
    const ticks = await page.evaluate(async () => { $('#infoSheet').hidden = true; await ensureAudio(); G.metro = true; loadSong(SONGS.find(s => s.id === 'ladder')); await listenFirst(); const n = G.ticks.length; stopPlayback(); return { n, after: G.ticks.length }; });
    expect(ticks.n >= 10 && ticks.after === 0, 'metronome during Listen ' + JSON.stringify(ticks));
  });

  await test('Recordings: a sung song is saved on the device with its pitch trace; first and best are kept', async page => {
    await voice(page);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = null; store.clips = []; save(); });
    await tab(page, '#t-sing');
    await page.evaluate(() => { loadSong(SONGS.find(s => s.id === 'mary')); G.tempo = 'normal'; V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 });
    await page.waitForFunction(() => (store.clips || []).length === 1, null, { timeout: 10000 });
    const c = await page.evaluate(async () => { const m = store.clips[0]; const blob = await idbDo('readonly', s => s.get(clipKey(m.id))); return { first: m.first, song: m.song, size: blob && blob.size, trace: m.trace.filter(v => v != null).length, kept: clipKept(m) }; });
    expect(c.first && c.song === 'mary' && c.size > 1000 && c.trace > 20 && c.kept, JSON.stringify(c));
  });

  await test('Progress: you vs your starting point, comfort scores, star, delete and storage controls', async page => {
    await page.evaluate(async () => {
      store.profile = { low: 41, high: 66, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 };
      store.baseline = { id: 'mary', score: 40, ok: 10, n: 26, at: 1, profile: { low: 43, high: 63 } };
      store.runs = [{ id: 'mary', at: 5, score: 72, ok: 20, n: 26 }]; store.lab = { match: { best: 64 } };
      const mk = (id, at, score, extra) => ({ id, song: 'mary', at, score, ok: 1, n: 26, secs: 20, size: 4096, star: false, first: false, target: [60, 62, 64], trace: [60, 61, null, 62], ...extra });
      const old = Date.now() - 40 * 864e5;
      store.clips = [mk('a', old, 40, { first: true }), mk('b', old, 90), mk('c', old, 50), mk('d', Date.now(), 55), mk('e', old, 45, { star: true })];
      for (const c of store.clips) await idbDo('readwrite', s => s.put(new Blob(['x'.repeat(100)]), clipKey(c.id)));
      save(); $('#t-progress').click();
    });
    const v = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.cmp-table tbody tr')].map(r => r.textContent), clips: document.querySelectorAll('.clip').length, range: !!document.querySelector('.prog-range'), screen: document.body.dataset.screen }));
    expect(v.screen === 'progress' && v.range && v.clips === 5 && v.rows.some(r => /score4072/.test(r.replace(/\s|↑/g, ''))), JSON.stringify(v));
    await page.click('.comfort-row[data-k="breath"] >> text=4');
    await page.click('.clip[data-clip="d"] >> text=☆ Keep');
    await page.click('.clip[data-clip="c"] button[aria-label="Delete this recording"]');
    await page.click('.clip[data-clip="c"] >> text=Delete?');
    await page.waitForFunction(() => !store.clips.some(c => c.id === 'c'), null, { timeout: 3000 }).catch(() => {});
    const after = await page.evaluate(() => ({ comfort: store.comfort[weekKey()].breath, starred: store.clips.find(c => c.id === 'd').star, ids: store.clips.map(c => c.id).join() }));
    // auto-delete is on by default: old, unkept takes go; first (a), best (b) and starred (e, d) stay
    const pruned = await page.evaluate(async () => { store.clips.push({ id: 'f', song: 'mary', at: Date.now() - 31 * 864e5, score: 10, star: false, first: false, size: 10 }); const n = await pruneClips(); return { n, ids: store.clips.map(c => c.id).join() }; });
    expect(after.comfort === 4 && after.starred && after.ids === 'a,b,d,e' && pruned.n === 1 && pruned.ids === 'a,b,d,e', JSON.stringify({ after, pruned }));
  });

  await test('Tone tools: gentle onsets score a clean start; the unit checks point to the new drills', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; openLab('onset'); });
    await page.click('#dBtns >> text=▶ Start');
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'att' || D.phase === 'wait'; if (D.target != null) V.m = D.target; }, 20); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 40000 });
    const r = await page.evaluate(() => ({ best: labBestOf('onset'), kinds: D.res.map(x => x.kind).join(), u3: UNITS[2].check.lab, u7: UNITS.find(u => u.id === 'u7').check.lab, u8: UNITS.find(u => u.id === 'u8').check.lab, u9: UNITS.find(u => u.id === 'u9').check.lab }));
    expect(r.best >= 70 && r.u3 === 'onset' && r.u7 === 'breaks' && r.u8 === 'blend' && r.u9 === 'swell', JSON.stringify(r));
  });

  await test('Tone tools: the break finder spots a sudden jump in a siren and remembers it', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { openLab('breaks'); });
    await page.click('#dBtns >> text=Start the siren');
    // a slow siren from A2 up to D4 that flips by 2 semitones around F3
    await page.evaluate(() => { const t0 = performance.now(); setInterval(() => { const e = (performance.now() - t0) / 1000 - 0.4; V.on = D.phase === 'run' && e > 0 && e < 8; const m = 45 + e * 2; V.m = m < 53 ? m : m + 2; }, 20); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 20000 });
    const r = await page.evaluate(() => ({ br: store.voiceBreak, best: labBestOf('breaks'), head: $('.cheer-big').textContent, svg: !!$('#dResult .siren-svg') }));
    expect(r.br && Math.abs(r.br.m - 54) <= 1 && r.br.size >= 1.5 && r.best > 0 && /break is around/.test(r.head) && r.svg, JSON.stringify(r));
  });

  await test('Tone tools: blend scores a smooth siren through the break higher than a jumpy one', async page => {
    await voice(page); await setLevel(page, 10);
    const run = async jump => {
      await page.evaluate(() => { store.voiceBreak = { m: 55, size: 2 }; closeLab(); openLab('blend'); });
      await page.click('#dBtns >> text=▶ Start');
      await page.evaluate(j => { clearInterval(window.bi); const t0 = performance.now(); window.bi = setInterval(() => { const e = (performance.now() - t0) / 1000; V.on = D.phase === 'run' && e < 12; const ph = (e % 4) / 4, m = 50 + 10 * (ph < 0.5 ? ph * 2 : 2 - ph * 2); V.m = j && m > 55 ? m + 2 : m; }, 20); }, jump);
      await page.waitForFunction(() => D.phase === 'done', null, { timeout: 25000 });
      return page.evaluate(() => labRec('blend').last);
    };
    const smooth = await run(false), jumpy = await run(true);
    expect(smooth >= 70 && jumpy < smooth - 15, JSON.stringify({ smooth, jumpy }));
  });

  await test('Tone tools: swell rewards soft-loud-soft with steady pitch; exhale measures a long even hiss', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; openLab('swell'); });
    await page.click('#dBtns >> text=▶ Start');
    await page.evaluate(() => { setInterval(() => { V.on = ['wait', 'hold'].includes(D.phase); V.m = D.target; const e = D.phase === 'hold' ? now() - D.t0 : 0; V.vol = 0.08 + 0.92 * Math.max(0, 1 - Math.abs(e - 4) / 4); }, 20); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 25000 });
    const sw = await page.evaluate(() => labRec('swell').last);
    await page.evaluate(() => { closeLab(); V.vol = 1; openLab('exhale'); });
    await page.click('#dBtns >> text=▶ Start');
    await page.evaluate(() => { V.osc = false; V.noise = 0.2; setInterval(() => { V.on = D.phase === 'out' && D.on < 15; }, 20); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 120000 });
    const ex = await page.evaluate(() => ({ last: labRec('exhale').last, rounds: D.rounds.map(r => r.secs.toFixed(0)).join() }));
    expect(sw >= 60 && ex.last >= 70 && ex.rounds === '15,15', JSON.stringify({ sw, ex }));
  });

  await test('Checkpoint A has two parts: the scale and echoing a new melody heard once', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.tries = {}; openLab('echo'); });
    await page.click('#dBtns >> text=Play the tune');
    await page.evaluate(() => { setInterval(() => { const sing = D.phase === 'sing'; V.on = sing; if (sing && D.mel) { const i = Math.min(D.mel.notes.length - 1, Math.floor((now() - D.t0) / D.beat)); V.m = D.mel.notes[i].m; } }, 20); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const cp = UNITS.find(u => u.id === 'cpA'); store.unlockAll = true;
      const echo = labRec('echo').last; const out = { echo, afterEcho: unitPassed(cp) };
      recordTry('song', 'doremi', 80); out.both = unitPassed(cp); out.status = unitStatus(cp); return out;
    });
    expect(r.echo >= 70 && !r.afterEcho && r.both, JSON.stringify(r));
  });

  await test('ⓘ help: Any octave explained; the key picker suggests a centered key and switches to it', async page => {
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; save(); $('#t-sing').click(); loadSong(SONGS.find(s => s.id === 'johnhenry')); G.shift += 5; loadSong(G.song, true); });
    await page.click('#infoOct');
    const oct = await page.evaluate(() => ({ open: !$('#infoSheet').hidden, txt: $('#infoCard').textContent }));
    await page.click('#infoCard >> text=Got it');
    await page.click('#infoKey');
    const kp = await page.evaluate(() => { const { best } = keyOptions(); return { rows: document.querySelectorAll('.key-row').length, best: best.k, bestRow: !!document.querySelector('.key-row.best'), center: (best.low + best.high) / 2 }; });
    await page.click('.key-row.best >> text=Use');
    const after = await page.evaluate(() => ({ shift: G.shift, closed: $('#infoSheet').hidden, label: $('#keyTxt').textContent }));
    expect(oct.open && /octave/.test(oct.txt) && /in tune/.test(oct.txt) && kp.rows >= 3 && kp.bestRow && Math.abs(kp.center - 53) <= 1.5 && after.shift === kp.best && after.closed && /Do = /.test(after.label), JSON.stringify({ oct: oct.open, kp, after }));
  });

  await test('Personal: songs built from notes you sing well (and it says so); break guess, tips and warm-ups use your voice', async page => {
    await setLevel(page, 10);
    const r = await page.evaluate(() => {
      store.profile = { low: 43, high: 64, natural: 52, type: 'Tenor', zlo: 47, zhi: 60 }; store.voiceBreak = null;
      // the singer has sung C3 D3 E3 F3 G3 well, and nothing else
      store.notes = {}; [48, 50, 52, 53, 55].forEach(m => store.notes[m] = { sec: 2, psum: 2 * 65, best: 70 }); store.runs = []; store.holdNotes = {}; store.discoveries = [];
      store.baseline = { id: 'saints', score: 40 }; save(); applyLevel();
      const fits = songFits(store.profile), top = fits[0], f = pickSong(store.profile);
      const card = $('#homeCards [data-card="songs"]').textContent;
      $('#t-sing').click(); renderSongs();
      const stars = [...document.querySelectorAll('#songs button.fit-star')].map(b => b.textContent);
      const bg = breakGuess(store.profile);
      openUnit(UNITS.find(u => u.id === 'u7')); unitStep = 1; renderPath();
      const tip = $('.type-tip') ? $('.type-tip').textContent : '';
      const lip = warmRange(WARM.find(w => w.t === 'Lip trills')), hum = warmRange(WARM.find(w => w.t === 'Hum'));
      return { topFit: top.fit, pick: f && f.s.id, pickFit: f && f.fit, card, stars: stars.length, bg, tip, lip: lip && lip.text, hum: hum && hum.text };
    });
    expect(r.topFit >= 0.6 && r.pickFit >= r.topFit - 0.1 && /already sing well/.test(r.card) && r.stars >= 1 && r.stars <= 5 && r.bg.m === 61 && !r.bg.measured && /Tenor/.test(r.tip) && /E4–G4/.test(r.tip) && /A♯2 to C♯4/.test(r.lip) && /E3/.test(r.hum), JSON.stringify(r));
  });

  await test("What's inside: 4 stage cards say what you learn and where you are; tiles for the rest; the full list folded away", async page => {
    await page.click('#btnTour');
    const s = await page.evaluate(() => ({ screen: document.body.dataset.screen,
      stages: [...document.querySelectorAll('.road-card')].map(c => ({ badge: c.querySelector('.sc-badge').textContent, learn: c.querySelector('.sc-learn').textContent, units: c.querySelectorAll('.sc-units li').length, dis: c.disabled })),
      tiles: [...document.querySelectorAll('.tour-tile')].map(t => t.dataset.item).join(), tutorLocked: $('.tour-tile[data-item="tutor"]').disabled,
      folded: !$('.tour-all').open, labs: document.querySelectorAll('.tour-row[data-item^="lab-"]').length, total: LAB.length, lockedLab: $('.tour-row[data-item="lab-vowels"] button').disabled, lockTxt: $('.tour-row[data-item="lab-vowels"]').textContent }));
    await page.click('.tour-all summary'); await page.click('.tour-row[data-item="lab-match"] button');
    const opened = await page.evaluate(() => D.id);
    expect(s.screen === 'tour' && s.stages.length === 4 && /You are here/.test(s.stages[0].badge) && /After Stage 1/.test(s.stages[1].badge) && s.stages[1].dis && !s.stages[0].dis
      && s.stages.every(x => x.learn.length > 20 && x.units >= 2) && s.tiles === 'session,songs,tutor,workout,home,pro,lab,range,progress,easy' && s.tutorLocked && s.folded
      && s.labs === s.total && s.lockedLab && /Opens in Stage 3/.test(s.lockTxt) && opened === 'match', JSON.stringify({ s, opened }));
  });

  await test('Style tools: timing against the beat; breaths at the ʼ marks; each line shaped; Stage 4 checks use them', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'mary', score: 30, ok: 8, n: 26, at: 1, profile: { low: 45, high: 62 } }; store.tries = {}; save(); });
    await tab(page, '#t-sing');
    // a singer who can lag behind, breathe at the marks, and shape each line
    await page.evaluate(() => {
      window.SG = { lag: 0, breathe: true, shape: true };
      setInterval(() => {
        if (G.run !== 'singing' || !G.starts) { V.on = false; return; }
        const e = now() - G.t0 - SG.lag; let i = 0; while (i < G.seq.length - 1 && G.starts[i + 1] <= e) i++;
        const end = i < G.seq.length - 1 ? G.starts[i + 1] : 1e9;
        V.on = e >= 0 && !(SG.breathe && G.seq[i].br && e > end - 0.22);
        V.m = G.seq[i].m;
        const ln = G.lines.find(([a, b]) => i >= a && i <= b) || [0, 1], pos = (i - ln[0]) / Math.max(1, ln[1] - ln[0]);
        V.vol = SG.shape ? 0.25 + 0.75 * Math.sin(Math.PI * pos) : 1;
      }, 15);
    });
    const sing = async (id, lag) => {
      await page.evaluate(([id, lag]) => { $('#celebrate').hidden = true; SG.lag = lag; loadSong(SONGS.find(s => s.id === id)); G.tempo = 'slow'; }, [id, lag]);
      await page.click('#btnSing');
      await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(400);
      return page.evaluate(() => { const st = runStats(); return { late: st.lateMs, tim: st.timingScore, br: st.breath, ph: st.phrase, score: st.score, marks: document.querySelectorAll('#staff .brm').length, stats: $('#report .report-top').textContent }; });
    };
    const marks = await page.evaluate(() => { loadSong(SONGS.find(s => s.id === 'jukebox')); return { drawn: document.querySelectorAll('#staff .brm').length, total: G.seq.filter(n => n.br).length }; });
    const onTime = await sing('jukebox', 0);
    const late = await sing('jukebox', 0.4);
    const u10 = await page.evaluate(() => { const u = UNITS.find(x => x.id === 'u10'); return { tries: unitTries(u, u.check).map(x => x.s), lateCheck: checkScore(u.check, 49, { timing: 0 }) }; });
    expect(marks.drawn >= 1 && marks.total >= 4 && onTime.late <= 150 && onTime.tim >= 80 && late.late >= 300 && late.tim < onTime.tim - 25 && onTime.br.taken >= onTime.br.marks - 1 && onTime.br.mid <= 1 && onTime.ph.shaped >= onTime.ph.lines - 1 && /Timing/.test(onTime.stats) && /Breaths/.test(onTime.stats) && u10.tries[0] >= 70 && u10.lateCheck < 30, JSON.stringify({ marks, onTime, late, u10 }));
  });

  await test('Showcase: after a full song, compare with your first song and write what changed; Unit 12 needs the reflection', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = { id: 'mary', score: 30, ok: 8, n: 26, at: 1, profile: { low: 45, high: 62 } }; store.tries = {}; store.reflection = null; save(); });
    await tab(page, '#t-sing');
    await page.evaluate(() => { loadSong(SONGS.find(s => s.id === 'mary')); G.tempo = 'normal'; V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(500);
    const panel = await page.evaluate(() => ({ on: !!$('#report [data-card="showcase"]'), rows: document.querySelectorAll('#report .showcase tbody tr').length }));
    const u12 = await page.evaluate(() => { const u = UNITS.find(x => x.id === 'u12'); return { tries: unitTries(u, u.check).length, passedBefore: unitPassed(u), status: unitStatus(u) }; });
    await page.evaluate(() => { $('#celebrate').hidden = true; });
    await page.fill('#reflectText', 'My notes land where I aim them now.');
    await page.click('#report >> text=Save my reflection');
    const after = await page.evaluate(() => ({ saved: store.reflection && store.reflection.text, passed: unitPassed(UNITS.find(x => x.id === 'u12')) }));
    expect(panel.on && panel.rows >= 3 && u12.tries === 1 && !u12.passedBefore && /write what changed/.test(u12.status) && after.saved && after.passed, JSON.stringify({ panel, u12, after }));
  });

  await test('the screen stays awake while singing and lets go afterwards', async page => {
    const r = await page.evaluate(async () => {
      const log = []; let held = null;
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { log.push('on'); held = { listeners: [], addEventListener(e, f) { this.listeners.push(f); }, release: async () => { log.push('off'); } }; return held; } } });
      await keepAwake(); const idle = log.length;
      setMode('mic', 'test'); await keepAwake(); const on = !!WAKE.lock;
      setMode('idle', ''); await keepAwake();
      return { idle, on, log: log.join(), after: WAKE.lock };
    });
    expect(r.idle === 0 && r.on && r.log === 'on,off' && r.after === null, JSON.stringify(r));
  });

  await test('First Notes (Easy mode): one screen, buttons on top; the daily games flow on their own; seven games to choose from', async page => {
    await voice(page);
    expect(await page.evaluate(() => !document.querySelector('#homeCards [data-card="easy"]')), 'First Notes shows without Easy mode');
    await page.click('#btnEasy');
    expect(await page.evaluate(() => [...document.querySelectorAll('#homeCards .hc')].map(c => c.dataset.card)[0] === 'easy'), 'Easy mode puts First Notes first');
    await page.click('#homeCards [data-card="easy"] button');
    const open = await page.evaluate(() => ({ screen: document.body.dataset.screen, bar: [...document.querySelectorAll('#easyBtns .easy-btn')].map(b => b.getAttribute('aria-label')).join(), steps: document.querySelectorAll('#easySteps .es').length, fits: document.documentElement.scrollHeight <= innerHeight + 2, first: ezKey(), card: !$('#easyCard').hidden && /eggs/.test($('#easyCard').textContent) && !!$('#easyCard .ec-go') }));
    // start the first game with the big Start button; the rest start by themselves
    await page.click('#easyCard .ec-go');
    const tip = await page.evaluate(() => !$('#easyTip').hidden && /gold band/.test($('#easyTip').textContent));
    // a singer who follows whatever the target asks for
    await page.evaluate(() => { setInterval(() => { V.on = EZ.phase === 'run'; V.m = EZ.tgt != null ? EZ.tgt : 50; }, 20); });
    await page.waitForFunction(() => EZ.phase === 'done', null, { timeout: 400000 });
    const routine = await page.evaluate(() => ({ stars: EZ.stars, day: store.easy.days[today()], done: !$('#easyCard').hidden && /Play again/.test($('#easyCard').textContent) && /More lessons/.test($('#easyCard').textContent) }));
    expect(open.screen === 'easy' && /Home,Lessons,Again,Next,Helpers/.test(open.bar) && open.steps === 5 && open.fits && open.first === 'match' && open.card && tip && routine.stars >= 10 && routine.day.best >= 60 && routine.done, JSON.stringify({ open, tip, routine }));
    // the games menu, and two of the new games
    await page.click('#easyCard >> text=More lessons');
    const tiles = await page.evaluate(() => [...document.querySelectorAll('#easyMenu .easy-tile')].map(x => x.dataset.game).join());
    await page.click('.easy-tile[data-game="piano"]');
    await page.waitForFunction(() => EZ.piano && !$('#easyPiano').hidden, null, { timeout: 5000 });
    // first the app plays the song, lighting the keys; then it's your turn
    const demo = await page.evaluate(() => EZ.piano.phase);
    await page.waitForFunction(() => EZ.piano.phase === 'play', null, { timeout: 20000 });
    // a wrong key doesn't play; the right one wiggles to show the way
    await page.click('.pn-key:nth-child(8)');
    const wrong = await page.evaluate(() => ({ i: EZ.piano.i, wiggle: !!document.querySelector('.pn-key.wiggle') }));
    const n = await page.evaluate(() => EZ.piano.notes.length);
    for (let i = 0; i < n; i++) await page.click('.pn-key.want');
    await page.waitForFunction(() => EZ.song && EZ.phase === 'run', null, { timeout: 20000 });
    expect(demo === 'demo' && wrong.i === 0 && wrong.wiggle, 'piano teaching: ' + JSON.stringify({ demo, wrong }));
    const piano = await page.evaluate(() => ({ singAlong: !!EZ.song, stars: EZ.stars }));
    await page.evaluate(() => easyOpen(['grow']));
    await page.waitForFunction(() => EZ.phase === 'done', null, { timeout: 60000 });
    const grow = await page.evaluate(() => EZ.stars);
    expect(tiles === 'hello,match,updown,echo,grow,piano,song' && piano.singAlong && piano.stars >= 1 && grow >= 3, JSON.stringify({ tiles, piano, grow }));
  });

  await test('First Notes: a silent, paused mic shows a big tap-to-wake card; the keep-awake video plays while singing', async page => {
    await voice(page);
    await page.evaluate(() => { store.settings = { easyMode: true }; save(); $('#t-easy').click(); });
    await page.evaluate(async () => { await ac.suspend(); });
    await page.waitForFunction(() => !$('#easyCard').hidden && !!$('#easyCard .ec-wake'), null, { timeout: 8000 });
    await page.click('#easyCard .ec-wake');
    await page.waitForFunction(() => ac.state === 'running' && !$('#easyCard .ec-wake'), null, { timeout: 5000 });
    const vid = await page.evaluate(async () => { await keepAwake(); const v = $('#keepAwake'); return { src: v.src.startsWith('data:video/mp4'), playing: !v.paused }; });
    expect(vid.src && vid.playing, JSON.stringify(vid));
  });

  await test('First Notes: a singer a half step off still gets the bird home (the band widens, close counts a little); targets are whole steps', async page => {
    await voice(page);
    await page.evaluate(() => { store.settings = { easyMode: true }; save(); $('#t-easy').click(); easyOpen(['match']); });
    await page.evaluate(() => { setInterval(() => { V.on = EZ.phase === 'run'; if (EZ.tgt != null) V.m = EZ.tgt + 1; }, 20); });
    await page.click('#easyCard .ec-go');
    const targets = []; for (let k = 0; k < 240 && (await page.evaluate(() => EZ.phase)) === 'run'; k++) { const tg = await page.evaluate(() => EZ.tgt); if (tg != null && !targets.includes(tg)) targets.push(tg); await page.waitForTimeout(500); }
    const r = await page.evaluate(() => ({ phase: EZ.phase, stars: EZ.stars }));
    const steps = targets.slice(1).map((m, i) => m - targets[i]);
    expect(r.stars >= 3 && steps.every(x => x === 2), JSON.stringify({ r, targets, steps }));
  });

  await test('First Notes: the app never counts its own note as singing; arrivals are celebrated before the next round', async page => {
    await voice(page);
    // the speaker's sound leaks into the mic, and nobody sings
    await page.evaluate(() => { store.settings = { easyMode: true }; save(); toneVol.connect(analyser); $('#t-easy').click(); easyOpen(['updown']); });
    await page.click('#easyCard .ec-go');
    await page.waitForTimeout(12000);
    const silent = await page.evaluate(() => ({ stars: EZ.stars, round: EZ.round, phase: EZ.phase }));
    // now a singer, louder than the speaker, on the note
    await page.evaluate(() => { setInterval(() => { V.on = EZ.phase === 'run' && !EZ.cel; if (EZ.tgt != null) V.m = EZ.tgt; }, 20); });
    await page.waitForFunction(() => !!EZ.cel, null, { timeout: 30000 });
    const cel = await page.evaluate(() => ({ stars: EZ.stars, round: EZ.round, k: EZ.cel.k }));
    await page.waitForTimeout(1500);
    const still = await page.evaluate(() => ({ cel: !!EZ.cel, round: EZ.round }));
    expect(silent.stars === 0 && silent.round === 0 && silent.phase === 'run' && cel.stars === 1 && cel.round === 0 && cel.k === 'updown' && still.cel && still.round === 0, JSON.stringify({ silent, cel, still }));
  });

  await test('First Notes songs: words ride on their notes toward the bird; the cues never earn stars on their own', async page => {
    await voice(page);
    await page.evaluate(() => { store.settings = { easyMode: true }; save(); toneVol.connect(analyser); $('#t-easy').click(); easyOpen(['song']); });
    await page.click('.easy-tile >> nth=1');
    await page.waitForFunction(() => EZ.phase === 'won' || EZ.phase === 'done', null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ stars: EZ.stars, colors: EZ.song ? EZ.song.notes.every(n => !!DEG_COLOR[ezDeg(n.m)]) : null }));
    expect(r.stars === 0, 'stars without singing: ' + JSON.stringify(r));
  });

  await test('First Notes: every screen fits an iPhone, the iPad in-app window, and a full iPad (nothing cut off)', async (page, browser) => {
    const bad = [];
    for (const [name, w, h] of [['iphone', 390, 664], ['ipad-sheet', 490, 500], ['ipad', 1180, 820]]) {
      const pg = await open(browser, { width: w, height: h });
      await pg.evaluate(async () => { store.settings = { easyMode: true, ezWords: true }; store.easy = { days: { '2026-10-30': { stars: 9, best: 40, times: 1 } } }; save(); await ensureAudio(); setMode('mic', 'x'); $('#t-easy').click(); });
      const states = { start: () => easyOpen(['match']), menu: () => ezMenu(), songpick: () => easyOpen(['song']), piano: () => { easyOpen(['piano']); ezStart(); }, end: () => { easyOpen(['match']); EZ.stars = 6; EZ.voiced = 10; EZ.inTune = 4; EZ.i = 1; EZ.phase = 'done'; ezRender(); } };
      for (const [label, fn] of Object.entries(states)) {
        await pg.evaluate(fn); await pg.waitForTimeout(300);
        const r = await pg.evaluate(() => { const stage = $('.easy-stage').getBoundingClientRect(); const ov = ['#easyCard', '#easyMenu', '#easyPiano'].map(id => $(id)).filter(e => e && !e.hidden); return document.documentElement.scrollHeight > innerHeight + 2 || ov.some(e => e.scrollHeight > e.clientHeight + 2 || [...e.querySelectorAll('button')].some(bt => { const q = bt.getBoundingClientRect(); return q.bottom > stage.bottom + 1 || q.top < stage.top - 1; })); });
        if (r) bad.push(name + ':' + label);
      }
    }
    expect(!bad.length, 'does not fit: ' + bad.join(', '));
  });

  await test('Sing with the band: pick a popular song, sing it, then hear it back with drums, bass and piano in sync', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; save(); openLab('band'); });
    const songs = await page.evaluate(() => [...document.querySelectorAll('.band-song')].map(b => b.dataset.song).join());
    await page.click('.band-song[data-song="bday"]');
    const loaded = await page.evaluate(() => ({ song: G.song.id, screen: document.body.dataset.screen, band: G.bandMode, metro: G.metro }));
    await page.evaluate(() => { G.tempo = 'normal'; V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 });
    await page.waitForFunction(() => (store.clips || []).some(c => c.song === 'bday'), null, { timeout: 10000 });
    const clip = await page.evaluate(() => { const c = store.clips.filter(c => c.song === 'bday').pop(); return { lead: c.lead, beat: c.beat, notes: c.notes && c.notes.length, offer: !!document.querySelector('#report [data-card="band"]') }; });
    await page.click('#report [data-card="band"] button');
    await page.waitForFunction(() => !!bandTake, null, { timeout: 8000 });
    const playing = await page.evaluate(() => ({ nodes: bandNodes.length, label: $('#report [data-card="band"] button').textContent }));
    // the mix: raise the voice, lower the band, live while it plays
    await page.evaluate(() => { const set = (k, v) => { const r = document.querySelector('[data-mix="' + k + '"]'); r.value = v; r.dispatchEvent(new Event('input')); }; set('v', 250); set('b', 20); });
    await page.waitForTimeout(300);
    const mix = await page.evaluate(() => ({ v: bandTake.vg.gain.value, b: bandBus.gain.value, saved: store.bandMix }));
    await page.click('#report [data-card="band"] button[data-act="all"]');
    const stopped = await page.evaluate(() => ({ take: !!bandTake, nodes: bandNodes.length }));
    // line by line notes: every line listed, with a tag, and playable on its own
    const lines = await page.evaluate(() => [...document.querySelectorAll('#report .line-row')].map(r => ({ tag: r.querySelector('.lr-tag').textContent, words: r.querySelector('.lr-words').textContent, tip: (r.querySelector('.lr-tip') || {}).textContent || '', how: !!r.querySelector('[data-act="how"]') })));
    await page.click('#report .line-row[data-line="2"] [data-act="me"]');
    await page.waitForFunction(() => !!bandTake, null, { timeout: 8000 });
    const seg = await page.evaluate(() => ({ seg: bandTake.seg, nodes: bandNodes.length, v: bandTake.vg.gain.value }));
    await page.waitForFunction(() => !bandTake, null, { timeout: 15000 });
    expect(songs === 'saints,bday,jingle,twinkle,grace' && loaded.song === 'bday' && loaded.screen === 'songs' && loaded.band && clip.lead > 1 && clip.notes === 25 && clip.offer && playing.nodes > 100 && /Stop/.test(playing.label)
      && Math.abs(mix.v - 4) < 0.2 && Math.abs(mix.b - 0.2) < 0.05 && mix.saved.v === 2.5 && !stopped.take && stopped.nodes === 0
      && lines.length === 4 && lines[2].words === 'happy birthday dear friend,' && lines.every(l => /Sung well|Nearly|Needs work|best line/.test(l.tag))
      && seg.seg.join() === '12,18' && seg.nodes > 10 && seg.nodes < playing.nodes && Math.abs(seg.v - 4) < 0.01, JSON.stringify({ songs, loaded, clip, playing, mix, stopped, lines, seg }));
  });

  await test('Line notes: a flat line is marked Needs work with a tip naming the word, and How it goes plays that line', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { openLab('band'); }); await page.click('.band-song[data-song="bday"]');
    // sing lines 1, 2 and 4 in tune but line 3 a semitone flat
    await page.evaluate(() => { G.tempo = 'normal'; V.follow = true; setInterval(() => { V.off = G.idx >= 12 && G.idx <= 18 ? -0.6 : 0; }, 20); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(300);
    const lines = await page.evaluate(() => [...document.querySelectorAll('#report .line-row')].map(r => ({ cls: r.className, tag: r.querySelector('.lr-tag').textContent, tip: (r.querySelector('.lr-tip') || {}).textContent || '', how: !!r.querySelector('[data-act="how"]') })));
    await page.evaluate(async () => { await ensureAudio(); window.pn = []; const p0 = playedNote; window.playedNote = (m, d, w) => { pn.push(m); return p0(m, d, w); }; });
    await page.click('#report .line-row[data-line="2"] [data-act="how"]');
    const played = await page.evaluate(() => ({ pn, want: G.seq.slice(12, 19).map(n => n.m), demo: !!lineDemo }));
    expect(/lr-good/.test(lines[0].cls) && /lr-good/.test(lines[3].cls) && /lr-work|lr-fair/.test(lines[2].cls) && /flat/.test(lines[2].tip) && lines[2].how && !lines[0].how
      && played.pn.join() === played.want.join() && played.demo, JSON.stringify({ lines, played }));
  });

  await test('Learn from the pros: a recording becomes note bars and a voice line; tuning, a flat note, vibrato, a slide and the beat are found; pro benchmark sets scoring', async page => {
    await setLevel(page, 10);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(() => openLab('pro'));
    const intro = await page.evaluate(() => ({ shown: !$('#proBox').hidden, file: !!$('#proFile'), lib: [...document.querySelectorAll('#proLib .lib-song')].map(b => b.textContent) }));
    await page.evaluate(async () => { await proLoad(await makeProSong(), 'Test singer', 'file'); });
    const an = await page.evaluate(() => { const a = PRO.an; return { notes: a.notes.map(n => n.midi).join(), flat: a.notes[6].c, tune: a.tune, bpm: a.beat.bpm, feel: a.beat.feel, vib: a.notes.filter(n => n.vib).length, slide: a.notes[10].on - a.notes[10].c, sum: a.sum,
      stats: [...document.querySelectorAll('.pro-stat')].map(c => c.dataset.stat).join() }; });
    // tap the flat note's bar
    const box = await page.evaluate(() => { const cv = $('#proRoll'); cv.scrollIntoView({ block: 'center' }); const r = cv.getBoundingClientRect(), g = proGeom(cv), n = PRO.an.notes[6]; PRO.view = n.t0 - 1; proDraw();
      return { x: r.left + 46 + (n.t0 + 0.2 - PRO.view) * 90, y: r.top + g.top + (g.hi - n.midi) * g.row + g.row / 2 }; });
    await page.mouse.click(box.x, box.y);
    const info = await page.evaluate(() => ({ sel: PRO.sel, text: $('#proInfo').textContent }));
    await page.click('#proPlay'); await page.waitForTimeout(700);
    const play = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, label: $('#proPlay').textContent }));
    await page.click('#proPlay');
    const before = await page.evaluate(() => pitchAcc(22));
    await page.click('[data-act="saveref"]');
    // a looser pro (a soul singer who bends a lot) saved earlier; the median sets the tolerance
    await page.evaluate(() => { store.proRefs.unshift({ name: 'Bendy pro', at: 1, acc20: 60, avg: 30, bias: 0 }); proRefsCard($('#proBox')); });
    await page.click('#proTolOn');
    const cal = await page.evaluate(() => ({ refs: store.proRefs.length, tol: store.settings.proTol, acc: pitchAcc(22) }));
    await page.evaluate(async () => { await proLoad(await makeProSong(), 'My take: test', 'mine'); });
    const cmp = await page.evaluate(() => $('.pro-compare').textContent);
    // the hard case: a quick grace note the first pass skips, and an in-key note sung 60 cents flat
    const hard = await page.evaluate(async () => { await proLoad(await makeProSong({ hard: true }), 'Hard', 'file'); const a = PRO.an;
      const g = a.notes.find(n => n.fill), e = a.notes.find(n => n.snap);
      return { pass2: a.pass2, grace: g && { midi: g.midi, len: +(g.t1 - g.t0).toFixed(2) }, flatE: e && { midi: e.midi, c: e.c }, how: $('.pro-passes').textContent, centredF: a.notes.filter(n => n.midi === 65 && !n.snap).length }; });
    // the tune three times: pass 1 learns it from the repeats; pass 2 catches the miss (G sung 70 cents flat) and marks the
    // deliberate change (B where the other times had D) without counting it wrong
    const rep3 = await page.evaluate(async () => { await proLoad(await makeProSong({ repeat: true }), 'Repeat', 'file'); const a = PRO.an;
      return { phrases: a.passes.learn.phrases, grid: a.passes.learn.grid, voted: a.notes.filter(n => n.voted).map(n => [n.midi, n.c]), differs: a.notes.filter(n => n.differs != null).map(n => [n.midi, n.differs]), steps: [...document.querySelectorAll('.pp-step')].map(d => d.dataset.pass).join() }; });
    // a singer 15 cents flat of the band: pass 3 tunes to the bass and shows it
    const band = await page.evaluate(async () => { await proLoad(await makeProSong({ bass: true, voiceBias: -15 }), 'Flat of the band', 'file'); const a = PRO.an; return { src: a.passes.fine.tuneSrc, bandTune: a.passes.fine.bandTune, bias: a.sum.bias, card: $('.pro-stat[data-stat="tune"]').textContent }; });
    // with a bass guitar under the voice (and a bass-only intro): bass notes are set aside, the voice is still measured
    const bass = await page.evaluate(async () => { await proLoad(await makeProSong({ bass: true }), 'With bass', 'file'); const a = PRO.an, voice = [60, 62, 64, 65, 67, 69];
      PRO.view = 3; rollDraw(PRO); const g = rollGeom(PRO);
      return { inst: a.inst.length, instLow: a.inst.every(n => n.midi < 50), voiceNotes: a.notes.filter(n => voice.includes(n.midi)).length, other: a.notes.filter(n => !voice.includes(n.midi)).length, row: g.row, legend: /instrument/.test($('.pro-legend').textContent) }; });
    await page.evaluate(() => { store.settings.proTol = null; });
    expect(intro.shown && !intro.file && intro.lib.length === 4 && /Crazy Glue.*Notes and words/.test(intro.lib[0]) && /words coming/.test(intro.lib[3]) && an.notes === '60,62,64,65,67,69,67,65,64,62,60,64,67' && an.flat <= -33 && an.flat >= -46 && an.tune >= 5 && an.tune <= 14 && Math.abs(an.bpm - 100) <= 2 && Math.abs(an.feel) <= 45
      && an.vib === 3 && an.slide <= -40 && an.sum.acc20 >= 85 && an.stats === 'true,lean,vib,steady,starts,beat,key,tune'
      && info.sel === 6 && /G4 .* flat/.test(info.text) && play.playing && play.off > 0.3 && /Pause/.test(play.label)
      && before < 1 && cal.refs === 2 && cal.tol === 30 && cal.acc === 1 && /Your pros/.test(cmp)
      && hard.pass2.filled >= 1 && hard.grace && hard.grace.midi === 67 && hard.grace.len < 0.12 && hard.flatE && hard.flatE.midi === 64 && hard.flatE.c <= -50 && hard.flatE.c >= -70 && hard.centredF >= 2 && /Found 1 short or half-hidden note\./.test(hard.how) && /1 note missed the learned tune/.test(hard.how)
      && rep3.phrases >= 10 && rep3.grid && rep3.voted.length === 1 && rep3.voted[0][0] === 67 && rep3.voted[0][1] <= -55 && rep3.differs.length === 1 && rep3.differs[0].join() === '59,62' && rep3.steps === '1,2,3'
      && band.src === 'band' && Math.abs(band.bandTune - 10) <= 4 && band.bias <= -10 && band.bias >= -20 && /against the band/.test(band.card)
      && bass.inst >= 3 && bass.instLow && bass.voiceNotes >= 11 && bass.other === 0 && bass.row >= 14 && bass.legend, JSON.stringify({ intro, an, info, play, before, cal, cmp, hard, rep3, band, bass }));
  });

  await test('Song details: the key and tempo you give are used instead of guesses; pasted words are split into lines and put on the bars', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.profile = { low: 52, high: 70, natural: 60, type: 'Tenor', zlo: 55, zhi: 67 }; openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Crazy Glue test', 'file', await makeProSong({ repeat: true, noVoice: true })); });
    const before = await page.evaluate(() => PRO.an.key);
    await page.click('[data-card="info"] summary');
    await page.selectOption('#piKey', 'C major'); await page.fill('#piBpm', '100');
    await page.fill('#piWords', "There’s no gravity that sucked me in your orbit There’s no magnet that was in your heart The one restriction was the friction that was keeping us A little too far apart\n(whistling interlude)");
    await page.click('[data-card="info"] [data-act="apply"]');
    await page.waitForFunction(() => PRO.an && PRO.an.passes && $('[data-card="studio"]'), null, { timeout: 20000 }); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ key: PRO.an.key, bpm: PRO.an.beat.bpm, given: PRO.an.passes.learn.given, saved: store.proInfo['Crazy Glue test'], w0: store.proWords['pro:Crazy Glue test'][0], w1: store.proWords['pro:Crazy Glue test'][1],
      lyr: PRO.an.notes.slice(0, 3).map(n => n.word).join(' '), pass1: $('.pp-step[data-pass="1"]').textContent, open: $('[data-card="info"] summary').textContent }));
    expect(before !== 'C major' && after.key === 'C major' && Math.abs(after.bpm - 100) <= 1 && after.given && after.saved.key === 'C major' && after.saved.bpm === 100
      && after.w0.replace(/-/g, '') === 'There’s no gravity that sucked me in your orbit' && after.w1.startsWith('There’s no mag-net') && after.lyr === 'There’s no gra-' && /Using your song details/.test(after.pass1) && /✓/.test(after.open), JSON.stringify({ before, after }));
  });

  await test('His voice alone: adding the instrumental lines it up, takes the band out, and the notes come from his voice; practice offers his voice alone and singing with just the band', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      store.profile = { low: 40, high: 60, natural: 50, type: 'Baritone', zlo: 43, zhi: 57 }; openLab('pro');
      await proLoad(await makeProSong({ bass: true }), 'With band', 'file'); const before = { notes: PRO.an.notes.length, inst: PRO.an.inst.length };
      await proLoad(await makeProSong({ bass: true }), 'With band', 'file', await makeProSong({ bass: true, noVoice: true, pad: 0.37, level: 0.85 }));
      await new Promise(r => setTimeout(r, 100));
      const a = PRO.an;
      return { before, lag: PRO.iso.lag, gain: PRO.iso.gain, removed: PRO.iso.removedDb, notes: a.notes.map(n => n.midi).filter(m => m >= 60).join(), flat: (a.notes.find(n => n.c < -25) || {}).c, inst: a.inst.length,
        card: $('[data-card="inst"]').textContent, pass1: $('.pp-step[data-pass="1"]').textContent, alone: !!$('#stAlone'), band: !!$('#stBand') };
    });
    expect(Math.abs(r.lag + 0.37) < 0.002 && Math.abs(r.gain - 1.18) < 0.05 && r.removed >= 15 && r.inst === 0 && r.before.inst >= 3 && r.notes === '60,62,64,65,67,69,67,65,64,62,60,64,67' && r.flat <= -35 && r.flat >= -45
      && /separated from the band \((almost all|most) of the band taken out\)/.test(r.card) && /his voice alone/.test(r.pass1) && r.alone && r.band, JSON.stringify(r));
  });

  await test('Find your singing home: talk, then a ladder of notes up and down from the talking voice; the comfortable zone and sweet spot sit several notes above it and set the key for songs', async page => {
    await voice(page); await setLevel(page, 1);
    // a singer who talks around C3 (48) and sings comfortably from G#2 to D4 (44 to 62)
    await page.evaluate(() => { setInterval(() => {
      if (WO.phase === 'talk') { V.on = true; V.m = 48 + Math.sin(performance.now() / 200) * 1.5; return; }
      if (WO.phase !== 'turn' || !WO.cap || !WO.cap.notes) { V.on = false; return; } const t = ac.currentTime - WO.start, n = WO.cap.notes.find(x => t >= x.a && t <= x.b - 0.03);
      V.on = !!n && n.midi >= 44 && n.midi <= 62; if (n) V.m = n.midi; }, 15); });
    await page.evaluate(() => openLab('home'));
    await page.click('#woBox [data-act="home-go"]');
    await page.waitForFunction(() => store.home && $('#woRes .home-ladder'), null, { timeout: 120000 });
    const r = await page.evaluate(() => ({ home: store.home, p: { zlo: store.profile.zlo, zhi: store.profile.zhi, natural: store.profile.natural }, head: $('#woRes .cheer-big').textContent, rows: document.querySelectorAll('#woRes .hl-row').length, sweetRow: $('#woRes .hl-row.sweet .hl-note').textContent, speakRow: !!$('#woRes .hl-row.speak'), mark: WO.R.an.marks.length }));
    expect(Math.abs(r.home.speak - 48) <= 1 && r.home.zlo <= 45 && r.home.zhi >= 61 && r.home.zhi <= 62 && r.home.sweet - r.home.speak >= 3 && r.home.sweet - r.home.speak <= 8
      && r.p.zlo === r.home.zlo && r.p.zhi === r.home.zhi && r.p.natural === r.home.sweet && /notes above your talking voice/.test(r.head) && r.rows >= 10 && r.speakRow && r.mark === 1, JSON.stringify(r));
  });

  await test('Singer’s daily workout: breath and body, muscles, ear, your voice’s home, each scored; summary against last time and the area with most room to grow; progress per area', async page => {
    await voice(page); await setLevel(page, 1);
    await page.evaluate(() => { store.home = { speak: 48, zlo: 45, zhi: 61, sweet: 53, at: 1 }; store.profile = { low: 43, high: 63, natural: 53, type: 'Baritone', zlo: 45, zhi: 61, speak: 48 }; store.workouts = [{ at: 1, areas: { breath: 40, muscle: 60, ear: 50, home: 70 } }]; save(); WO.fast = true;
      // follows each exercise; holds the hum for about 8 seconds; the ear patterns are sung a little flat on the last note
      setInterval(() => { if (WO.phase !== 'turn' || !WO.cap || !WO.cap.notes) { V.on = false; return; } const t = ac.currentTime - WO.start, ns = WO.cap.notes, n = ns.find(x => t >= x.a && t <= x.b - 0.03);
        V.on = !!n && !(ns.length === 1 && t > 8); if (n) V.m = n.midi; }, 15); });
    await page.evaluate(() => openLab('workout'));
    const intro = await page.evaluate(() => ({ prog: document.querySelectorAll('#woBox .wo-area').length, tip: !!$('#woBox .wo-tip') }));
    await page.click('#woBox [data-act="wo-go"]');
    const seen = new Set(); const t0 = Date.now();
    while (Date.now() - t0 < 150000) { const st = await page.evaluate(() => ({ now: ($('#woBox .wo-step.now') || {}).dataset?.area, done: !!$('#woBox .wo-sum') })); if (st.now) seen.add(st.now); if (st.done) break; await page.waitForTimeout(400); }
    const r = await page.evaluate(() => ({ w: store.workouts[store.workouts.length - 1], n: store.workouts.length, sum: [...document.querySelectorAll('#woBox .wo-sc')].map(c => c.textContent), focus: ($('#woBox .wo-focus') || {}).textContent, prog: document.querySelectorAll('#woBox .wo-area').length }));
    const a = r.w.areas;
    expect(intro.prog === 4 && !intro.tip && [...seen].join() === 'breath,muscle,ear,home' && r.n === 2 && a.breath >= 50 && a.muscle >= 80 && a.ear >= 80 && a.home >= 80
      && r.sum.length === 4 && /since last time/.test(r.sum.join(' ')) && /Most room to grow/.test(r.focus) && r.prog === 4, JSON.stringify({ seen: [...seen], r }));
  });

  await test('A song we know (Crazy Glue, CC BY): its key, tempo, swing and words fill in automatically, with credit to the artist', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    const r = await page.evaluate(async () => { openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Crazy Glue - Josh Woodward', 'file'); await new Promise(r => setTimeout(r, 150));
      const mix = { words: PRO.an.notes.filter(n => n.word).length, msg: $('#proLyric .kr-now').textContent, strong: !!$('.pro-inst-strong') };
      await proLoad(await makeProSong({ repeat: true }), 'Crazy Glue - Josh Woodward', 'file', await makeProSong({ repeat: true, noVoice: true })); await new Promise(r => setTimeout(r, 150));
      return { mix, info: store.proInfo['Crazy Glue - Josh Woodward'], key: PRO.an.key, w0: store.proWords['pro:Crazy Glue - Josh Woodward'][0], credit: ($('[data-card="studio"] .st-credit') || {}).textContent, staff: PRO.an.notes.slice(0, 2).map(n => n.word).join(' ') }; });
    expect(r.mix.words === 0 && /No words here/.test(r.mix.msg) && !r.mix.strong && r.info.key === 'E♭ major' && r.info.bpm === 134 && r.info.swing && r.key === 'E♭ major' && /^There’s no gra-?vi-?ty/.test(r.w0) && /Josh Woodward, CC BY/.test(r.credit) && r.staff === 'There’s no', JSON.stringify({ key: r.key, w0: r.w0, credit: r.credit, staff: r.staff }));
  });

  await test('Main graph: words on the bars and the lyric line while it plays (even if details were saved before without words); a touch that turns into a page scroll never stops it following; Sing along next to Play', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    const name = 'Crazy Glue - Josh Woodward';
    await page.evaluate(async name => { store.proInfo = { [name]: { key: 'C major', bpm: null, swing: false, lyrics: null } }; store.proWords = { ['pro:' + name]: {} }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), name, 'file', await makeProSong({ repeat: true, noVoice: true })); }, name);
    await page.waitForTimeout(150);
    const before = await page.evaluate(name => ({ lyrics: !!store.proInfo[name].lyrics, keptKey: store.proInfo[name].key, words: PRO.an.notes.filter(n => n.word).length, n: PRO.an.notes.length, sing: !!$('[data-act="singalong"]'), lyric: !!$('#proLyric') }), name);
    // a finger lands on the graph and the page scrolls: the browser cancels the pointer (no pointerup)
    await page.evaluate(() => { const cv = $('#proRoll'); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 100, pointerId: 7, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true })); });
    await page.click('#proPlay'); await page.waitForTimeout(2500);
    const mid = await page.evaluate(() => ({ span: rollSpan(PRO), off: PRO.off, view: PRO.view, drag: PRO.drag, now: $('#proLyric .kr-now').textContent, lit: !!$('#proLyric .kr-on') }));
    // and the stuck case without a cancel at all: it lets go by itself
    await page.evaluate(() => { const cv = $('#proRoll'); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 100, pointerId: 8, bubbles: true })); });
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => ({ off: PRO.off, view: PRO.view, drag: !!PRO.drag }));
    await page.click('#proPlay');
    const atSing = await page.evaluate(() => PRO.off);
    await page.click('[data-act="singalong"]'); await page.waitForTimeout(300);
    const sing = await page.evaluate(() => ({ on: ST.busy, words: ST.show.notes.filter(n => n.word).length, whole: ST.whole, range: stRange(), dur: PRO.an.dur }));
    // it keeps going past the end of the line it started on, to the end of the song
    const L = await page.evaluate(() => stLines().map(l => [l.t0, l.t1])), k0 = Math.max(0, L.findIndex(l => l[1] >= atSing));
    await page.waitForFunction(t => PRO.off > t, L[Math.min(L.length - 1, k0 + 1)][1] + 0.3, { timeout: 60000 }); sing.past = await page.evaluate(() => ({ off: PRO.off, busy: ST.busy }));
    await page.evaluate(() => stHalt());
    expect(before.lyrics && before.keptKey === 'C major' && before.words >= before.n * 0.6 && before.sing && before.lyric && mid.off > 1.5 && Math.abs(mid.view - Math.max(0, mid.off - mid.span * 0.3)) < 0.2 && mid.drag === null && /There’s|gra/.test(mid.now) && mid.lit
      && later.off > mid.off + 1 && !later.drag && later.view > mid.view && sing.on && sing.words >= 20 && sing.whole && Math.abs(sing.range[1] - sing.dur) < 0.01 && sing.past.busy, JSON.stringify({ before, mid, later, sing }));
  });

  await test('Controls at the top, pause and skip: one bar that stays at the top with the words; while singing along, Sing along becomes Pause, then Resume carries on from that exact spot; ⏮ Line goes to the start of the line (or the one before), ↺ 10 s goes back 10 seconds, and the music and words go with it, in Play and in Sing along', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Skip test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Skip test', 'file', await makeProSong({ repeat: true, noVoice: true })); });
    const st = () => page.evaluate(() => { const L = stLines(), t = PRO.off, k = L.findIndex(l => t >= l.t0 - 0.05 && t <= l.t1); return { off: +t.toFixed(2), busy: ST.busy, playing: PRO.playing, btn: $('[data-act="singalong"]').textContent, line: k, lyric: $('#proLyric .kr-now').textContent.trim().slice(0, 14), L: L.map(l => [+l.t0.toFixed(2), +l.t1.toFixed(2)]) }; });
    await page.click('[data-act="singalong"]'); await page.waitForTimeout(12000);
    const a = await st();
    await page.click('[data-act="singalong"]'); await page.waitForTimeout(1500);   // pause
    const p = await st();
    await page.click('[data-act="singalong"]'); await page.waitForTimeout(700);     // resume
    const r = await st();
    await page.click('[data-act="back-10"]'); await page.waitForTimeout(500);
    const b10 = await st();
    await page.waitForTimeout(1500); await page.click('[data-act="back-line"]'); await page.waitForTimeout(400);
    const bl = await st(); await page.evaluate(() => stHalt()); await page.waitForTimeout(300);
    // the same skips while just playing
    await page.evaluate(() => { PRO.off = 20; }); await page.click('#proPlay'); await page.waitForTimeout(1000);
    const p0 = await st(); await page.click('[data-act="back-10"]'); await page.waitForTimeout(400); const p1 = await st();
    await page.click('[data-act="fwd-10"]'); await page.waitForTimeout(400); const p2 = await st();
    await page.click('[data-act="fwd-line"]'); await page.waitForTimeout(300); const p3 = await st(); await page.click('#proPlay');
    const bar = await page.evaluate(() => ({ sticky: getComputedStyle($('.pro-bar')).position, words: !!$('.pro-bar #proLyric'), btns: [...document.querySelectorAll('.pro-bar button')].map(b => b.dataset.act || b.id).join() }));
    const lineOf = (s, t) => s.L.findIndex(l => t >= l[0] - 0.05 && t <= l[1]);
    expect(a.busy && /Pause/.test(a.btn) && a.off > 10 && !p.busy && /Resume/.test(p.btn) && Math.abs(p.off - a.off) < 1.6
      && r.busy && /Pause/.test(r.btn) && r.off >= p.off - 0.1 && r.off < p.off + 1.2
      && b10.busy && b10.off < r.off - 8.5 && b10.off > r.off - 11
      && bl.busy && bl.off < b10.off + 2.2 - 0.5 && bl.L.some(l => Math.abs(l[0] - 1 - bl.off) < 0.6 || bl.off < 0.6)
      && p0.playing && p1.playing && p1.off < p0.off - 8.5 && p1.off > p0.off - 11 && p2.playing && p2.off > p1.off + 9 && p2.off < p1.off + 11.5 && p3.playing && p3.L.some(l => Math.abs(l[0] - 1 - p3.off) < 0.3) && p3.off > p2.off && bar.sticky === 'sticky' && bar.words && /proPlay/.test(bar.btns) && /singalong/.test(bar.btns) && /back-line.*back-10.*fwd-10.*fwd-line.*coach/.test(bar.btns)
      && (lineOf(bl, bl.off + 1.2) < 0 || bl.lyric.length > 0), JSON.stringify({ a, p, r, b10, bl, p0, p1, p2, p3, bar }));
  });

  await test('Leaving and coming back: the screen is kept on while a song plays (Play or Sing along); switching away stops the song cleanly and remembers the spot; Play (and Sing along) carries on from there even after the device paused the sound', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => {
      window.wakeCalls = 0; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { wakeCalls++; const l = new EventTarget(); l.release = async () => {}; return l; } } });
      window.vis = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
      store.proInfo = { 'Away test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Away test', 'file', await makeProSong({ repeat: true, noVoice: true })); });
    const away = async () => page.evaluate(async () => { vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); await ac.suspend(); });
    const back = async () => page.evaluate(() => { vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await page.click('#proPlay'); await page.waitForTimeout(3000);
    const playing = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, wake: wakeCalls, lock: !!WAKE.lock }));
    await away(); await page.waitForTimeout(1500);
    const gone = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, state: ac.state, btn: $('#proPlay').textContent }));
    await back(); await page.waitForTimeout(200);
    const toastTxt = await page.evaluate(() => $('#toast').textContent);
    await page.click('#proPlay'); await page.waitForTimeout(1500);
    const again = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, state: ac.state }));
    await page.click('#proPlay');
    // the same in sing along
    await page.click('[data-act="singalong"]'); await page.waitForTimeout(4000);
    const s1 = await page.evaluate(() => ({ busy: ST.busy, off: PRO.off }));
    await away(); await page.waitForTimeout(1200);
    const s2 = await page.evaluate(() => ({ busy: ST.busy, off: PRO.off }));
    await back(); await page.click('[data-act="singalong"]'); await page.waitForTimeout(2500);
    const s3 = await page.evaluate(() => ({ busy: ST.busy, off: PRO.off, state: ac.state })); await page.evaluate(() => stHalt());
    expect(playing.playing && playing.wake >= 1 && playing.lock && !gone.playing && Math.abs(gone.off - playing.off) < 0.6 && /Play/.test(gone.btn) && /Paused at/.test(toastTxt)
      && again.playing && again.state === 'running' && again.off > gone.off + 0.8
      && s1.busy && !s2.busy && Math.abs(s2.off - s1.off) < 0.6 && s3.busy && s3.state === 'running' && s3.off > s2.off - 3 && s3.off < s2.off + 4, JSON.stringify({ playing, gone, toastTxt, again, s1, s2, s3 }));
  });

  await test('How you did: after singing along with the whole song, a focused review in the main view: score, how close you stayed to his notes, the habit that costs most (here: flat), the lines most worth practising with a tip and Coach this line, your best line, and Play my take with the playhead', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Review test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Review test', 'file', await makeProSong({ repeat: true, noVoice: true }));
      // the singer: line 1 right, lines 2 and 3 a little flat (one note badly), line 4 silent
      setInterval(() => { if (!ST.busy) { V.on = false; return; } const t = PRO.off, L = stLines(), k = L.findIndex(l => t >= l.t0 && t <= l.t1), n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04);
        V.on = !!n && k !== 3 && k >= 0; if (n) V.m = n.midi + (k === 1 || k === 2 ? (n === PRO.an.notes[L[k].idx[2]] ? -1 : -0.3) : 0); }, 15); });
    await page.click('[data-act="singalong"]');
    await page.waitForFunction(() => !ST.busy && !$('#proReview').hidden, null, { timeout: 90000 }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const b = $('#proReview'); return { text: b.textContent, score: +b.querySelector('.ls-big').textContent, work: [...b.querySelectorAll('.review-line')].map(x => +x.dataset.line), tips: [...b.querySelectorAll('.rv-tip')].map(x => x.textContent),
      coach: b.querySelectorAll('[data-act="coach-line"]').length, take: !$('[data-act="play-take"]').disabled, underBar: $('.pro-bar').nextElementSibling === b }; });
    await page.click('[data-act="play-take"]'); await page.waitForTimeout(300); const p0 = await page.evaluate(() => PRO.off); await page.waitForTimeout(1500); const p1 = await page.evaluate(() => ({ off: PRO.off, btn: $('[data-act="play-take"]').textContent }));
    await page.click('[data-act="play-take"]');
    await page.click('#proReview [data-act="coach-line"]'); await page.waitForTimeout(200);
    const co = await page.evaluate(() => ({ coaching: $('#proBar').classList.contains('coaching'), k: ST.k, hidden: $('#proReview').hidden }));
    expect(r.underBar && r.score > 0 && /How you did/.test(r.text) && /Close to his notes: \d+% right on/.test(r.text) && /flat/.test(r.text) && /3 of 4 lines/.test(r.text)
      && r.work.length >= 1 && r.work.every(k => k === 1 || k === 2) && r.tips.every(x => x.length > 10) && r.coach === r.work.length && /best line/.test(r.text) && r.take
      && p1.off > p0 + 1 && /Stop/.test(p1.btn) && co.coaching && co.k === r.work[0] && co.hidden, JSON.stringify({ r, p0, p1, co }));
  });

  await test('Speed: slower or faster in set steps only, with Normal one tap away; the slowed song keeps its notes (same pitch), the playhead and words move at that speed, and singing alone is expected at the same pace', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Speed test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Speed test', 'file', await makeProSong({ repeat: true, noVoice: true }));
      window.sing = 'off'; setInterval(() => {
        if (LS.phase === 'turn' && LS.cap && LS.cap.line) { const l = LS.cap.line, t = l.t0 + (ac.currentTime - LS.cap.start) * (LS.cap.rate || 1), n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n && sing !== 'off'; if (n) V.m = n.midi; return; }
        V.on = false; }, 15); });
    const before = await page.evaluate(() => ({ normalHidden: $('#speedNormal').hidden, val: $('#speedVal').textContent, steps: +$('#speedSlider').max + 1, step: $('#speedSlider').step, mid: $('#speedSlider').value === String(+$('#speedSlider').max / 2) }));
    await page.evaluate(() => { const s = $('#speedSlider'); s.value = '3'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => PRO.speed === 0.8 && !PRO.slowing && $('#speedVal').textContent.includes('80%'), null, { timeout: 30000 });
    const set = await page.evaluate(() => ({ speed: PRO.speed, val: $('#speedVal').textContent, normal: !$('#speedNormal').hidden }));
    // the same note, measured in the original and in the slowed copy: same pitch
    const pitch = await page.evaluate(() => { const n = PRO.an.notes.find(x => x.t1 - x.t0 > 0.5) || PRO.an.notes[3], tm = (n.t0 + n.t1) / 2, sl = speedGet(PRO.buf, 0.8);
      const f0 = (b, t) => { const x = b.getChannelData(0), i0 = Math.floor(t * b.sampleRate), N = 4096, r = L => { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < N; i += 2) { s += x[i0 + i] * x[i0 + i + L]; e1 += x[i0 + i] ** 2; e2 += x[i0 + i + L] ** 2; } return s / Math.sqrt(e1 * e2 + 1e-12); }; let dip = false; for (let L = 30; L < 1200; L++) { const v = r(L); if (v < 0.3) dip = true; if (dip && v > 0.85 && v >= r(L + 1)) return b.sampleRate / L; } return 0; };
      const a = f0(PRO.buf, tm), b = f0(sl, tm / 0.8); return { a: Math.round(a), b: Math.round(b), cents: Math.round(1200 * Math.log2(b / a)), lenRatio: +(sl.duration / PRO.buf.duration).toFixed(3) }; });
    await page.evaluate(() => { PRO.off = 2; }); await page.click('#proPlay'); await page.waitForTimeout(500); const p0 = await page.evaluate(() => PRO.off); await page.waitForTimeout(3000); const p1 = await page.evaluate(() => PRO.off); await page.click('#proPlay');
    // sing alone at 80%: you sing at that pace, and it's scored as right
    await page.click('[data-act="coach"]'); await page.evaluate(() => { sing = 'right'; }); await page.click('[data-act="coach-own"]');
    await page.waitForFunction(() => !ST.busy && $('#proBar #stRes .ls-big'), null, { timeout: 60000 });
    const own = await page.evaluate(() => +$('#stRes .ls-big').textContent); await page.click('[data-act="coach-done"]');
    await page.click('#speedNormal'); await page.waitForTimeout(200);
    const back = await page.evaluate(() => ({ speed: PRO.speed, val: $('#speedVal').textContent, normalHidden: $('#speedNormal').hidden, slider: $('#speedSlider').value }));
    expect(before.normalHidden && /Normal/.test(before.val) && before.steps === 11 && before.step === '1' && before.mid && set.speed === 0.8 && /80%/.test(set.val) && set.normal
      && Math.abs(pitch.cents) <= 30 && Math.abs(pitch.lenRatio - 1.25) < 0.02 && Math.abs((p1 - p0) / 3 - 0.8) < 0.08 && own >= 60
      && back.speed === 1 && /Normal/.test(back.val) && back.normalHidden && back.slider === '5', JSON.stringify({ before, set, pitch, rate: (p1 - p0) / 3, own, back }));
  });

  await test('Coach mode, one line at a time in the main view: Coach turns the bar into the coach (line, Hear him, Sing with him, On my own, Done); the score and one tip show under the words; Again, then Next line when it goes well; Done brings everything back', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Coach test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Coach test', 'file', await makeProSong({ repeat: true, noVoice: true }));
      window.sing = 'off'; setInterval(() => {
        if (LS.phase === 'turn' && LS.cap && LS.cap.line) { const l = LS.cap.line, t = l.t0 + ac.currentTime - LS.cap.start, n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n && sing !== 'off'; if (n) V.m = n.midi + (sing === 'wrong' ? 3 : 0); return; }
        if (ST.busy && sing !== 'off') { const t = PRO.off, n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n; if (n) V.m = n.midi + (sing === 'wrong' ? 3 : 0); return; }
        V.on = false; }, 15); });
    await page.click('[data-act="coach"]'); await page.waitForTimeout(200);
    const on = await page.evaluate(() => ({ coaching: $('#proBar').classList.contains('coaching'), lbl: $('#coachLbl').textContent, studioHidden: document.querySelector('[data-card="studio"]').hidden, inBar: !!$('#proBar #stRes') && !!$('#proBar #stLive'),
      visible: [...document.querySelectorAll('#proBar button')].filter(b => b.offsetParent).map(b => b.dataset.act || b.id).join() }));
    await page.click('[data-act="coach-hear"]'); await page.waitForFunction(() => !ST.busy, null, { timeout: 30000 });
    await page.evaluate(() => { sing = 'wrong'; }); await page.click('[data-act="coach-with"]');
    await page.waitForFunction(() => !ST.busy && $('#proBar #stRes .ls-big'), null, { timeout: 30000 });
    const bad = await page.evaluate(() => ({ score: +$('#stRes .ls-big').textContent, tip: $('#stRes .ls-tip').textContent, again: !!$('#proBar [data-act="again"]'), next: !!$('#proBar [data-act="nextline"]') }));
    await page.evaluate(() => { sing = 'right'; }); await page.click('#proBar [data-act="again"]');
    await page.waitForFunction(() => !ST.busy && $('#proBar [data-act="nextline"]'), null, { timeout: 30000 });
    const good = await page.evaluate(() => ({ score: +$('#stRes .ls-big').textContent }));
    await page.click('#proBar [data-act="nextline"]'); await page.waitForTimeout(200);
    const next = await page.evaluate(() => ({ lbl: $('#coachLbl').textContent, k: ST.k, cleared: !$('#stRes .ls-big'), lyric: $('#proLyric .kr-now').textContent }));
    await page.click('[data-act="coach-own"]'); await page.waitForFunction(() => !ST.busy && $('#proBar #stRes .ls-big'), null, { timeout: 40000 });
    const own = await page.evaluate(() => ({ score: +$('#stRes .ls-big').textContent, text: $('#stRes').textContent.slice(0, 200), k: ST.k }));
    await page.click('[data-act="coach-done"]'); await page.waitForTimeout(200);
    const off = await page.evaluate(() => ({ coaching: $('#proBar').classList.contains('coaching'), studio: !document.querySelector('[data-card="studio"]').hidden, back: !!document.querySelector('[data-card="studio"] #stRes'), play: !!$('#proPlay').offsetParent }));
    expect(on.coaching && /Line 1 of 4/.test(on.lbl) && on.studioHidden && on.inBar && /coach-hear/.test(on.visible) && /coach-with/.test(on.visible) && /coach-own/.test(on.visible) && !/proPlay/.test(on.visible)
      && bad.score < 60 && bad.tip.length > 10 && bad.again && !bad.next && good.score >= 70 && /Line 2 of 4/.test(next.lbl) && next.k === 1 && next.cleared && /Hap/.test(next.lyric) && own.score > 0 && own.k === 1 && /↻ Again/.test(own.text)
      && !off.coaching && off.studio && off.back && off.play, JSON.stringify({ on, bad, good, next, own, off }));
  });

  await test('Sing along without headphones, and coach mode: the song leaking from the speaker into the mic draws nothing while you are silent; your own voice still counts; Sing along plays to the end', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Leak test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Leak test', 'file', await makeProSong({ repeat: true, noVoice: true }));
      // the iPad speaker: whatever plays also reaches the mic, a bit quieter
      const orig = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.duration > 10) { const g = ac.createGain(); g.gain.value = 0.15; this.connect(g); g.connect(analyser); } return orig.apply(this, a); };
      window.sing = 'off'; setInterval(() => { if (!ST.busy || sing === 'off') { V.on = false; return; } const t = PRO.off, n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n; if (n) V.m = n.midi + (sing === 'wrong' ? 3 : 0); }, 15); });
    await page.waitForTimeout(150);
    const count = () => page.evaluate(() => ST.user.filter(v => v != null).length);
    // silent, the song through the speaker: the whole song plays and nothing of 'yours' is drawn
    await page.click('[data-act="singalong"]');
    await page.waitForFunction(() => !ST.busy, null, { timeout: 90000 });
    const silent = await page.evaluate(() => ({ drawn: ST.user.filter(v => v != null).length, end: PRO.off, dur: PRO.an.dur, leak: ST.leak, warned: ST.leakWarned }));
    // singing along, same speaker: your voice is drawn
    await page.evaluate(() => { sing = 'right'; PRO.off = 0; }); await page.click('[data-act="singalong"]'); await page.waitForTimeout(9000);
    const singing = { drawn: await count() }; await page.evaluate(() => stHalt());
    expect(silent.drawn === 0 && silent.end > silent.dur - 1 && silent.leak > 0 && silent.warned && singing.drawn > 100
, JSON.stringify({ silent, singing }));
  });

  await test('Practise this song: one area on the main graph; Listen plays his line with the words, My turn has you sing it back while the music waits, bars turn green/red per word, a tip and help (lock in the note) when a line keeps going wrong, ✓ when learned; Sing along scores as the music plays', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { store.proInfo = { 'Studio test': { lyrics: 'one two three four five six se-ven eight nine ten and\nHap-py birth-day to you and to you my dear old friend\nthird line words here and there and more\nlast line of the song for now we go home' } }; save();
      openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Studio test', 'file', await makeProSong({ repeat: true, noVoice: true }));
      // the singer: in "my turn" follows the line (note 3 flat until it's fixed); in "hold" sings the note; in "sing along" follows the song
      window.flat3 = true; setInterval(() => {
        if (LS.phase === 'turn' && LS.cap && LS.cap.hold != null) { V.on = ac.currentTime >= LS.start; V.m = LS.cap.hold; return; }
        if (LS.phase === 'turn' && LS.cap && LS.cap.line) { const l = LS.cap.line, t = l.t0 + ac.currentTime - LS.cap.start, n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n; if (n) V.m = n.midi + (flat3 && n === PRO.an.notes[l.idx[2]] ? -0.5 : 0); return; }
        if (window.along && ST.busy) { const t = PRO.off, n = PRO.an.notes.find(x => t >= x.b0 && t <= x.b1 - 0.04); V.on = !!n; if (n) V.m = n.midi; return; }
        V.on = false; }, 15); });
    await page.waitForTimeout(150);
    const ui = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#proOut [data-card]')].map(c => c.dataset.card).join(), nav: $('#stNav').textContent, lyric: $('#proLyric .kr-now').textContent, btns: [...document.querySelectorAll('.st-btns button')].map(b => b.dataset.act).join() }));
    await page.click('#stNav [data-act="next"]');
    const go1 = await page.evaluate(() => ({ k: ST.k, lyric: $('#proLyric .kr-now').textContent }));
    await page.click('.st-btns [data-act="listen"]'); await page.waitForTimeout(800);
    const listening = await page.evaluate(() => ({ busy: ST.busy, stop: !$('.st-btns [data-act="stop"]').hidden, off: PRO.off, lit: !!$('#proLyric .kr-on') }));
    await page.click('.st-btns [data-act="stop"]');
    const stopped = await page.evaluate(() => ({ busy: ST.busy, pend: LS.pending.length }));
    const turn = async () => { await page.click('.st-btns [data-act="turn"]'); await page.waitForFunction(() => !ST.busy && $('#stRes .ls-big'), null, { timeout: 30000 }); return page.evaluate(() => ({ score: +$('#stRes .ls-big').textContent, tip: $('#stRes .ls-tip').textContent, lock: !!$('#stRes [data-act="lock"]'), bars: stLines()[1].idx.map(i => ST.show.notes[i].hit) })); };
    const t1 = await turn(), t2 = await turn();
    await page.evaluate(() => { flat3 = false; });
    await page.click('#stRes [data-act="lock"]'); await page.waitForFunction(() => !ST.busy && /You found/.test($('#stLive').textContent), null, { timeout: 15000 });
    const t3 = await turn();
    const rec = await page.evaluate(() => ({ r: store.proLearn['pro:Studio test'][1], nav: $('#stNav').textContent, next: !!$('#stRes [data-act="nextline"]') }));
    // sing along on line 3, music playing
    await page.click('#stRes [data-act="nextline"]'); await page.evaluate(() => { window.along = true; });
    await page.click('.st-btns [data-act="along"]'); await page.waitForFunction(() => !ST.busy && $('#stRes .ls-big'), null, { timeout: 30000 });
    const al = await page.evaluate(() => ({ k: ST.k, score: +$('#stRes .ls-big').textContent, green: stLines()[2].idx.filter(i => ST.show.notes[i].hit != null && Math.abs(ST.show.notes[i].hit) <= 25).length, n: stLines()[2].idx.length }));
    expect(/^inst?,?studio|studio/.test(ui.cards) && !/karaoke|learn/.test(ui.cards) && /Line 1 of 4/.test(ui.nav) && /one two/.test(ui.lyric) && ui.btns === 'listen,turn,along,stop'
      && go1.k === 1 && /Hap-py/.test(go1.lyric) && listening.busy && listening.stop && listening.lit && !stopped.busy && stopped.pend === 0
      && /“birth” \(E4\) was \d+¢ flat|was \d+¢ flat/.test(t1.tip) && !t1.lock && t2.lock && t1.bars.filter(h => h != null && Math.abs(h) > 35).length >= 1 && t1.bars.filter(h => h != null && Math.abs(h) <= 25).length >= 9
      && t3.score >= 85 && /learned/.test(t3.tip) && rec.r.ok && /✓ Line 2/.test(rec.nav) && /1 of 4 lines learned/.test(rec.nav) && rec.next
      && al.k === 2 && al.score >= 80 && al.green >= al.n - 1, JSON.stringify({ ui, go1, listening, stopped, t1, t2, t3, rec, al }));
  });

  await test('Lip sync: the words’ syllables are matched to his sung syllables across the song (consonant dips split a held note into syllables, a plucked intro gets none, every line starts where he sings it)', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      const rep = k => ['ka', 'ke', 'ki', 'ko', 'ku', 'la', 'le', 'li', 'lo', 'lu', 'ma', 'me', 'mi', 'mo', 'mu'].map(x => x + k).join(' ');
      store.proInfo = { 'Sync': { lyrics: rep(1) + '\n' + rep(2) + '\n' + rep(3) } }; store.proWords = {};
      openLab('pro'); await proLoad(await makeProSong({ repeat: true, longIntro: true, dips: true }), 'Sync', 'file', await makeProSong({ repeat: true, longIntro: true, dips: true, noVoice: true })); await new Promise(r => setTimeout(r, 100));
      const an = PRO.an, sungStart = 14.6, intro = an.notes.filter(n => n.t0 < 14);
      // the sung notes, in order: their syllables
      const sung = an.notes.filter(n => n.t0 >= 14 && n.word).map(n => n.word);
      lyricShow($('#proLyric'), an, an._al.lyr[1].toks[4].t0 + 0.02); const lit = ($('#proLyric .kr-on') || {}).textContent;
      return { heard: an._al.heard, total: an._al.total, introWords: intro.filter(n => n.word).length, two: sung.filter(w => / /.test(w)).length, first: sung[0], flat: sung.join(' '), lineStarts: an._al.lyr.map(l => +l.t0.toFixed(1)), lit, sungStart: +sungStart.toFixed(1) };
    });
    const want = [1, 2, 3].map(k => ['ka', 'ke', 'ki', 'ko', 'ku', 'la', 'le', 'li', 'lo', 'lu', 'ma', 'me', 'mi', 'mo', 'mu'].map(x => x + k).join(' ')).join(' ');
    expect(r.heard === 45 && r.total === 45 && r.introWords === 0 && r.two >= 4 && r.first === 'ka1' && r.flat.replace(/\s+/g, ' ') === want && Math.abs(r.lineStarts[0] - r.sungStart) < 0.3 && r.lit === 'ku2', JSON.stringify(r));
  });

  await test('Songs keep playing: the screen-on video never starts while a song plays (on iPad it would pause the app’s sound), and if the sound is paused anyway it resumes by itself', async page => {
    await voice(page); await setLevel(page, 1);
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { await startMic(); openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Keep playing', 'file'); });
    await page.waitForTimeout(200);
    const before = await page.evaluate(async () => { await keepAwake(); return { mic: mode, vidPlaying: !$('#keepAwake').paused }; });
    await page.click('#proPlay'); await page.waitForTimeout(300);
    // the 2-second screen-on check and a tap happen while the song plays
    await page.evaluate(async () => { await keepAwake(); document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await page.waitForTimeout(2600);
    const mid = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, vid: !$('#keepAwake').paused }));
    // the sound gets paused (as iOS does when something else takes it): it comes back by itself and the song carries on
    await page.evaluate(() => ac.suspend()); await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({ state: ac.state, playing: PRO.playing, off: PRO.off }));
    await page.waitForTimeout(1200); const later = await page.evaluate(() => PRO.off);
    await page.click('#proPlay');
    expect(before.mic === 'mic' && mid.playing && !mid.vid && mid.off > 2.4 && after.state === 'running' && after.playing && later > after.off + 0.8, JSON.stringify({ before, mid, after, later }));
  });

  await test('Words only where he sings: from a full mix no words are guessed (a clear message instead, the instrumental offered first); with the instrumental the intro gets none and the first word lands on his first sung note; no tap-to-sync buttons anywhere', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      store.proInfo = { 'Riff test': { lyrics: 'There’s no gravity that sucked me in your orbit\nThere’s no magnet that was in your heart today\nThe one restriction was the friction keeping us\nA little too far apart' } }; store.proWords = {};
      openLab('pro'); await proLoad(await makeProSong({ repeat: true, longIntro: true }), 'Riff test', 'file'); await new Promise(r => setTimeout(r, 150));
      const L = stLines(), an = PRO.an, out = {};
      lyricShow($('#proLyric'), an, L[2].t0 + 0.5);
      out.mix = { words: an.notes.filter(n => n.word).length, msg: $('#proLyric .kr-now').textContent, strong: !!$('.pro-inst-strong'), guessBtn: !!$('[data-act="singing-now"]') };
      out.tap = document.querySelectorAll('[data-act="w-here"], [data-act="w-earlier"], [data-act="w-later"], [data-act="singing-now"]').length;
      // the instrumental: his voice alone, so the words land on his singing
      await proLoad(await makeProSong({ repeat: true, longIntro: true }), 'Riff test', 'file', await makeProSong({ repeat: true, longIntro: true, noVoice: true })); await new Promise(r => setTimeout(r, 150));
      const a2 = PRO.an, sung = a2.notes.filter(n => n.word);
      lyricShow($('#proLyric'), a2, 3); out.iso = { notes: a2.notes.length, introWords: a2.notes.filter(n => n.t0 < 14 && n.word).length, first: sung[0] && sung[0].word, firstAt: sung[0] && +sung[0].t0.toFixed(1), introMsg: $('#proLyric .kr-now').textContent };
      return out; });
    expect(r.mix.words === 0 && /No words here/.test(r.mix.msg) && !r.mix.guessBtn && r.tap === 0
      && r.iso.notes >= 39 && r.iso.introWords === 0 && r.iso.first === 'There’s' && r.iso.firstAt > 14 && /Intro: the words start when he sings/.test(r.iso.introMsg), JSON.stringify(r));
  });

  await test('The graph never freezes: an error while drawing the words is caught, the song and graph keep going, and the cause is shown on screen', async page => {
    await page.addScriptTag({ content: require('fs').readFileSync(require('path').join(__dirname, 'prosynth.js'), 'utf8') });
    await page.evaluate(async () => { openLab('pro'); await proLoad(await makeProSong({ repeat: true }), 'Diag', 'file');
      const real = lyricShow; let n = 0; window.lyricShow = (...a) => { if (++n === 30) throw new Error('test failure in the words'); return real(...a); }; PRO.onTick = t => lyricShow($('#proLyric'), PRO.an, t); });
    await page.click('#proPlay'); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({ playing: PRO.playing, off: PRO.off, diag: ($('#diag') || {}).textContent }));
    await page.waitForTimeout(1000); const later = await page.evaluate(() => PRO.off); await page.click('#proPlay');
    expect(r.playing && r.off > 2 && later > r.off + 0.7 && /test failure in the words/.test(r.diag) && /build/.test(r.diag), JSON.stringify({ r, later }));
  });

  await test('Prepared song (the real Crazy Glue recording): recognised by name and length, his own notes (not the guitar), no words in the intro, each line starting when he sings it, the interlude without words, the repeated “I don’t wanna wiggle loose” before the bridge, Hold onto me twice, the bridge bars on his voice', async page => {
    const b64 = require('fs').readFileSync(require('path').join(__dirname, '..', 'songs', 'Crazy Glue - Josh Woodward.mp3')).toString('base64');
    const r = await page.evaluate(async b64 => {
      const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      store.proInfo = {}; store.proWords = {}; openLab('pro'); await proLoad(new Blob([u], { type: 'audio/mpeg' }), 'Crazy Glue - Josh Woodward', 'file'); await new Promise(r => setTimeout(r, 150));
      const an = PRO.an, at = t => { lyricShow($('#proLyric'), an, t); return { line: $('#proLyric .kr-now').textContent.trim(), lit: (($('#proLyric .kr-on') || {}).textContent || '') }; };
      return { prepared: an.prepared, lo: an.lo, hi: an.hi, n: an.notes.length, words: an.notes.filter(n => n.word).length, intro: an.notes.filter(n => n.t0 < 14.5).length,
        a: at(10), b: at(15.1), c: at(29.7), d: at(125), e: at(138), f: at(101.6), g: at(105.2), h: at(116.5), i: at(112.6), bars: [105.5, 113].map(x => { const n = PRO.an.notes.find(n => x >= n.t0 && x <= n.t1), k = Math.round((x - PRO.an.t0f) / PRO.an.hop); return n && PRO.an.trace[k] != null ? Math.abs(n.midi - PRO.an.trace[k]) : 99; }), sync: !!$('[data-act="w-earlier"]'), credit: ($('.st-credit') || {}).textContent };
    }, b64);
    expect(r.prepared && r.lo >= 46 && r.hi <= 71 && r.n > 250 && r.words === r.n && r.intro === 0 && /Intro/.test(r.a.line) && /^There’s no gra-vi-ty/.test(r.b.line) && r.b.lit === 'There’s'
      && /^Why fight it/.test(r.c.line) && r.c.lit === 'Why' && r.d.line === '♪' && /^I (ne-ver|nev-er) knew/.test(r.e.line) && /^I don’t wan-?na wig-?gle loose/.test(r.f.line) && /^Hold on-?to me/.test(r.g.line) && /^Hold on-?to me/.test(r.i.line) && /^As if you had a choice/.test(r.h.line) && r.bars.every(d => d < 1.5) && !r.sync && /Prepared/.test(r.credit), JSON.stringify(r));
  });

  await test('Song library: the songs in the app (no file picking); tapping one downloads the song and its instrumental, takes the band out, and shows his notes (Crazy Glue with its words, the others notes only for now)', async page => {
    const http = require('http'), fs = require('fs'), path = require('path'), root = path.resolve(__dirname, '..');
    const srv = http.createServer((q, res) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': /\.mp3$/.test(f) ? 'audio/mpeg' : 'text/html', 'content-length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res); });
    await new Promise(r => srv.listen(0, r));
    try {
      await page.goto('http://localhost:' + srv.address().port + '/index.html'); await page.waitForTimeout(300);
      await setLevel(page, 10); await page.evaluate(() => openLab('pro'));
      const lib = await page.evaluate(() => ({ songs: [...document.querySelectorAll('#proLib .lib-song b')].map(b => b.textContent), file: document.querySelectorAll('#proBox input[type=file]').length }));
      await page.click('#proLib .lib-song[data-song="Crazy Glue"]');
      await page.waitForFunction(() => PRO.an && PRO.an.name === 'Crazy Glue' && $('[data-card="studio"]'), null, { timeout: 120000 });
      const cg = await page.evaluate(() => { lyricShow($('#proLyric'), PRO.an, 15.1); return { prepared: PRO.an.prepared, lag: PRO.iso && PRO.iso.lag, removed: PRO.iso && PRO.iso.removedDb, band: !!$('#stBand'), alone: !!$('#stAlone'), lit: ($('#proLyric .kr-on') || {}).textContent, inst: ($('[data-card="inst"]') || {}).textContent }; });
      // the prepared ones: the words come in when he sings, and stay away from the intro and the solos
      const prep = {};
      for (const [sn, times] of [['Afterglow', [2, 5.2, 43.5, 101.5, 199]], ['Coffee', [10, 15.4, 100, 145, 165]]]) {
        await page.click('#proLib .lib-song[data-song="' + sn + '"]');
        await page.waitForFunction(n => PRO.an && PRO.an.name === n && $('[data-card="studio"]'), sn, { timeout: 120000 });
        prep[sn] = await page.evaluate(times => ({ prepared: PRO.an.prepared, n: PRO.an.notes.length, words: PRO.an.notes.filter(n => n.word).length, lo: PRO.an.lo, hi: PRO.an.hi,
          at: times.map(t => { lyricShow($('#proLyric'), PRO.an, t); return (($('#proLyric .kr-on') || {}).textContent || '') + '|' + $('#proLyric .kr-now').textContent.trim().slice(0, 24); }) }), times);
      }
      await page.click('#proLib .lib-song[data-song="I\'m Letting Go"]');
      await page.waitForFunction(() => PRO.an && PRO.an.name === 'I’m Letting Go' && $('[data-card="studio"]'), null, { timeout: 600000, polling: 1000 });
      const ag = await page.evaluate(() => { lyricShow($('#proLyric'), PRO.an, 30); return { isolated: PRO.an.isolated, notes: PRO.an.notes.length, lo: PRO.an.lo, hi: PRO.an.hi, words: PRO.an.notes.filter(n => n.word).length, msg: $('#proLyric .kr-now').textContent, credit: ($('.st-credit') || {}).textContent, band: !!$('#stBand') }; });
      expect(lib.songs.join() === 'Crazy Glue,Afterglow,Coffee,I’m Letting Go' && lib.file === 0 && cg.prepared && cg.lag === 0 && cg.removed >= 10 && cg.band && cg.alone && cg.lit === 'There’s' && /separated/.test(cg.inst)
        && ag.isolated && ag.notes > 50 && ag.words === 0 && /words for this song are coming/.test(ag.msg) && /Letting Go.*CC BY/.test(ag.credit) && ag.band
        && prep.Afterglow.prepared && prep.Afterglow.words === prep.Afterglow.n && prep.Afterglow.n > 200 && /Intro/.test(prep.Afterglow.at[0]) && /^Rain-?\|/.test(prep.Afterglow.at[1]) && /And it’s all I know/.test(prep.Afterglow.at[2]) && /You’re the af/.test(prep.Afterglow.at[3]) && /Then light me up/.test(prep.Afterglow.at[4])
        && prep.Coffee.prepared && prep.Coffee.words === prep.Coffee.n && /Intro/.test(prep.Coffee.at[0]) && /^A\|A cup of cof/.test(prep.Coffee.at[1]) && /\|♪/.test(prep.Coffee.at[2]) && /My life is ground/.test(prep.Coffee.at[3]) && /\|♪/.test(prep.Coffee.at[4])
        && !page.errors.length, JSON.stringify({ lib, cg, prep, ag, errors: page.errors }));
    } finally { srv.close(); }
  });

  await test('Your take, note by note: the song results show each note as a bar and your voice as a line, flat notes marked, and play the take', async page => {
    await voice(page); await setLevel(page, 1); await tab(page, '#t-sing');
    await page.evaluate(() => { loadSong(SONGS.find(s => s.id === 'bday')); G.tempo = 'normal'; V.follow = true; setInterval(() => { V.off = G.idx >= 12 && G.idx <= 18 ? -0.5 : 0; }, 20); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 });
    await page.waitForFunction(() => TAKE.play && !TAKE.play.disabled, null, { timeout: 10000 });
    const r = await page.evaluate(() => { const an = TAKE.an, near = an.notes.filter((n, i) => { const k = Math.floor((n.t0 + (n.t1 - n.t0) / 2) / an.hop); const v = an.trace[k]; return v != null && Math.abs(v - n.midi - (i >= 12 && i <= 18 ? -0.5 : 0)) < 0.3; }).length;
      return { card: !!document.querySelector('#report [data-card="take"] canvas'), n: an.notes.length, seq: G.seq.length, flat: an.notes.slice(12, 19).filter(n => n.c != null && n.c < -25).length, ok: an.notes.slice(0, 12).filter(n => n.c != null && Math.abs(n.c) < 25).length, near, words: an.notes[0].word, lead: TAKE.audioOff }; });
    await page.click('#takePlay'); await page.waitForTimeout(800);
    const play = await page.evaluate(() => ({ playing: TAKE.playing, off: TAKE.off }));
    await page.click('#takePlay');
    expect(r.card && r.n === r.seq && r.flat >= 6 && r.ok >= 11 && r.near >= 22 && r.words === 'Hap-' && r.lead > 1 && play.playing && play.off > 0.3, JSON.stringify({ r, play }));
  });

  await test('Voice Tutor: comments on a band take, builds a lesson for the flat line, then compares the retry with the band', async page => {
    await voice(page); await setLevel(page, 10);
    await page.evaluate(() => { openLab('band'); }); await page.click('.band-song[data-song="bday"]');
    // first take: line 3 a little flat; once the lesson starts the singer gets it right
    await page.evaluate(() => { tutorListen = false; G.tempo = 'normal'; V.follow = true; window.fixed = false; setInterval(() => { V.off = !fixed && !G.song.tutor && G.idx >= 12 && G.idx <= 18 ? -0.6 : 0; }, 20); });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(300);
    const first = await page.evaluate(() => { const c = document.querySelector('#report [data-card="tutor"]'); return { text: c && c.textContent, start: !!(c && c.querySelector('[data-act="start"]')), steps: [...c.querySelectorAll('.tutor-plan li')].map(l => l.textContent) }; });
    await page.click('#report [data-card="tutor"] [data-act="start"]');
    const steps = [];
    for (let k = 0; k < 3; k++) {
      await page.waitForFunction(() => G.song.tutor && G.run === 'singing', null, { timeout: 20000 });
      const info = await page.evaluate(() => ({ kind: G.song.tutor, n: G.seq.length, tempo: G.tempo, shift: G.shift, words: G.seq.map(n => n.w).join(' ') }));
      await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(200);
      info.say = await page.evaluate(() => document.querySelector('#report [data-card="tutor"] .tutor-say').textContent);
      info.saved = await page.evaluate(() => (store.runs || []).some(r => r.id === 'tutor'));
      steps.push(info);
      await page.click('#report [data-card="tutor"] [data-act="next"]');
    }
    await page.evaluate(() => { fixed = true; });
    await page.waitForFunction(() => G.song.id === 'bday' && G.run === 'singing', null, { timeout: 20000 });
    const band = await page.evaluate(() => ({ band: G.bandMode, tempo: G.tempo }));
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const c = document.querySelector('#report [data-card="tutor"]'); return { text: c.textContent, faster: !!c.querySelector('[data-act="faster"],[data-act="song"]'), on: TUT.on }; });
    expect(first.start && /flat|under the note|short/.test(first.text) && /line 3/.test(first.text) && first.steps.length === 4
      && steps.map(s => s.kind).join() === 'notes,slow,tempo' && steps[1].n === 7 && steps[1].tempo === 'slow' && steps[2].tempo === 'normal' && steps.every(s => !s.saved)
      && /dear|friend/.test(steps[1].words) && band.band && /went from \d+ to \d+/.test(after.text) && after.faster && !after.on && /performance|good shape/.test(after.text),
      JSON.stringify({ first, steps, band, after }));
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

  await test('Your starting point: a new singer takes the full check-up (range, pitch match, long note, recorded song, feelings) and sees 11 scored parts', async page => {
    await voice(page);
    await page.evaluate(() => { store.settings = { speak: false }; });
    await page.evaluate(() => startUnitCheck(UNITS[0]));
    const intro = await page.evaluate(() => ({ modal: !!$('#asModal'), steps: document.querySelectorAll('#asModal .as-steps li').length }));
    await page.click('#asModal [data-act="start"]');
    await page.click("#dBtns >> text=Let's go");
    await page.evaluate(() => {
      const plan = { speak: 1, natural: 50, low: [50, 43], high: 62, stretch: [41, 64] }, t0 = {};
      setInterval(() => {
        const lab = !$('#labStage').hidden;
        V.follow = assessing('song') && G.run !== 'done';
        if (V.follow) return;
        if (lab && D.id === 'range') { const ph = D.phase, f = plan[ph]; if (!f) { V.on = false; return; } t0[ph] = t0[ph] || performance.now(); const e = (performance.now() - t0[ph]) / 1000; V.on = true;
          V.m = ph === 'speak' ? 46 + Math.sin(e * 3) * 2 : ph === 'stretch' ? (e < 1.5 ? f[0] : e < 5 ? f[0] + (e - 1.5) / 3.5 * (f[1] - f[0]) : f[1]) : Array.isArray(f) ? Math.max(f[1], f[0] - e * 4) : f; return; }
        if (lab && D.id === 'match') { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target + 0.12; return; }
        if (lab && D.id === 'hold') { V.on = D.phase === 'wait' || (D.phase === 'hold' && now() - D.t0 < 9); V.m = (D.target || 50) - 0.05; return; }
        V.on = false;
      }, 30);
    });
    await page.waitForFunction(() => D.id === 'range' && D.phase === 'done', null, { timeout: 120000 });
    const afterRange = await page.evaluate(() => ({ step: ASSESS.step, bar: $('#assessBar').textContent, btn: $('#dBtns').textContent }));
    await page.click('#dBtns >> text=Next: step 2');
    await page.click('#dBtns >> text=▶ Start');
    await page.waitForFunction(() => D.id === 'match' && D.phase === 'done', null, { timeout: 90000 });
    const match = await page.evaluate(() => ({ n: D.rounds.length, data: ASSESS.data.match }));
    await page.click('#dBtns >> text=Next: step 3');
    const holdIntro = await page.evaluate(() => ({ step: $('#dStep').textContent, target: D.target, nat: store.profile.natural }));
    await page.click('#dBtns >> text=▶ Start');
    await page.waitForFunction(() => D.id === 'hold' && D.phase === 'done', null, { timeout: 40000 });
    const hold = await page.evaluate(() => ASSESS.data.hold);
    await page.click('#dBtns >> text=Next: step 4');
    const songStep = await page.evaluate(() => ({ screen: document.body.dataset.screen, song: G.song.id, tempo: G.tempo }));
    await page.click('#btnSing');
    await page.waitForFunction(() => !!document.querySelector('#asModal [data-step="rate"]'), null, { timeout: 90000 });
    await page.click('#asModal .as-face[data-v="4"]'); await page.click('#asModal [data-goal="tune"]'); await page.click('#asModal [data-act="done"]');
    await page.waitForTimeout(1500);
    const end = await page.evaluate(() => { const c = document.querySelector('[data-card="start"]'); const clip = (store.clips || []).find(x => x.id === store.start.raw.song.clip);
      return { screen: document.body.dataset.screen, attrs: store.start.attrs, overall: store.start.overall, rows: c.querySelectorAll('.attr-row').length, hear: !!c.querySelector('[data-act="hear-start"]'),
        clip: clip ? { star: clip.star, tag: clip.checkup } : null, baseline: !!store.baseline, u1: unitPassed(UNITS[0]), goals: store.goals, bar: !!$('#assessBar'), on: ASSESS.on, text: c.textContent.slice(0, 400) }; });
    expect(intro.modal && intro.steps === 5 && afterRange.step === 1 && /Step 2 of 5/.test(afterRange.bar) && match.n === 5 && match.data.score >= 70
      && /15 seconds/.test(holdIntro.step) && holdIntro.target === holdIntro.nat && hold.held >= 8 && hold.held <= 10.5
      && songStep.song === 'saints' && songStep.tempo === 'medium' && end.screen === 'progress' && end.rows === 11 && Object.values(end.attrs).every(v => v != null)
      && end.attrs.confidence === 80 && end.attrs.breath >= 50 && end.attrs.breath <= 70 && end.hear && end.clip && end.clip.star && end.clip.tag === 'start'
      && end.baseline && end.u1 && end.goals.join() === 'tune' && !end.bar && !end.on, JSON.stringify({ intro, afterRange, match, holdIntro, hold, songStep, end }));
  });

  await test('Check-up again: the same song in the same key, and Progress shows then vs now for each part', async page => {
    const out = await page.evaluate(() => {
      const raw = (ear, held, feel) => ({ range: { low: 43, high: 60 }, match: { score: ear, bias: -20, err: 30, found: 4, n: 5 }, hold: { score: 60, held, wob: 14, pur: 70, cl: 80 },
        song: { id: 'saints', shift: 50, tempo: 'medium', score: 61, ok: 14, n: 20, skills: { onset: 70, resonance: 72, timing: 90 }, clip: null }, rate: { feel, goals: [] } });
      store.profile = { low: 43, high: 60, natural: 50, type: 'Baritone', zlo: 45, zhi: 58 };
      store.start = { at: Date.now() - 864e6, raw: raw(60, 6, 2), attrs: {} }; store.checkups = [{ at: Date.now(), raw: raw(85, 12, 4), attrs: {} }]; save();
      $('#t-progress').click();
      const c = document.querySelector('[data-card="start"]'), row = k => c.querySelector('[data-attr="' + k + '"] .attr-num').textContent;
      assessBegin(true); const a = { songId: ASSESS.songId, shift: ASSESS.shift, tempo: ASSESS.tempo, retake: ASSESS.retake }; assessStop();
      return { title: c.querySelector('h3').textContent, ear: row('ear'), breath: row('breath'), conf: row('confidence'), up: c.querySelectorAll('.attr-num.up').length, a };
    });
    expect(/Then vs now/.test(out.title) && out.ear === '60 → 85 ↑25' && out.breath === '40 → 80 ↑40' && out.conf === '40 → 80 ↑40' && out.up === 3
      && out.a.songId === 'saints' && out.a.shift === 50 && out.a.tempo === 'medium' && out.a.retake, JSON.stringify(out));
  });

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
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = null; store.start = { at: 1, raw: {}, attrs: {} }; startUnitCheck(UNITS[0]); }); await page.waitForTimeout(300);
    await page.click('[data-tempo="normal"]'); await page.evaluate(() => { V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ song: G.song.id, done: unitPassed(UNITS[0]) }));
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

  await test('later exercises stay locked until their stage; every song is open', async page => {
    await setLevel(page, 1);
    const s = await page.evaluate(() => { openLab('vowels'); return { lab: D.id, locked: [...document.querySelectorAll('#songs button')].filter(b => b.disabled).length }; });
    expect(s.lab !== 'vowels' && s.locked === 0, JSON.stringify(s));
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
