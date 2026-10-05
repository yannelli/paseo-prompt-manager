// Renders the GitHub social banner, the icon, and the 1920x1080 feature slides.
// Usage: node docs/promo/render.mjs   (set PLAYWRIGHT_MODULE to a playwright index.mjs if it is not resolvable)
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentChat, editor, githubMark, ic, importView, library, picker, settingsView, tabbar } from './ui.mjs';

const playwright = process.env.PLAYWRIGHT_MODULE ?? join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs');
const { chromium } = await import(pathToFileURL(playwright).href);
const root = fileURLToPath(new URL('.', import.meta.url));
const images = join(root, '..', 'images');
const REPO = 'yannelli/paseo-prompt-manager';
const SOCIAL_MAX_BYTES = 1024 * 1024;
const icon = (await readFile(join(root, 'icon.svg'), 'utf8')).replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"');
const ghost = (style) => `<svg class="stack-mark" style="${style}" viewBox="0 0 64 64" aria-hidden="true"><rect x="22" y="4" width="36" height="44" rx="8"/><rect x="14" y="10" width="36" height="44" rx="8"/><rect x="6" y="16" width="36" height="44" rx="8"/></svg>`;

const slides = [
  { name: 'library', kicker: 'prompt library', title: 'Every prompt<br>in <em>one place.</em>', lede: 'Search Markdown prompts by title, tag, or text. Sort them into folders.', width: 1100, zoom: 1.28, body: () => tabbar('Prompts') + library({ rows: 4 }) },
  { name: 'composer', kicker: 'agent composer', title: 'Send a prompt<br><em>in one click.</em>', lede: 'Choose Prompts in the composer bar, search, and send.', width: 1000, zoom: 1.45, body: () => tabbar('Payment retries') + agentChat() },
  { name: 'history', kicker: 'version history', title: 'Every save<br>is a <em>version.</em>', lede: 'Inspect a snapshot as source or preview. Restore it as a new version.', width: 1100, zoom: 1.3, body: () => tabbar('Prompts') + `<div class="panel">${editor({ history: true, expanded: true })}</div>` },
  { name: 'import', kicker: 'import', title: 'Bring your<br><em>Markdown.</em>', lede: 'Import files and folders from this device or the Paseo host.', width: 1000, zoom: 1.3, body: () => tabbar('Prompts') + importView() },
  { name: 'git-sync', kicker: 'git sync', title: 'Back up with<br><em>Git.</em>', lede: 'Commit prompts and history, then fetch, fast-forward, and push.', width: 1000, zoom: 1.3, fit: true, body: () => tabbar('Prompts') + settingsView() },
];

