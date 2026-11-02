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
    expect(s.next === 'Unit 1 · Your voice today' && /Find your voice/.test(s.btn), JSON.stringify(s));
    expect(!s.tabs && !s.meters && !s.status && !s.back, 'too much on the first screen: ' + JSON.stringify(s));
  });

  await test('Path: 12 units and Checkpoint A in 4 stages, Unit 1 first; small markers', async page => {
    const s = await page.evaluate(() => ({ n: UNITS.length, stages: STAGES.length, first: UNITS[0].title, gate: UNITS.findIndex(u => u.gate), labs: UNITS.filter(u => u.check.lab).map(u => u.check.lab) }));
    expect(s.n === 13 && s.stages === 4 && s.first === 'Your voice today' && s.gate === 5 && new Set(s.labs).size === s.labs.length, JSON.stringify(s));
    await setLevel(page, 10);
    const big = await page.evaluate(() => { $('#t-path').click(); return Math.max(0, ...[...document.querySelectorAll('.u-num')].map(e => e.getBoundingClientRect().width)); });
    expect(big <= 34, 'markers too big: ' + big);
  });

  await test('Home step 1 opens the voice test with its five phases shown; result leads to the first song', async page => {
    await voice(page);
    await page.click('[data-card="today"] button'); await page.waitForTimeout(400);
    const chips = await page.evaluate(() => ({ n: document.querySelectorAll('#vfStrip .vf-chip').length, screen: document.body.dataset.screen, title: $('#screenTitle').textContent }));
    expect(chips.n === 5 && chips.screen === 'voice' && /Find your voice/.test(chips.title), JSON.stringify(chips));
    await page.evaluate(() => { store.settings = { speak: false }; setInterval(() => { const ph = D.phase; V.on = ['speak', 'natural', 'low', 'high', 'stretch'].includes(ph); V.m = ph === 'low' ? 43 : ph === 'high' ? 60 : ph === 'stretch' ? 40 + ((performance.now() / 120) % 24) : ph === 'speak' ? 46 + Math.sin(performance.now() / 300) * 2 : 48; }, 30); });
    await page.click("#dBtns >> text=Let's go");
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 120000 });
    const done = await page.evaluate(() => [...document.querySelectorAll('#vfStrip .vf-chip.done')].length);
    expect(done === 5, 'chips done: ' + done);
    await page.click('#dBtns >> text=Next: sing your first song');
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ song: G.song.id, screen: document.body.dataset.screen }));
    expect(s.song === 'saints' && s.screen === 'songs', JSON.stringify(s));
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
    expect(first.cards === 'today' && /Find your voice/.test(first.btn) && later.cards === 'today,checkin,path,progress,songs' && /Posture & breath/.test(later.title) && /ENT/.test(safe) && unit.screen === 'path' && unit.page && unit.title === 'Posture & breath', JSON.stringify({ first, later, safe: safe.slice(0, 60), unit }));
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

  await test("What's inside: the whole app from Home, later parts greyed with when they open", async page => {
    await page.click('#btnTour');
    const s = await page.evaluate(() => ({ screen: document.body.dataset.screen, secs: [...document.querySelectorAll('.tour-sec h3')].map(h => h.textContent).join('|'), labs: document.querySelectorAll('.tour-row[data-item^="lab-"]').length, total: LAB.length, lockedLab: $('.tour-row[data-item="lab-vowels"]').classList.contains('locked') && $('.tour-row[data-item="lab-vowels"] button').disabled, lockTxt: $('.tour-row[data-item="lab-vowels"]').textContent }));
    await page.click('.tour-row[data-item="lab-match"] button');
    const opened = await page.evaluate(() => D.id);
    expect(s.screen === 'tour' && s.secs === "Your course|Easy mode · First Notes|Today's session|Songs|Exercises|Your voice|Progress|Singing tools|Settings" && s.labs === s.total && s.lockedLab && /Opens in Stage 3/.test(s.lockTxt) && opened === 'match', JSON.stringify({ s, opened }));
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
    const routine = await page.evaluate(() => ({ stars: EZ.stars, day: store.easy.days[today()], done: !!document.querySelector('.ez-done') }));
    expect(open.screen === 'easy' && /Home,Games,Again,Next,Helpers/.test(open.bar) && open.steps === 5 && open.fits && open.first === 'match' && open.card && tip && routine.stars >= 10 && routine.day.best >= 60 && routine.done, JSON.stringify({ open, tip, routine }));
    // the games menu, and two of the new games
    await page.click('#easyBtns >> text=Games');
    const tiles = await page.evaluate(() => [...document.querySelectorAll('#easyMenu .easy-tile')].map(x => x.dataset.game).join());
    await page.click('.easy-tile[data-game="piano"]');
    await page.waitForFunction(() => EZ.piano && !$('#easyPiano').hidden, null, { timeout: 5000 });
    // tap a wrong key first (it just sounds), then the glowing ones
    await page.click('.pn-key:nth-child(8)');
    const n = await page.evaluate(() => EZ.piano.notes.length);
    for (let i = 0; i < n; i++) await page.click('.pn-key.want');
    await page.waitForFunction(() => EZ.song && EZ.phase === 'run', null, { timeout: 5000 });
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
    await page.evaluate(() => { store.profile = { low: 43, high: 64, natural: 50, type: 'Baritone', zlo: 45, zhi: 61 }; store.baseline = null; startUnitCheck(UNITS[0]); }); await page.waitForTimeout(300);
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
