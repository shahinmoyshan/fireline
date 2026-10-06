const assert = require('node:assert/strict');
module.exports = async (page, base) => {
  await page.goto(base + '/esm');
  await page.waitForFunction(() => window.FireLine);
  await page.evaluate(() => {
    FireLine.settings.executeScripts = false;
    document.querySelector('#app > div').insertAdjacentHTML('beforeend', `<section id="partial" x-data="{p: $partial('/fragment')}" x-init="window.browserPartial=p" x-partial="p"></section>`);
  });
  await page.waitForFunction(() => window.browserPartial);
  await page.evaluate(() => browserPartial.load(true));
  assert.equal(await page.locator('#partial p').textContent(), '1');
  assert.equal(await page.evaluate(() => window.partialInits), 1);
  assert.equal(await page.evaluate(() => window.partialScripts), undefined);
  assert.equal(await page.evaluate(() => window.svgScripts), undefined);
  await page.locator('#partial button').click();
  await page.evaluate(() => browserPartial.load());
  assert.equal(await page.locator('#partial button').textContent(), '1');
  await page.evaluate(() => { FireLine.settings.executeScripts = true; return browserPartial.load(true); });
  assert.equal(await page.evaluate(() => window.partialScripts), 1);
  assert.equal(await page.evaluate(() => window.svgScripts), 1);
  assert.equal(await page.evaluate(() => window.partialInits), 2);
  assert.equal(await page.evaluate(() => typeof window.Alpine), 'undefined');
  console.log('PASS browser ESM partials preserve scope, initialize once and honor script controls');

  await page.goto(base);
  await page.waitForFunction(() => window.Alpine?.fire);
  await page.evaluate(async () => {
    FireLine.settings.viewTransitions = true;
    await Alpine.fire.navigate('/scroll-a');
    history.replaceState({...history.state,app:42}, '', location.href);
    scrollTo(0,700);
  });
  await page.waitForFunction(() => scrollY === 700 && history.state?.scroll?.y === 700);
  await page.evaluate(() => Alpine.fire.navigate('/scroll-b#hello%20world'));
  await page.waitForFunction(() => scrollY > 1000);
  // Wait for transitions to finish before manipulating history/scroll again.
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))); scrollTo(0,300); });
  await page.waitForFunction(() => history.state?.scroll?.y === 300);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === '/scroll-a' && scrollY === 700);
  assert.equal(await page.evaluate(() => history.state.app),42);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === '/scroll-b' && scrollY === 300);
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))); });
  console.log('PASS browser view transitions, encoded anchors and back/forward scroll restoration');

  // Isolate full-document navigation from the history/animation scenario.
  // Playwright WebKit 2215 can crash here even with no FireLine (see README).
  const assetPage = await page.context().newPage();
  const assetErrors = [];
  assetPage.on('pageerror', error => assetErrors.push(error.message));
  try {
  // Hover does not reload; consuming its versioned cache navigates to the requested URL.
  await assetPage.goto(base);await assetPage.waitForFunction(() => window.Alpine?.fire);
  let preloads=0,native=0;
  const onRequest = req => {
    if (new URL(req.url()).pathname !== '/versioned') return;
    if (req.headers()['x-fireline-preload']) preloads++;
    if (req.isNavigationRequest()) native++;
  };
  assetPage.on('request',onRequest);
  await assetPage.evaluate(() => {
    FireLine.settings.assetVersion='build-old';
    document.querySelector('#app > div').insertAdjacentHTML('beforeend','<a id="preload" x-preload.hover x-navigate href="/versioned">Versioned</a>');
  });
  const response = assetPage.waitForResponse(r=>new URL(r.url()).pathname==='/versioned');
  await assetPage.locator('#preload').hover();await response;
  await assetPage.waitForFunction(()=>document.querySelector('#preload'));
  assert.equal(new URL(assetPage.url()).pathname,'/');assert.equal(native,0);
  await assetPage.locator('#preload').click();
  await assetPage.waitForSelector('#fresh-assets');
  assert.equal(new URL(assetPage.url()).pathname,'/versioned');assert.equal(preloads,1);assert.equal(native,1);
  assetPage.off('request',onRequest);
  console.log('PASS browser asset mismatch consumes preload via one full navigation to the destination');
  assert.deepEqual(assetErrors, []);
  } finally { await assetPage.close(); }

};