const head = (title, css = 'brand.css') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="${css}"></head>`;
const brand = (size) => `<div class="brand" style="font-size:${size}px">${icon}<div>Prompt Manager <span>/ Paseo</span></div></div>`;
const repoPill = (size) => `<div class="pill" style="font-size:${size}px;padding:${size * .5}px ${size * .9}px">${githubMark(size * 1.1)}${REPO}</div>`;

function bannerPage() {
  return `${head('Prompt Manager banner')}<body class="frame-dark" style="width:1280px;height:640px">
    <div class="dots"></div><div class="halo" style="left:640px;top:40px;width:760px;height:620px"></div>${ghost('right:-60px;top:-40px;width:380px;height:380px')}
    <main class="copy" style="position:absolute;left:72px;top:72px;width:500px;display:flex;flex-direction:column;gap:24px">
      ${brand(24)}
      <h1 style="font-size:72px;margin-top:40px">Your prompts,<br><em>versioned.</em></h1>
      <p class="lede" style="font-size:21px;line-height:1.45;max-width:440px">A Markdown prompt library for Paseo agents, with search, history, and Git sync.</p>
    </main>
    <footer style="position:absolute;left:72px;bottom:60px">${repoPill(14)}</footer>
    <div class="window ui dark" style="left:640px;top:72px;width:1060px;height:760px;transform:scale(.7);transform-origin:0 0">${tabbar('Prompts')}${library({ rows: 4 })}</div>
    <div class="ui dark floating" style="position:absolute;left:600px;top:356px;background:transparent;transform:scale(.82);transform-origin:0 0">
      <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">${picker()}<span class="cpill open" style="background:var(--s1)">${ic('notebook-pen', 14)}Prompts</span></div>
    </div>
  </body></html>`;
}

function slidePage(slide, theme, index) {
  return `${head(slide.kicker, '../brand.css')}<body class="frame-${theme}" style="width:1920px;height:1080px">
    <div class="dots"></div><div class="halo" style="left:-120px;top:120px;width:1400px;height:1100px"></div>${ghost('right:-200px;bottom:-330px;width:560px;height:560px')}
    <header style="position:absolute;left:96px;top:64px;right:96px;display:flex;justify-content:space-between;align-items:center">${brand(30)}<span class="kicker" style="font-size:20px;color:var(--muted)">${String(index + 1).padStart(2, '0')}/${String(slides.length).padStart(2, '0')}</span></header>
    <div class="window ui ${theme}" style="left:${96 / slide.zoom}px;top:${172 / slide.zoom}px;width:${slide.width / slide.zoom}px;${slide.fit ? '' : `height:${960 / slide.zoom}px;`}zoom:${slide.zoom}">${slide.body()}</div>
    <main class="copy" style="position:absolute;left:1290px;top:300px;width:540px;display:flex;flex-direction:column;gap:30px">
      <div class="kicker" style="font-size:22px">${slide.kicker}</div>
      <h1 style="font-size:96px">${slide.title}</h1>
      <p class="lede" style="font-size:30px;line-height:1.4">${slide.lede}</p>
    </main>
    <footer style="position:absolute;left:1290px;bottom:72px">${repoPill(18)}</footer>
  </body></html>`;
}

async function pngSize(file) {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function shoot(tab, htmlPath, html, output, size) {
  await writeFile(htmlPath, html);
  await tab.goto(pathToFileURL(htmlPath).href);
  await tab.evaluate(() => document.fonts.ready);
  const layout = await tab.evaluate(() => {
    const copy = document.querySelector('.copy')?.getBoundingClientRect();
    const blocks = [...document.querySelectorAll('.window, .floating')].map((element) => element.getBoundingClientRect());
    const h1 = document.querySelector('h1');
    return {
      fonts: document.fonts.check('600 80px "Instrument Sans"') && document.fonts.check('400 20px "Instrument Sans"') && document.fonts.check('400 14px "JetBrains Mono"'),
      separated: !copy || blocks.every((rect) => rect.left >= copy.right + 8 || rect.right <= copy.left - 8),
      headlineFits: !h1 || h1.scrollWidth <= h1.clientWidth,
    };
  });
  assert.deepEqual(layout, { fonts: true, separated: true, headlineFits: true }, output);
  await tab.screenshot({ path: output });
  assert.deepEqual(await pngSize(output), size, output);
  const { size: bytes } = await stat(output);
  console.log(`${output.replace(root, '')}: ${size.width}x${size.height}, ${Math.round(bytes / 1024)} KB`);
  return bytes;
}

const browser = await chromium.launch({ headless: true });
try {
  const failures = [];
  const banner = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  banner.on('pageerror', (error) => failures.push(error.message));
  await mkdir(images, { recursive: true });
  const bannerBytes = await shoot(banner, join(root, 'banner.html'), bannerPage(), join(images, 'github-banner.png'), { width: 2560, height: 1280 });
  assert(bannerBytes < SOCIAL_MAX_BYTES, `github-banner.png is ${bannerBytes} bytes; GitHub social previews must be under 1 MB`);

  const iconTab = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await iconTab.setContent(`<body style="margin:0;width:512px;height:512px;display:grid;place-items:center;background:#0f1328;border-radius:0">${icon.replace('<svg ', '<svg width="360" height="360" ')}</body>`);
  await iconTab.screenshot({ path: join(images, 'icon.png') });
  assert.deepEqual(await pngSize(join(images, 'icon.png')), { width: 512, height: 512 });

  if (process.argv.includes('--banner-only')) process.exit(0);
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tab.on('pageerror', (error) => failures.push(error.message));
  for (const theme of ['dark', 'light']) {
    await mkdir(join(root, theme), { recursive: true });
    for (const [index, slide] of slides.entries()) {
      await shoot(tab, join(root, theme, `${slide.name}.html`), slidePage(slide, theme, index), join(root, theme, `${slide.name}.png`), { width: 1920, height: 1080 });
    }
  }
  assert.deepEqual(failures, []);
  await writeFile(join(root, 'index.html'), gallery());
  await tab.setViewportSize({ width: 1600, height: 1200 });
  await tab.goto(pathToFileURL(join(root, 'index.html')).href);
  await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); });
  await tab.screenshot({ path: join(root, 'comparison.png'), fullPage: true });
  for (const theme of ['dark', 'light', 'both']) {
    await tab.locator(`button[data-theme="${theme}"]`).click();
    assert.equal(await tab.locator('figure:visible').count(), theme === 'both' ? slides.length * 2 : slides.length);
  }
  await tab.setViewportSize({ width: 390, height: 844 });
  assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'gallery overflows at phone width');
  console.log('Gallery: theme filters and phone width checked');
} finally {
  await browser.close();
}

function gallery() {
  const figures = slides.flatMap((slide) => ['dark', 'light'].map((theme) =>
    `<figure class="${theme}"><a href="${theme}/${slide.name}.png"><img src="${theme}/${slide.name}.png" alt="${slide.kicker}, ${theme} theme"></a><figcaption>${slide.kicker} · ${theme}</figcaption></figure>`)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prompt Manager promo images</title><link rel="stylesheet" href="brand.css"><style>
    body{overflow:auto;padding:48px;background:var(--ink);color:#f2f3fb}header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;margin-bottom:36px}
    h1{font-size:30px;letter-spacing:-.02em}p{margin:6px 0 0;color:#a3a8c7}nav{display:flex;gap:8px}
    button{border:1px solid rgba(179,169,255,.3);border-radius:999px;background:transparent;color:inherit;padding:10px 18px;font:inherit;cursor:pointer}button[aria-pressed=true]{background:var(--violet);border-color:var(--violet)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}figure{margin:0}img{width:100%;display:block;border-radius:12px;box-shadow:0 0 0 1px rgba(179,169,255,.2)}
    figcaption{padding:10px 0;font:14px 'JetBrains Mono',monospace;color:#a3a8c7}body[data-theme=dark] .light,body[data-theme=light] .dark{display:none}
    @media(max-width:800px){body{padding:16px}.grid{grid-template-columns:1fr}}</style></head>
    <body data-theme="both"><header><div><div class="brand" style="font-size:22px">${icon}<div>Prompt Manager <span>/ Paseo</span></div></div><p>1920 × 1080 · Plugin UI illustrations with sample data</p></div>
    <nav aria-label="Theme"><button data-theme="both" aria-pressed="true">Both</button><button data-theme="dark" aria-pressed="false">Dark</button><button data-theme="light" aria-pressed="false">Light</button></nav></header>
    <main class="grid">${figures}</main>
    <script>document.querySelectorAll('button').forEach((button)=>button.addEventListener('click',()=>{document.body.dataset.theme=button.dataset.theme;document.querySelectorAll('button').forEach((item)=>item.setAttribute('aria-pressed',String(item===button)))}));</script></body></html>`;
}
