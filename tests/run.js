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

  await test('first lesson: Do-Re-Mi with words, then "you already sing … well"', async page => {
    await voice(page);
    await page.click('[data-card="notes"] button'); await page.waitForTimeout(400);
    const words = await page.evaluate(() => [D.id, G.song.id, [...document.querySelectorAll('#staff .lyr')].map(t => t.textContent).join(' ')]);
    expect(words[0] === 'scale' && /Do Re Mi Fa So La Ti Do/.test(words[2]), JSON.stringify(words));
    await page.evaluate(() => { window.badNotes = [5, 6]; setInterval(() => { const tg = G.seq[G.idx]; V.on = G.run === 'singing'; if (tg) V.m = tg.m + (badNotes.includes(G.idx) ? 1.2 : 0); }, 25); });
    await page.click('[data-tempo="normal"]'); await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 60000 }); await page.waitForTimeout(1800);
    const s = await page.evaluate(() => ({ head: document.querySelector('.cheer-big').textContent, done: (store.lessons || []).includes('1.2') }));
    expect(/You already sing Do, Re, Mi, Fa, So/.test(s.head) && s.done, JSON.stringify(s));
    await page.click('#btnHome'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ screen: document.body.dataset.screen, r: $('#homeCards [data-card="notes"] .result')?.textContent }));
    expect(after.screen === 'home' && /You sing Do, Re, Mi, Fa, So well/.test(after.r), JSON.stringify(after));
  });

  await test('pure-notes lesson lights up the keyboard', async page => {
    await voice(page);
    await page.evaluate(() => startLesson(LEVELS[0].lessons.find(x => x.kind === 'find'))); await page.waitForTimeout(300);
    for (const m of [48, 52, 55]) { await page.evaluate(m => { V.on = true; V.m = m; }, m); await page.waitForTimeout(2200); await page.evaluate(() => { V.on = false; }); await page.waitForTimeout(400); }
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ found: store.discoveries.length, done: store.lessons.includes('1.3'), lit: document.querySelectorAll('#kbd rect[fill="var(--pure)"]').length, lv: level() }));
    expect(s.found >= 3 && s.done && s.lit >= 3 && s.lv === 1, JSON.stringify(s));
  });

  await test('Level 1 lasts: every lesson plus 3 practice days before Level 2', async page => {
    await page.evaluate(() => {
      store.discoveries = [48, 52, 55].map(m => ({ midi: m, purity: 90, amps: [1], at: 0 }));
      store.profile = { low: 41, high: 63, type: 'Bass', zlo: 43, zhi: 60 };
      store.lab = { hold: { best: 45 }, match: { best: 55 } };
      store.runs = [{ id: 'doremi', ok: 6, pure: 4, n: 8, avg: 80 }, { id: 'row', ok: 20, pure: 10, n: 27, avg: 80 }];
      store.days = ['a', 'b']; checkLevel();
    });
    let lv = await page.evaluate(() => level());
    expect(lv === 1, 'moved on before 3 days: ' + lv);
    await page.evaluate(() => { store.days.push('c'); checkLevel(); });
    const s = await page.evaluate(() => ({ lv: level(), cel: !$('#celebrate').hidden, live: $('.live').hidden }));
    expect(s.lv === 2 && s.cel && !s.live, JSON.stringify(s));
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
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target - 0.3; }, 25); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 90000 });
    const t = await page.evaluate(() => [...document.querySelectorAll('#dResult .fix > b')].map(b => b.textContent).join(' | '));
    expect(/flat/.test(t), 'no flat finding: ' + t);
  });

  await test('first song lesson: Row Row sung through', async page => {
    await voice(page);
    await page.evaluate(() => startLesson(LEVELS[0].lessons[5])); await page.waitForTimeout(300);
    await page.click('[data-tempo="normal"]'); await page.evaluate(() => { V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ song: G.song.id, done: store.lessons.includes('1.6'), lv: level() }));
    expect(s.song === 'row' && s.done && s.lv === 1, JSON.stringify(s));
  });

  await test('metronome ticks through the song; starting note plays first', async page => {
    await voice(page);
    await tab(page, '#t-sing');
    await page.evaluate(() => { window.played = []; const pt = playTone; playTone = (m, ...r) => { played.push(m); return pt(m, ...r); }; $('#btnRef').click(); });
    await page.waitForTimeout(200);
    const first = await page.evaluate(() => [played[0], G.seq[0].m]);
    expect(first[0] === first[1], 'starting note ' + first);
    await page.click('#btnMetro');
    await page.click('#btnSing'); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ ticks: G.ticks.length, beats: Math.ceil(G.seq.reduce((a, n) => a + n.b, 0)), under: played.includes(G.seq[0].m), metro: store.settings.metro }));
    expect(s.ticks >= s.beats + 3 && s.under && s.metro, JSON.stringify(s));
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
