const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

const root = path.resolve(__dirname, '..');
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const artifacts = process.env.ARTIFACT_DIR || '/tmp/mstandage-validation-artifacts';
fs.mkdirSync(artifacts, { recursive: true });
const original = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: root, encoding: 'utf8' });

async function instrument(page) {
  await page.addInitScript(() => {
    window.backgroundTest = { draws: 0, time: 0, pointer: [], samples: [], shifts: 0 };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.backgroundTest.shifts += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      draw.apply(this, args);
      window.backgroundTest.draws++;
      window.backgroundTest.time = this.getUniform(this.getParameter(this.CURRENT_PROGRAM), this.getUniformLocation(this.getParameter(this.CURRENT_PROGRAM), 'time'));
      window.backgroundTest.pointer = Array.from(this.getUniform(this.getParameter(this.CURRENT_PROGRAM), this.getUniformLocation(this.getParameter(this.CURRENT_PROGRAM), 'pointer')));
      const samples = [];
      for (const [horizontal, vertical] of [[0.1, 0.5], [0.8, 0.5], [0.9, 0.8]]) {
        const pixel = new Uint8Array(4);
        this.readPixels(Math.floor(this.drawingBufferWidth * horizontal), Math.floor(this.drawingBufferHeight * vertical), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
        samples.push(Array.from(pixel));
      }
      window.backgroundTest.samples = samples;
    };
  });
}

