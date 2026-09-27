// Every option in the stories sample, driven with real mouse and keyboard input. Prints PASS/FAIL per check.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => { window.__storyDur = 20000; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' @ ' + (e.stack || '').split(/\n/).slice(1, 3).join(' | ')));
page.on('response', (r) => { if (r.status() === 404) errors.push('404 ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const results = [];
async function check(name, fn) {
  try { const ok = await fn(); results.push([ok ? 'PASS' : 'FAIL', name]); console.log(ok ? 'PASS' : 'FAIL', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '-', e.message.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 9).join(' / ')); }
  if (results.at(-1)[0] === 'FAIL' && fails++ < 3) await page.screenshot({ path: `./out/fail${fails}.png` });
}
let fails = 0;
const ev = (fn, arg) => page.evaluate(fn, arg);
const box = async (sel) => (await page.locator(sel).first().boundingBox());
// inside a playing story things move, so tap where it is now; elsewhere let Playwright scroll to it
async function tap(sel) {
  if (sel.includes('.face')) { const b = await box(sel); return page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
  await page.locator(sel).first().click({ timeout: 6000 });
}
async function drag(x0, y0, x1, y1, steps = 12) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(16); } await page.mouse.up(); }

await page.goto('http://localhost:5177/story.html?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
await wait(1500);

// ---------- home ----------
await check('tray shows 7 people', async () => (await page.locator('#tray .tr').count()) === 7);
await check('chat list shows 8 rows', async () => (await page.locator('#chats .crow').count()) === 8);

// ---------- viewer ----------
await tap('#tray .tr[data-u="baani"] .ring');
await page.waitForSelector('#viewer.on', { timeout: 5000 });
await wait(1500);
const faceName = () => ev(() => document.querySelector('.face .l1')?.firstChild?.textContent.trim());
const barW = (i) => ev((i) => parseFloat(document.querySelectorAll('.face .bars b')[i]?.style.width || '0'), i);
await check('opens baani', async () => (await faceName()) === 'baani');
await page.waitForFunction(() => !document.querySelector('.face .stage.loading'), null, { timeout: 15000 }).catch(() => {});
await check('progress bar moves', async () => { const a = await barW(0); await wait(700); return (await barW(0)) > a; });
await check('hold pauses', async () => {
  await page.mouse.move(195, 420); await page.mouse.down(); await wait(500);
  const a = await barW(0); const paused = await ev(() => document.querySelector('.face').classList.contains('paused')); await wait(600);
  const b = await barW(0); await page.mouse.up(); return paused && Math.abs(b - a) < 1;
});
await check('release resumes', async () => { const a = await barW(0); await wait(600); return (await barW(0)) > a; });
await check('poll vote shows results', async () => { await tap('.face .poll .opt[data-i="0"]'); await wait(400); return ev(() => !!document.querySelector('.face .poll.voted')); });
await check('location sticker tap shows bubble', async () => { await tap('.face .stk[data-type="loc"]'); await wait(300); return ev(() => !!document.querySelector('.tipb')); });
await check('tap right goes to next item', async () => { await page.mouse.click(330, 420); await wait(500); return (await barW(0)) === 100; });
await check('countdown remind toggles', async () => { await tap('.face .remind'); await wait(300); return ev(() => !!document.querySelector('.face .remind.on')); });
await check('tap left goes back', async () => { await page.mouse.click(40, 420); await wait(500); return (await barW(0)) < 100; });
await check('like button', async () => { await tap('.face [data-act="like"]'); await wait(200); return ev(() => !!document.querySelector('.face [data-act="like"].liked')); });
await check('reply focus shows quick reactions', async () => { await tap('.face .reply input'); await wait(400); return ev(() => document.querySelector('.face').classList.contains('typing')); });
await check('quick reaction sends', async () => { await tap('.face .quick [data-q="🔥"]'); await wait(300); return ev(() => document.querySelectorAll('.burst').length > 0 && !document.querySelector('.face').classList.contains('typing')); });
await check('typed reply sends', async () => { await tap('.face .reply input'); await page.keyboard.type('nice!'); await page.keyboard.press('Enter'); await wait(300); return ev(() => document.getElementById('toast').textContent.includes('Reply sent')); });
await check('more menu opens', async () => { await wait(300); await tap('.face .vhead [data-act="more"]'); await wait(500); const ok = await ev(() => document.getElementById('sheet').classList.contains('on')); await page.mouse.click(195, 100); await wait(500); return ok; });
await check('swipe left turns to next person', async () => { await drag(330, 420, 60, 425); await wait(800); return (await faceName()) !== 'baani'; });
await check('swipe right returns', async () => { await wait(300); await drag(60, 420, 340, 425); await wait(800); return (await faceName()) === 'baani'; });
await check('swipe down closes', async () => { await drag(195, 300, 195, 650); await wait(800); return ev(() => !document.getElementById('viewer').classList.contains('on')); });

// eddy: question + slider; riya: video + quiz
await ev(() => window.__stories.users.forEach((u) => { if (u.id === 'eddy' || u.id === 'riya') u.seen = 0; }));
await tap('#tray .tr[data-u="eddy"] .ring'); await page.waitForSelector('#viewer.on'); await wait(1500);
await check('question sticker opens answer box', async () => { await tap('.face .stk[data-type="question"]'); await wait(500); const ok = await ev(() => !!document.getElementById('qa')); await page.keyboard.type('where to?'); await tap('#qs'); await wait(400); return ok; });
await check('next item has emoji slider', async () => { await page.mouse.click(330, 420); await wait(700); return ev(() => !!document.querySelector('.face .stk[data-type="slider"]')); });
await check('emoji slider drags and answers', async () => {
  const k = await box('.face .slider .knob'); await drag(k.x + k.width / 2, k.y + k.height / 2, k.x + 150, k.y + k.height / 2, 10); await wait(300);
  return ev(() => !!document.querySelector('.face .slider.answered'));
});
await page.mouse.click(330, 420); await page.waitForFunction(() => document.querySelectorAll('.face').length === 1 && document.querySelector('.face .l1')?.firstChild?.textContent.trim() === 'riya.k', null, { timeout: 8000 }).catch(() => {}); await wait(600); // to riya
await check('video story plays', async () => ev(() => { const v = document.querySelector('.face video.media'); return !!v && !v.paused; }));
await page.mouse.click(330, 420); await page.waitForSelector('.face .stk[data-type="quiz"]', { timeout: 8000 }).catch(() => {}); await wait(400);
await check('quiz answer marks right/wrong', async () => { await tap('.face .quiz .o[data-i="0"]'); await wait(300); return ev(() => !!document.querySelector('.face .quiz .o.wrong') && !!document.querySelector('.face .quiz .o.right')); });
await tap('.face .vhead [data-act="close"]'); await wait(700);
await check('X closes viewer', async () => ev(() => !document.getElementById('viewer').classList.contains('on')));

// ---------- editor ----------
await tap('#tray .tr[data-u="me"] .ring');
await wait(500);
await check('Your story opens the gallery', async () => ev(() => document.querySelector('.gal')?.classList.contains('on')));
await tap('.gal [data-id="1011"]'); await wait(1200);
await check('editor opens with labelled rail', async () => ev(() => document.getElementById('editor').classList.contains('on') && getComputedStyle(document.querySelector('#rail .lb')).opacity === '1'));
const count = (t) => ev((t) => document.querySelectorAll(`#elayer .stk${t ? `[data-type="${t}"]` : ''}`).length, t);
await wait(2600);

await check('text tool: type, font, colour, background, done', async () => {
  await tap('#rail [data-a="text"]'); await wait(300);
  await page.keyboard.type('sunday reset');
  await tap('[data-font="neon"]'); await tap('[data-t="colors"]'); await tap('[data-c="#ffcc00"]'); await tap('[data-t="bg"]'); await tap('[data-t="align"]'); await tap('[data-t="anim"]');
  const sz = await box('#tsize'); await drag(sz.x + 14, sz.y + sz.height - 10, sz.x + 14, sz.y + 20, 6);
  await tap('[data-t="done"]'); await wait(400);
  return (await count('text')) === 1 && ev(() => { const t = document.querySelector('#elayer .txt'); return t.textContent.includes('sunday reset') && t.classList.contains('f-neon'); });
});
await check('tap text re-opens it for editing', async () => { await tap('#elayer .stk[data-type="text"]'); await wait(300); const ok = await ev(() => document.getElementById('editor').classList.contains('texting') && document.getElementById('tx').textContent.includes('sunday')); await tap('[data-t="done"]'); await wait(300); return ok; });

async function sticker(kind, then) { await tap('#rail [data-a="stickers"]'); await wait(600); await tap(`#stray [data-s="${kind}"]`); await wait(700); if (then) await then(); await wait(500); }
await check('effects tray applies a filter', async () => { await tap('#rail [data-a="effect"]'); await wait(600); await tap('#fx [data-i="3"]'); await wait(200); const f = await ev(() => document.querySelector('#estage .media').style.filter); await page.mouse.click(195, 60); await wait(400); return f.includes('sepia'); });
await check('swipe on photo changes filter', async () => {
  const a = await ev(() => document.querySelector('#estage .media').style.filter);
  await drag(300, 560, 120, 565); await wait(200);
  return (await ev(() => document.querySelector('#estage .media').style.filter)) !== a;
});
await check('sticker: location', async () => { await sticker('loc', () => tap('#ll [data-l="Goa"]')); return (await count('loc')) === 1; });
await check('sticker: time', async () => { await sticker('clock'); return (await count('clock')) === 1; });
await check('sticker: hashtag', async () => { await sticker('tag', async () => { await page.keyboard.type('weekend'); await tap('#ib'); }); return (await count('tag')) === 1; });
await check('music tabs load other lists', async () => {
  await tap('#rail [data-a="audio"]'); await page.waitForSelector('#ml [data-i]', { timeout: 20000 });
  const first = await ev(() => document.querySelector('#ml [data-i="0"] b').textContent);
  await tap('#mt [data-q="latest hindi songs"]'); await page.waitForFunction((f) => { const b = document.querySelector('#ml [data-i="0"] b'); return b && b.textContent !== f; }, first, { timeout: 20000 });
  await page.mouse.click(195, 60); await wait(400); return true;
});
await check('drag moves a sticker', async () => {
  const b = await box('#elayer .stk[data-type="clock"]'); const before = await ev(() => document.querySelector('#elayer .stk[data-type="clock"]').style.top);
  await drag(b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 40, b.y + b.height / 2 + 60); await wait(200);
  return (await ev(() => document.querySelector('#elayer .stk[data-type="clock"]').style.top)) !== before;
});
await check('tap location sticker changes its style', async () => { const a = await ev(() => document.querySelector('#elayer .stk[data-type="loc"] .chip').className); await tap('#elayer .stk[data-type="loc"]'); await wait(200); return (await ev(() => document.querySelector('#elayer .stk[data-type="loc"] .chip').className)) !== a; });
await check('drag to bin deletes', async () => {
  const b = await box('#elayer .stk[data-type="tag"]'); const n = await count();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 15; i++) { await page.mouse.move(b.x + b.width / 2 + (195 - b.x - b.width / 2) * i / 15, b.y + b.height / 2 + (844 - 100 - 26 - b.y - b.height / 2) * i / 15); await wait(16); }
  const bin = await box('#bin'); await page.mouse.move(bin.x + bin.width / 2, bin.y + bin.height / 2); await wait(100); await page.mouse.up(); await wait(400);
  return (await count()) === n - 1;
});
await check('sticker: mention', async () => { await sticker('men', () => tap('#pl [data-p="eddy"]')); return (await count('men')) === 1; });
await check('sticker: question', async () => { await sticker('question'); return (await count('question')) === 1; });
await check('sticker: poll', async () => { await sticker('poll'); return (await count('poll')) === 1; });
await check('sticker: countdown', async () => { await sticker('countdown', async () => { await tap('#cn'); await page.keyboard.type('trip'); await tap('#cb'); }); return (await count('countdown')) === 1; });
await check('sticker: quiz', async () => { await sticker('quiz'); return (await count('quiz')) === 1; });
await check('sticker: emoji slider', async () => { await sticker('slider'); return (await count('slider')) === 1; });
await check('sticker: link', async () => { await sticker('link', async () => { await page.keyboard.type('pingochat.xyz'); await tap('#ib'); }); return (await count('link')) === 1; });
await check('sticker: emoji', async () => { await tap('#rail [data-a="stickers"]'); await page.waitForSelector('#egrid [data-e]', { timeout: 8000 }); await tap('#egrid [data-e="0"]'); await wait(500); return (await count('emoji')) === 1; });
await check('sticker: music (search, pick, part)', async () => {
  await sticker('music', async () => { await page.waitForSelector('#ml [data-i]', { timeout: 15000 }); await tap('#ml [data-i="0"] .t'); await wait(800); await tap('#cdone'); });
  return (await count('music')) === 1;
});
await check('rail toggle shows more tools', async () => { await tap('#rail [data-a="tog"]'); await wait(300); return ev(() => getComputedStyle(document.querySelector('#rail .more')).display !== 'none'); });
await check('mention from rail', async () => { const n = await count('men'); await tap('#rail [data-a="mention"]'); await wait(500); await tap('#pl [data-p="riya"]'); await wait(400); return (await count('men')) === n + 1; });
await check('draw: stroke, undo, done', async () => {
  await tap('#rail [data-a="tog"]'); await wait(200); await tap('#rail [data-a="draw"]'); await wait(300);
  await drag(80, 250, 300, 300); await drag(80, 350, 300, 400); await tap('[data-d="undo"]'); await tap('[data-d="done"]'); await wait(200);
  return ev(() => { const c = document.getElementById('eink'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4000) if (d[i]) n++; return n > 0 && !document.getElementById('editor').classList.contains('drawing'); });
});
await check('download', async () => { await tap('#rail [data-a="tog"]'); await wait(200); await tap('#rail [data-a="download"]'); await wait(400); return ev(() => document.getElementById('toast').textContent.includes('Saved')); });
await check('more menu', async () => { await tap('#rail [data-a="tog"]'); await wait(200); await tap('#rail [data-a="moremenu"]'); await wait(500); await tap('#sheet [data-t="Save draft"]'); await wait(300); return ev(() => document.getElementById('toast').textContent.includes('Save draft')); });
await check('caption', async () => { await tap('#ecap'); await page.keyboard.type('weekend vibes'); return ev(() => document.getElementById('ecap').value === 'weekend vibes'); });
await check('arrow opens share sheet', async () => { await tap('.ebar [data-a="share"]'); await wait(500); const ok = await ev(() => !!document.getElementById('shgo')); await page.mouse.click(195, 60); await wait(400); return ok; });
await check('Your story posts it', async () => { await tap('.ebar [data-a="story"]'); await wait(2600); return ev(() => window.__stories.users[0].items.length === 1 && !document.getElementById('editor').classList.contains('on')); });
await check('own story shows its stickers', async () => {
  await tap('#tray .tr[data-u="me"] .ring img'); await page.waitForSelector('#viewer.on'); await wait(1200);
  return ev(() => document.querySelectorAll('.face .layer .stk').length >= 10 && !!document.querySelector('.face .ink') && document.querySelector('.face [data-act="activity"]'));
});
await check('activity sheet lists viewers', async () => { await tap('.face [data-act="activity"]'); await wait(600); return ev(() => document.querySelectorAll('.actsheet .row').length === 7); });
await page.mouse.click(195, 30); await wait(400);
await tap('.face .vhead [data-act="close"]'); await wait(700);

// ---------- video + boomerang ----------
await tap('#tray .tr[data-u="me"] [data-plus]'); await wait(500);
await tap('.gal [data-v]'); await wait(1500);
await check('video editor', async () => ev(() => !!document.querySelector('#estage video.media')));
await check('boomerang opens on Classic', async () => { await tap('#rail [data-a="effect"]'); await wait(1500); return ev(() => document.querySelector('#xopts [data-b="classic"]').classList.contains('on')); });
await check('boomerang slowmo', async () => { await tap('#xopts [data-b="slowmo"]'); await wait(300); return ev(() => document.getElementById('xv').playbackRate === 0.5); });
await check('trim handle drags', async () => { const h = await box('#h1'); await drag(h.x + 8, h.y + 20, h.x - 80, h.y + 20, 6); await wait(200); return ev(() => parseFloat(document.getElementById('sh1').style.width) > 20); });
await check('boomerang done', async () => { await tap('#xmode [data-x="done"]'); await wait(300); return ev(() => !document.getElementById('editor').classList.contains('effects')); });
await check('close friends posts it', async () => { await tap('.ebar [data-a="cf"]'); await wait(2600); return ev(() => window.__stories.users[0].items.at(-1)?.cf === true); });

// ---------- profile, post, add to story ----------
await tap('#chats [data-p="baani"]'); await wait(900);
await check('profile opens', async () => ev(() => document.getElementById('profile').classList.contains('on')));
await tap('#profile [data-post="0"]'); await wait(900);
await check('post opens', async () => ev(() => document.getElementById('postview').classList.contains('on')));
await check('post like', async () => { await tap('#postview [data-v="like"]'); await wait(200); return ev(() => !!document.querySelector('#postview .liked')); });
await tap('#postview [data-v="share"]'); await wait(700);
await check('share: pick a friend then send', async () => { await tap('.sgridp [data-p="eddy"]'); await wait(200); const ok = await ev(() => !!document.querySelector('#sacts [data-a="send"]')); await tap('#sacts [data-a="send"]'); await wait(300); return ok; });
await tap('#postview [data-v="share"]'); await wait(700);
await tap('#sacts [data-a="story"]'); await wait(900);
await check('add to story opens editor with the post', async () => ev(() => document.getElementById('editor').classList.contains('on') && !!document.querySelector('#elayer .stk[data-type="post"]')));
await check('tap post card changes its style', async () => { await tap('#elayer .stk[data-type="post"]'); await wait(200); return ev(() => !!document.querySelector('#elayer .postcard.s1')); });
await check('back → discard', async () => { await tap('.etop [data-a="back"]'); await wait(500); await tap('#sheet [data-k="discard"]'); await wait(400); return ev(() => !document.getElementById('editor').classList.contains('on')); });

console.log('\n' + results.filter((r) => r[0] === 'PASS').length + '/' + results.length + ' passed');
console.log('page errors:', errors.slice(0, 8));
await browser.close();
