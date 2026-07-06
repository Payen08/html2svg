export interface ConversionState {
  isLoading: boolean;
  error: string | null;
  svgContent: string | null;
}

export interface HtmlConversionState {
  isLoading: boolean;
  error: string | null;
  htmlContent: string | null;
  cssContent: string | null;
}

export enum ViewMode {
  EDITOR = 'EDITOR',
  PREVIEW = 'PREVIEW',
  SPLIT = 'SPLIT'
}

export enum ConversionMode {
  AI = 'AI',
  LOCAL = 'LOCAL'
}

export enum AppMode {
  HTML_TO_SVG = 'HTML_TO_SVG',
  SVG_TO_HTML = 'SVG_TO_HTML'
}

export enum InputMode {
  HTML = 'HTML',
  URL = 'URL'
}

export enum RenderMode {
  FIGMA = 'FIGMA',           // Figma compatible (standard SVG elements)
  BROWSER = 'BROWSER',       // Browser preview (foreignObject, better for complex sites)
  INTERACTIVE = 'INTERACTIVE' // Interactive preview with manual capture
}

export interface PageItem {
  id: string;
  url: string;
  name: string;
  svgContent: string | null;
  isConverting: boolean;
  error: string | null;
}

export const SAMPLE_SVG = `<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="3" flood-opacity="0.1"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="400" height="200" rx="16" fill="url(#grad1)" filter="url(#shadow)"/>
  <text x="200" y="80" text-anchor="middle" fill="white" font-family="sans-serif" font-size="24" font-weight="bold">Hello World</text>
  <text x="200" y="105" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14" opacity="0.9">Converted to HTML</text>
  <rect x="150" y="125" width="100" height="36" rx="18" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)"/>
  <text x="200" y="148" text-anchor="middle" fill="white" font-family="sans-serif" font-size="12">Click Me</text>
</svg>`;

export const SAMPLE_HTML = `<div style="
  display: flex;
  align-items: center;
  justify-content: center;
  width: 400px;
  height: 200px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  font-family: sans-serif;
  color: white;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
">
  <div style="text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">Hello World</h1>
    <p style="margin-top: 8px; opacity: 0.9;">Converted to SVG</p>
    <button style="
      margin-top: 16px;
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.4);
      border-radius: 20px;
      color: white;
      cursor: pointer;
    ">
      Click Me
    </button>
  </div>
</div>`;