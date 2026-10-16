<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1rIVo2rGZHZvb5hFsAdC-Q8tsoex8kQIr

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

Local conversion and page capture do not require an API key. For AI conversion, create `.env.local` in the project root and set `VITE_GEMINI_API_KEY` to your Gemini API key, then restart the development server. The legacy `GEMINI_API_KEY` name is also supported; `VITE_GEMINI_API_KEY` takes precedence when both are set. Missing keys are reported when AI conversion is requested and do not prevent the app from opening.

## Capture and copy to Figma

- Enter a URL to open the interactive preview, navigate to the desired screen, then capture it. Changing the preview size preserves the current page.
- The interactive preview fits the full viewport initially. Use the zoom buttons, **100%**, or **适应窗口** to change the display scale. Scroll to reach enlarged content; enable **拖动画布** to pan, then switch it off to interact with the page. Ctrl/⌘ + wheel also zooms. Display zoom does not change capture dimensions.
- Use **输入 HTML** to render HTML directly.
- **复制 Figma** copies native editable layers, including Auto Layout containers and shared Grid tracks for tables and CSS grids. **复制 SVG** copies SVG markup separately.
- Text uses PingFang SC. Native Figma copying requires macOS with PingFang installed, using either the desktop application or the local Vite server; static hosting does not provide the local font/proxy endpoints.
- SVG map canvases containing embedded images are preserved as image layers; surrounding text, buttons and layout containers stay editable.

## Validation

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

The PingFang system-font test runs on macOS; other regression tests run independently of that font. Browser fixtures are under `tests/fixtures/`.

## Mac desktop app

Apple Silicon (M1/M2/M3/M4 and later):

```sh
npm ci
npm run desktop:dmg
```

The installer is written to `release/HTML2SVG-Artboard-0.1.3-mac-arm64.dmg`. Open it and drag **HTML2SVG Artboard** to **Applications**. The application includes Chromium, the compiled UI, local proxy and font service; Node.js and a separate development server are not required. HTML rendering, SVG export and Figma copying work locally; remote page capture requires access to the target network.

`npm run desktop:dev` builds and launches the packaged app. `npm run desktop:pack` creates the `.app` without a disk image. `node scripts/build-icon.mjs` regenerates the icon from `assets/logo.png`.

The current local build uses an ad-hoc signature and is not notarized with an Apple Developer certificate. No development `.env` secrets or system font files are embedded in the installer. AI conversion requires a separately configured API key and is not configured in this desktop build.

Figma copying defaults to **自适应布局** for native Auto Layout/Grid. Choose **保持原布局** when exact captured coordinates are required. Open native dialogs and popovers are frozen with their visible styles, backdrop and screen position; filled form fields retain their current visible text. Native single-select fields export only their selected label and dropdown arrow; native checkboxes/radio buttons export editable state vectors. Both web and Mac builds share the same conversion service.

Capture and export retain the originating page’s proxy prefix for root-relative image URLs, including Chinese filenames and dynamically assigned absolute URLs. Asset lookup does not use another tab’s target.
