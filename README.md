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
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Capture and copy to Figma

- Enter a URL to open the interactive preview, navigate to the desired screen, then capture it. Changing the preview size preserves the current page.
- Use **输入 HTML** to render HTML directly.
- **复制 Figma** copies native editable layers, including Auto Layout containers and shared Grid tracks for tables and CSS grids. **复制 SVG** copies SVG markup separately.
- Text uses PingFang SC. Native Figma copying currently requires the local Vite server on macOS with PingFang installed; static hosting does not provide the local font/proxy endpoints.
- SVG map canvases containing embedded images are preserved as image layers; surrounding text, buttons and layout containers stay editable.

## Validation

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

The PingFang system-font test runs on macOS; other regression tests run independently of that font. Browser fixtures are under `tests/fixtures/`.
