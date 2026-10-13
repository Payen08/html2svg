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
- **复制 Figma** defaults to **自适应布局**: native Auto Layout containers and shared Grid tracks keep CSS margins, centered fixed-size icons and the captured viewport. **保持原布局** is also available for fixed-position native layers. **复制 SVG** copies SVG markup separately.
- Text uses PingFang SC. Native Figma copying currently requires the local Vite server on macOS with PingFang installed; static hosting does not provide the local font/proxy endpoints.
- SVG map canvases containing embedded images are preserved as image layers; surrounding text, buttons and layout containers stay editable.

## Validation

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

The PingFang system-font test runs on macOS; other regression tests run independently of that font. Browser fixtures are under `tests/fixtures/`.
