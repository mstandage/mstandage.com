const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const directory = path.resolve(__dirname, '../assets/img');
const artwork = fs.readFileSync(path.join(directory, 'favicon.svg'), 'utf8');

async function generate() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${artwork}`);
    const icons = [];
    for (const size of [16, 32, 48, 180]) {
      await page.setViewportSize({ width: size, height: size });
      const image = await page.screenshot({ omitBackground: true });
      assert.equal(image.readUInt32BE(16), size);
      assert.equal(image.readUInt32BE(20), size);
      if (size === 32) fs.writeFileSync(path.join(directory, 'favicon.png'), image);
      if (size === 180) fs.writeFileSync(path.join(directory, 'apple-touch-icon.png'), image);
      else icons.push({ size, image });
    }

    const header = Buffer.alloc(6 + icons.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(icons.length, 4);
    let offset = header.length;
    icons.forEach(({ size, image }, index) => {
      const entry = 6 + index * 16;
      header[entry] = size;
      header[entry + 1] = size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(image.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += image.length;
    });
    fs.writeFileSync(path.join(directory, 'favicon.ico'), Buffer.concat([header, ...icons.map(icon => icon.image)]));
    console.log('Generated and checked: 32px PNG, 180px Apple touch icon, and 16/32/48px ICO from favicon.svg');
  } finally {
    await browser.close();
  }
}

generate().catch(error => { console.error(error); process.exitCode = 1; });