async function stableFrames(page, label) {
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.backgroundTest.draws);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.backgroundTest.draws);
  assert.equal(after, before, label);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await instrument(page);
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.backgroundTest.draws > 3);
    const preserved = await page.evaluate(html => {
      const old = new DOMParser().parseFromString(html, 'text/html');
      const normalize = text => text.replace(/\u2014/g, ' \u2013 ').replace(/&/g, 'and').replace(/\s+/g, ' ').trim().replace(/^(Copyright \u2013 Matthew Standage) \d{4}$/, '$1');
      old.querySelectorAll('p > strong').forEach(element => element.remove());
      const paragraphs = [...document.querySelectorAll('p')].map(element => normalize(element.textContent));
      const removedLinks = ['https://twitter.com/mstandage', 'https://dribbble.com/mstandage'];
      return {
        copy: [...old.querySelectorAll('p')].every(element => paragraphs.includes(normalize(element.textContent))),
        links: [...old.querySelectorAll('a[href]')].filter(element => !removedLinks.includes(element.getAttribute('href'))).every(element => [...document.querySelectorAll('a[href]')].some(link => link.getAttribute('href') === element.getAttribute('href')))
      };
    }, original);
    assert(preserved.copy && preserved.links, 'Original prose and retained links, allowing requested heading/dash/year/and changes');
    const headings = await page.locator('h1, h2, h3').evaluateAll(elements => elements.map(element => ({ level: element.tagName, text: element.textContent.replace(/\s+/g, ' ').trim(), font: getComputedStyle(element).fontFamily, size: parseFloat(getComputedStyle(element).fontSize) })));
    assert.deepEqual(headings.map(({level, text}) => ({level, text})), [
      { level: 'H1', text: 'MatthewStandage.' },
      { level: 'H2', text: 'Design leader and strategic thinker' },
      { level: 'H2', text: 'My approach' },
      { level: 'H3', text: 'Systems over solutions' },
      { level: 'H3', text: 'Informed by craft' },
      { level: 'H3', text: 'Exploring AI and design' },
      { level: 'H3', text: 'Education and recognition' },
      { level: 'H2', text: 'Contact me' }
    ]);
    assert(headings.every(heading => heading.font.startsWith('"Space Grotesk"')), 'All headings use Space Grotesk');
    assert(headings[2].size === headings[7].size && headings[2].size > headings[4].size, 'Section headings match and exceed subsection size');
    assert.equal(await page.locator('header').count(), 0, 'Header removed');
    assert(await page.locator('body').evaluate(element => !/01\s*\/|02\s*\/|&/.test(element.textContent)), 'No numbered labels or ampersands');
    assert(await page.locator('.social-links li').evaluate(element => getComputedStyle(element).borderBottomStyle === 'none'), 'No rule below LinkedIn');
    assert.deepEqual(await page.locator('.social-links a').evaluateAll(elements => elements.map(element => element.href)), ['https://www.linkedin.com/in/mstandage/']);
    assert(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily.startsWith('"Source Sans Pro"')), 'Source Sans Pro body font');
    assert(!/\u2014|&mdash;|&#8212;|&#x2014;/i.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'No em dashes in page source');
    assert(await page.evaluate(() => document.getElementById('copyright-year').textContent === String(new Date().getFullYear())), 'Current copyright year');
    const initial = await page.evaluate(() => window.backgroundTest);
    assert(initial.shifts < 0.01, `Initial layout shift: ${initial.shifts}`);
    assert(new Set(initial.samples.map(pixel => pixel.join(','))).size > 1, 'Nonblank shader pixel variation');
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.backgroundTest.time)) > initial.time, 'Shader animation advances');
    await page.mouse.move(1200, 300);
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.backgroundTest.pointer)).some(value => Math.abs(value) > 0.001), 'Fine-pointer interaction');
    console.log(`PASS: retained prose; semantic sentence-case Space Grotesk headings; header and numbers removed; compact rule-free LinkedIn; current year; animated shader; initial CLS ${initial.shifts}`);

    for (const [width, height] of [[1440, 1000], [1920, 1080], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => {
        const heading = document.querySelector('h1').getBoundingClientRect();
        const social = [...document.querySelectorAll('.social-links a')].map(element => element.getBoundingClientRect().height);
        return { overflow: document.documentElement.scrollWidth > innerWidth, headingRight: heading.right, width: innerWidth, social, resolution: Math.max(document.querySelector('canvas').width, document.querySelector('canvas').height), openingBottom: document.querySelector('.opening').getBoundingClientRect().bottom, height: innerHeight };
      });
      assert(!layout.overflow && layout.headingRight <= width, `No overflow at ${width}`);
      assert(layout.social.every(height => height >= 44), 'Social touch targets');
      assert(layout.resolution <= (width <= 700 ? 800 : 1600), 'Shader resolution cap');
      await page.screenshot({ path: path.join(artifacts, `layout-${width}.png`), fullPage: true });
      console.log(`PASS: ${width}x${height} layout; opening bottom ${Math.round(layout.openingBottom)}px; resolution ${layout.resolution}px`);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Skip to content');
    assert.equal(await page.locator(':focus').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    assert(await page.evaluate(() => location.hash === '#main'), 'Keyboard skip navigation');
    await page.reload();
    for (let index = 0; index < 2; index++) await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('class'), 'motion-toggle');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'), 'true');
    await stableFrames(page, 'Paused rendering');
    await page.reload();
    assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'), 'true');
    await stableFrames(page, 'Pause choice persists after reload');
    await page.locator('.motion-toggle').click();
    await page.waitForTimeout(250);
    assert((await page.evaluate(() => window.backgroundTest.draws)) > 2, 'Resume rendering');
    await page.locator('#elsewhere').scrollIntoViewIfNeeded();
    await stableFrames(page, 'Off-screen rendering suspended');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await stableFrames(page, 'Visibility-change rendering suspended');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    console.log('PASS: keyboard focus and pause control; persisted pause; resume; off-screen and simulated hidden-page suspension');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.motion-toggle').disabled);
    assert(await page.locator('.motion-toggle').isDisabled(), 'Reduced-motion animation control disabled');
    await stableFrames(page, 'Reduced-motion composition is static');
    assert.deepEqual(await page.evaluate(() => window.backgroundTest.pointer), [0, 0]);
    await page.mouse.move(800, 250);
    await stableFrames(page, 'Reduced-motion pointer does not render');
    await page.screenshot({ path: path.join(artifacts, 'reduced-motion.png') });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.contextLossTest = document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
      window.contextLossTest.loseContext();
    });
    await page.waitForFunction(() => !document.querySelector('canvas').classList.contains('ready'));
    assert(await page.locator('.motion-toggle').isHidden(), 'Context-loss fallback control');
    await stableFrames(page, 'Context-loss rendering suspended');
    await page.evaluate(() => window.contextLossTest.restoreContext());
    await page.waitForFunction(() => document.querySelector('canvas').classList.contains('ready'));
    console.log('PASS: reduced motion; static pointer; WebGL context loss and restoration');

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    fs.writeFileSync(path.join(artifacts, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
    assert.equal(accessibility.violations.length, 0, JSON.stringify(accessibility.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))));
    assert.equal(errors.length, 0, `Browser JavaScript errors: ${errors}`);
    console.log(`PASS: automated WCAG checks (${accessibility.passes.length} rules); no page errors`);
    await context.close();

    const yearContext = await browser.newContext();
    const yearPage = await yearContext.newPage();
    await yearPage.clock.setFixedTime(new Date('2031-06-01T12:00:00'));
    await yearPage.goto(url);
    assert.equal(await yearPage.locator('#copyright-year').textContent(), '2031');
    await yearPage.clock.setFixedTime(new Date('2032-01-01T12:00:00'));
    await yearPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await yearPage.locator('#copyright-year').textContent(), '2032');
    await yearContext.close();
    console.log('PASS: dynamic copyright with simulated future years and return-to-page refresh');

    const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const fallback = await fallbackContext.newPage();
    await fallback.addInitScript(() => {
      const originalContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl' ? null : originalContext.call(this, type, ...args); };
    });
    await fallback.goto(url);
    await fallback.evaluate(() => document.fonts.ready);
    await fallback.locator('.opening-content').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    assert(await fallback.locator('.motion-toggle').isHidden());
    assert(await fallback.locator('.stand-first').isVisible());
    assert(await fallback.evaluate(() => document.getElementById('copyright-year').textContent === String(new Date().getFullYear())), 'Copyright year independent of WebGL');
    assert(await fallback.locator('.artwork').evaluate(element => getComputedStyle(element).backgroundImage.includes('radial-gradient')));
    await fallback.screenshot({ path: path.join(artifacts, 'webgl-fallback.png'), fullPage: true });
    const fallbackAudit = await new AxeBuilder({ page: fallback }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.equal(fallbackAudit.violations.length, 0, 'Fallback mobile accessibility');
    await fallbackContext.close();

    const failedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const failed = await failedContext.newPage();
    const failureErrors = [];
    failed.on('pageerror', error => failureErrors.push(error.message));
    await failed.addInitScript(() => {
      const shaderParameter = WebGLRenderingContext.prototype.getShaderParameter;
      WebGLRenderingContext.prototype.getShaderParameter = function (shader, parameter) {
        return parameter === this.COMPILE_STATUS ? false : shaderParameter.call(this, shader, parameter);
      };
    });
    await failed.goto(url);
    await failed.setViewportSize({ width: 320, height: 740 });
    await failed.emulateMedia({ reducedMotion: 'reduce' });
    await failed.waitForTimeout(200);
    assert(await failed.locator('.motion-toggle').isHidden());
    assert(await failed.locator('.stand-first').isVisible());
    assert.equal(failureErrors.length, 0, 'Shader compilation failure stays safe during resize and reduced-motion changes');
    await failedContext.close();

    const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const noScript = await noScriptContext.newPage();
    await noScript.goto(url);
    assert(await noScript.locator('.stand-first').isVisible());
    assert(await noScript.locator('.motion-toggle').isHidden());
    assert.equal(await noScript.locator('.social-links a').count(), 1);
    assert.equal(await noScript.locator('#copyright-year').textContent(), '');
    await noScript.screenshot({ path: path.join(artifacts, 'no-javascript.png'), fullPage: true });
    await noScriptContext.close();
    console.log(`PASS: WebGL and shader-compilation fallbacks; mobile automated accessibility; JavaScript-disabled content. Screenshots: ${artifacts}`);
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });