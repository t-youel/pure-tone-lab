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
const setLevel = (page, n) => page.evaluate(n => { store.level = n; save(); applyLevel(); }, n);

async function test(name, fn) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
  await test('starts simple: Level 1 path only, no meters, no advanced tabs', async page => {
    const s = await page.evaluate(() => ({ lv: $('#lvlBadge').textContent, live: $('.live').hidden, lab: $('#t-lab').hidden, sing: $('#t-sing').hidden, ring: !!$('#ring'), path: !$('#tab-path').hidden }));
    expect(s.lv.startsWith('Level 1'), 'badge: ' + s.lv);
    expect(s.live && s.lab && s.sing, 'advanced UI should be hidden at level 1');
    expect(s.ring && s.path, 'level 1 ring should show on the path');
  });

  await test('Level 1: finding 3 pure notes celebrates and unlocks Level 2', async page => {
    await voice(page);
    for (const m of [48, 52, 55]) { await page.evaluate(m => { V.on = true; V.m = m; }, m); await page.waitForTimeout(2200); await page.evaluate(() => { V.on = false; }); await page.waitForTimeout(400); }
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ lv: store.level, cel: !$('#celebrate').hidden, lab: $('#t-lab').hidden, found: store.discoveries.length }));
    expect(s.found >= 3, 'found ' + s.found);
    expect(s.lv === 2 && s.cel && !s.lab, JSON.stringify(s));
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
    await page.click('#t-sing');
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

  await test('range test finds a voice type', async page => {
    await voice(page); await setLevel(page, 2);
    await page.evaluate(() => openLab('range')); await page.click('#dBtns >> text=Start');
    await page.evaluate(() => { V.on = true; window._s = setInterval(() => { V.m = 46 + Math.sin(performance.now() / 300) * 2; }, 50); });
    await page.waitForFunction(() => D.phase === 'low', null, { timeout: 15000 });
    await page.evaluate(() => { clearInterval(_s); V.m = 41; }); await page.waitForTimeout(1500);
    await page.click("#dBtns >> text=That's my lowest");
    await page.evaluate(() => { V.m = 63; }); await page.waitForTimeout(1500);
    await page.click("#dBtns >> text=That's my highest"); await page.waitForTimeout(400);
    const s = await page.evaluate(() => store.profile);
    expect(s && s.type === 'Bass' && s.low === 41 && s.high === 63, JSON.stringify(s));
  });

  await test('pitch match spots a flat singer', async page => {
    await voice(page); await setLevel(page, 4);
    await page.evaluate(() => openLab('match')); await page.click('#dBtns >> text=Start');
    await page.evaluate(() => { setInterval(() => { V.on = D.phase === 'sing'; if (D.target != null) V.m = D.target - 0.3; }, 25); });
    await page.waitForFunction(() => D.phase === 'done', null, { timeout: 90000 });
    const t = await page.evaluate(() => [...document.querySelectorAll('#dResult .fix > b')].map(b => b.textContent).join(' | '));
    expect(/flat/.test(t), 'no flat finding: ' + t);
  });

  await test('Level 6: singing Row Row on pitch passes the level', async page => {
    await voice(page); await setLevel(page, 6);
    await page.click('#t-sing'); await page.click('[data-tempo="normal"]');
    await page.evaluate(() => { V.follow = true; });
    await page.click('#btnSing');
    await page.waitForFunction(() => G.run === 'done', null, { timeout: 90000 }); await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({ lv: store.level, ok: runStats().ok, n: runStats().n, cel: !$('#celebrate').hidden }));
    expect(s.lv === 7 && s.cel, JSON.stringify(s));
  });

  await test('song feedback links to the right Lab exercise', async page => {
    await voice(page); await setLevel(page, 10);
    await page.click('#t-sing'); await page.click('[data-tempo="normal"]');
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
    await setLevel(page, 6);
    const s = await page.evaluate(() => { openLab('vowels'); return { lab: D.id, twinkle: [...document.querySelectorAll('#songs button')].find(b => b.textContent.startsWith('Twinkle'))?.disabled }; });
    expect(s.lab !== 'vowels' && s.twinkle === true, JSON.stringify(s));
  });

  await test('Sing screen fits an iPad screen; phone has no sideways scroll', async (page, browser) => {
    await voice(page); await setLevel(page, 10);
    await page.click('#t-sing'); await page.evaluate(() => scrollTo(0, 0));
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
