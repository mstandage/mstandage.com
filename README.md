# mstandage.com

Matthew Standage's personal website. Static HTML, CSS and JavaScript, with no framework, runtime dependencies or build step. The existing `.nojekyll` and `CNAME` (`mstandage.com`) are retained for static hosting. Hosting dashboard settings have not been inspected or changed. Nothing has been deployed.

## Design and files

- `index.html`: original written content with requested spaced en dashes, LinkedIn connection link, semantic editorial structure, Google Fonts and font/icon credits. Twitter and Dribbble were removed by request.
- `assets/css/site.css`: near-black/off-white palette, asymmetric layout, Space Grotesk display type, Source Sans Pro reading type, responsive sizing, focus states and static artwork fallback.
- `assets/js/site.js`: copyright year from the visitor's current JavaScript date, refreshed on page restoration and return to a visible tab. This runs independently of WebGL; with JavaScript disabled, the copyright name remains visible without a stale fixed year.
- `assets/js/background.js`: native WebGL aurora-like interference fields, fine-pointer interaction and animation lifecycle.
- `assets/img/favicon.svg`: off-white M monogram on a violet/blue/teal gradient; source artwork for the 32px PNG, multi-size ICO and 180px Apple touch icon.
- `scripts/generate-favicons.cjs`: regenerate the bitmap and ICO assets from the SVG using the same temporary Playwright tooling as validation.
- `tests/validate.cjs`: browser checks for content preservation, shader rendering, layouts, keyboard operation, motion preferences, fallbacks and automated accessibility.

Original image, font and legacy source assets remain in place. The plain magenta favicon has been replaced by the requested gradient artwork. The new page no longer loads the old production-hosted stylesheet, archived Universal Analytics script, archived site script or Cloudflare email-decoding script. No replacement analytics has been added.

The masthead and numbered section labels are removed. The name is the `h1`; the professional heading, "My approach" and "Contact me" are `h2` headings. The four approach topics use smaller `h3` headings. All headings use Space Grotesk, sentence case (except the name), no trailing colons, and "and" rather than ampersands. The compact LinkedIn link has no bottom rule. The accessible animation pause control remains in the opening section rather than a header.

## Local preview

Opening `index.html` directly works. A local preview server is useful for browser testing:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory "$PWD"
```

Run from the repository root, then visit `http://127.0.0.1:4173`. Choose another port if it is occupied.

## Favicon artwork

Edit the colours or monogram in `assets/img/favicon.svg`, then regenerate the derivatives after installing the validation tooling below:

```sh
NODE_PATH=/tmp/mstandage-validation/node_modules node scripts/generate-favicons.cjs
```

This writes `favicon.png` (32px), `favicon.ico` (16, 32 and 48px) and `apple-touch-icon.png` (180px). The SVG scales natively. Icon declarations include a version query to avoid reusing the previous favicon from cache; increment it when replacing the artwork again.

## Background configuration

Edit `BACKGROUND_CONFIG` at the top of `assets/js/background.js`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `colors.violet`, `colors.blue`, `colors.teal` | Normalized RGB arrays | Shader pigment colours, each channel from 0 to 1 |
| `speed` | `0.12` | Time multiplier |
| `intensity` | `0.65` | Colour luminosity multiplier |
| `interactionStrength` | `0.035` | Pointer displacement multiplier |
| `maxPixelRatio` | `1.5` | Device-pixel-ratio cap |
| `maxResolution` | `1600` | Longest canvas dimension on desktop |
| `mobileMaxResolution` | `800` | Longest canvas dimension at widths of 700px or below |
| `targetFramesPerSecond` | `30` | Maximum drawing frequency |

Smaller screens also skip a secondary interference layer. CSS overlays keep the reading area dark; retain those overlays when changing intensity or colours. Rendering stops when off-screen, hidden, paused or context-lost. The clock freezes while suspended instead of jumping forward on resume. GPU resources and observers are released on non-cached page exit; cached navigation resumes safely.

The pause choice uses local storage key `mstandage-background-paused`. Storage failures are harmless. Reduced motion overrides animation and pointer movement, draws a static frame, and disables the control. No WebGL, shader compilation failure or context loss leaves the static CSS composition visible. The decorative canvas has no pointer events and is hidden from assistive technology.

Space Grotesk requests weights 400 and 500; Source Sans Pro requests 400 and 600. Google Fonts uses `display=optional`: text renders immediately in the fallback stack, and a slow font download cannot cause a late swap. A later navigation can use the cached fonts.

## Validation

There were no existing build, lint, package or test commands. Validation tools are installed separately; they are not website dependencies:

```sh
npm install --prefix /tmp/mstandage-validation --no-audit --no-fund playwright @axe-core/playwright
/tmp/mstandage-validation/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/mstandage-validation/node_modules node tests/validate.cjs
node --check assets/js/site.js
node --check assets/js/background.js
node --check tests/validate.cjs
git diff --check
```

On a managed Mac with certificate-chain errors, prefix the install commands with `NODE_USE_SYSTEM_CA=1` to use the system trust store. Do not disable TLS verification.

The preview server must be running. `PREVIEW_URL` overrides its URL; `ARTIFACT_DIR` overrides the default screenshot/report directory `/tmp/mstandage-validation-artifacts`.

Executed successfully in Chromium:

- SVG, PNG, ICO and Apple touch favicon URLs load and decode; correct square dimensions, three ICO sizes and nonflat gradient PNG pixels.
- Original prose retained with requested spaced en dashes, "and" substitutions, headings extracted from paragraphs and dynamic copyright year (normalized against Git `HEAD`); LinkedIn retained as the sole connection link, with Twitter and Dribbble removed by request.
- Semantic, sentence-case Space Grotesk headings with matching section sizes and smaller subsection sizes; no header, numbered labels, ampersands or LinkedIn bottom rule.
- Source Sans Pro body font, no page-source em dashes, and current copyright year. Simulated future years verify the year is not hard-coded; the year also works without WebGL.
- Actual nonblank WebGL pixels, advancing shader time and fine-pointer response.
- Screenshots and overflow checks at 320, 390, 768, 1440 and 1920px widths; resolution caps and social touch targets.
- Keyboard skip link, visible focus, keyboard pause, saved pause after reload and resume.
- Off-screen suspension and a simulated Page Visibility API change.
- Reduced-motion static frame, disabled pointer response and control.
- Real WebGL context loss/restoration, forced no-WebGL and shader-compilation failure (including resize/media changes).
- JavaScript-disabled content and social links.
- Zero measured initial cumulative layout shift in the tested load.
- No JavaScript page errors; zero axe violations using WCAG A/AA tags through WCAG 2.2 on desktop and the mobile fallback (21 passing rules in the desktop run).
- JavaScript syntax and Git whitespace checks; editor diagnostics report no errors.

This is not a WCAG certification. Screen-reader testing, real-device GPU/battery profiling, Safari/Firefox, actual background-tab OS throttling, every animation-frame contrast combination, and all manual WCAG criteria remain unverified. The hidden-page check simulates the visibility event rather than relying on headless browser tab throttling. Google Fonts requires network access, but system fallbacks remain usable offline.

## Content review flags

These are deliberately unchanged on the page:

- The current Product Design Lead role at Bottomline should be confirmed before publishing.
- The phrase "what uniquely human" in the AI paragraph appears to be missing "is". It has not been corrected because substantive copy must remain unchanged.