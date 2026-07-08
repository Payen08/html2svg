import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Code, Github, Zap, Cpu, Settings2, Box, ArrowRightLeft, Upload, FileCode2, Globe, Link, FolderOpen, Plus, X, Layers, Loader2, CheckCircle, AlertCircle, Download, Maximize2 } from 'lucide-react';
import { Button } from './components/Button';
import { SvgPreview } from './components/SvgPreview';
import { HtmlPreview } from './components/HtmlPreview';
import { convertHtmlToSvg } from './services/geminiService';
import { convertHtmlToSvgLocal, convertSvgToHtmlLocal } from './services/localService';
import { exportToFigmaJSON } from './services/figmaExportService';
import { fetchUrlContent } from './services/urlFetchService';
import { convertUrlToSvgWithForeignObject } from './services/urlScreenshotService';
import { createInteractiveCapture, InteractiveCaptureHandle } from './services/interactiveCaptureService';
import { SAMPLE_HTML, SAMPLE_SVG, ConversionState, HtmlConversionState, ViewMode, ConversionMode, AppMode, InputMode, RenderMode, PageItem } from './types';

function App() {
  // App Mode: HTML→SVG or SVG→HTML
  const [appMode, setAppMode] = useState<AppMode>(AppMode.HTML_TO_SVG);

  // HTML→SVG state
  const [inputHtml, setInputHtml] = useState<string>(SAMPLE_HTML);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.HTML);
  const [renderMode, setRenderMode] = useState<RenderMode>(RenderMode.BROWSER);
  const [conversionMode, setConversionMode] = useState<ConversionMode>(ConversionMode.LOCAL);
  const [optimize, setOptimize] = useState<boolean>(false);
  const [rasterizeText, setRasterizeText] = useState<boolean>(false); // New Option
  const [isUrlFetching, setIsUrlFetching] = useState<boolean>(false);
  const [svgState, setSvgState] = useState<ConversionState>({
    isLoading: false,
    error: null,
    svgContent: null,
  });

  // SVG→HTML state
  const [inputSvg, setInputSvg] = useState<string>(SAMPLE_SVG);
  const [svg2htmlMode, setSvg2htmlMode] = useState<ConversionMode>(ConversionMode.LOCAL);
  const [htmlState, setHtmlState] = useState<HtmlConversionState>({
    isLoading: false,
    error: null,
    htmlContent: null,
    cssContent: null,
  });

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.SPLIT);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const htmlFileInputRef = useRef<HTMLInputElement>(null);
  // Store the directory path/base URL for local file resolution
  const [localFileBaseUrl, setLocalFileBaseUrl] = useState<string>('');

  // Multi-page state
  const [pages, setPages] = useState<PageItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // Interactive capture state
  const interactiveRef = useRef<InteractiveCaptureHandle | null>(null);
  const interactiveContainerRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isInteractiveReady, setIsInteractiveReady] = useState(false);
  const [interactiveError, setInteractiveError] = useState<string | null>(null);
  const [interactiveSessionKey, setInteractiveSessionKey] = useState(0);
  const captureCountRef = useRef(0);
  const [isFigmaExporting, setIsFigmaExporting] = useState(false);
  const [viewportW, setViewportW] = useState(1440);
  const [viewportH, setViewportH] = useState(900);
  const [isViewportCustom, setIsViewportCustom] = useState(false);

  // Resizable panel state
  const [leftPanelRatio, setLeftPanelRatio] = useState(50); // percentage
  const isDraggingDivider = useRef(false);

  // HTML→SVG conversion
  const handleHtmlToSvg = async () => {
    try {
      // If URL mode, first fetch the HTML
      let htmlToConvert = inputHtml;
      let fetchedUrl = '';

      if (inputMode === InputMode.URL) {
        if (!inputUrl.trim()) return;

        setIsUrlFetching(true);
        setSvgState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
          const result = await fetchUrlContent(inputUrl);
          htmlToConvert = result.html;
          fetchedUrl = result.url;
          setInputHtml(result.html); // Also populate the HTML textarea
        } catch (err: any) {
          setSvgState({
            isLoading: false,
            error: err.message || "无法获取网页内容",
            svgContent: null
          });
          setIsUrlFetching(false);
          return;
        }
        setIsUrlFetching(false);
      } else {
        if (!htmlToConvert.trim()) return;
        setSvgState(prev => ({ ...prev, isLoading: true, error: null }));
      }

      let svg = '';

      if (conversionMode === ConversionMode.AI) {
        svg = await convertHtmlToSvg(htmlToConvert, optimize);
      } else {
        // LOCAL Mode logic
        let effectiveBaseUrl = fetchedUrl || localFileBaseUrl || '';
        let directUrl: string | undefined;

        // For localhost URLs in FIGMA mode, use our Vite proxy to eliminate
        // cross-origin issues (iframe loads all resources through same origin).
        if (inputMode === InputMode.URL && fetchedUrl) {
          try {
            const fetchedParsed = new URL(fetchedUrl);
            const isLocal = ['localhost', '127.0.0.1'].includes(fetchedParsed.hostname);
            if (isLocal && fetchedParsed.port) {
              const proxyBase = `/proxy/${fetchedParsed.port}`;
              // Build the full proxy URL preserving the original path
              const originalPath = fetchedParsed.pathname || '/';
              directUrl = `${proxyBase}${originalPath}`;
              effectiveBaseUrl = `${proxyBase}/`;

              // Rewrite absolute paths (e.g. /app.js → /proxy/5173/app.js)
              // so they also go through our proxy. Relative paths are handled
              // by the <base> tag injected in convertHtmlToSvgLocal.
              htmlToConvert = htmlToConvert
                // Remove any existing <base> tags (we'll add our own)
                .replace(/<base\b[^>]*\/?>/gi, '')
                // Rewrite absolute paths in src/href starting with /
                .replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${proxyBase}/`);
            }
          } catch { /* keep original URL if parsing fails */ }
        }

        if (inputMode === InputMode.URL && renderMode === RenderMode.BROWSER && fetchedUrl) {
          // Browser High-Fidelity Mode (foreignObject) - Best for complex sites, not for Figma
          svg = await convertUrlToSvgWithForeignObject(htmlToConvert, fetchedUrl);
        } else {
          // Figma Compatible Mode (standard elements) - Best for Figma import
          // For localhost URLs, pass directUrl to load via iframe.src (SPA support)
          // For other cases, pass effectiveBaseUrl to resolve relative links via srcdoc
          svg = await convertHtmlToSvgLocal(htmlToConvert, optimize, effectiveBaseUrl, rasterizeText, directUrl);
        }
      }

      setSvgState({
        isLoading: false,
        error: null,
        svgContent: svg
      });
    } catch (err: any) {
      console.error(err);
      setSvgState({
        isLoading: false,
        error: err.message || "An unexpected error occurred",
        svgContent: null
      });
    }
  };

  // Export Figma Design JSON
  const handleExportFigmaJSON = async () => {
    try {
      let htmlToConvert = inputHtml;
      let fetchedUrl = '';

      if (inputMode === InputMode.URL) {
        if (!inputUrl.trim()) return;
        setIsFigmaExporting(true);

        try {
          const result = await fetchUrlContent(inputUrl);
          htmlToConvert = result.html;
          fetchedUrl = result.url;
        } catch (err: any) {
          alert('无法获取网页内容: ' + (err.message || '未知错误'));
          setIsFigmaExporting(false);
          return;
        }
      } else {
        if (!htmlToConvert.trim()) return;
        setIsFigmaExporting(true);
      }

      let effectiveBaseUrl = fetchedUrl || localFileBaseUrl || '';
      let directUrl: string | undefined;

      // Proxy logic for localhost URLs (same as handleHtmlToSvg)
      if (inputMode === InputMode.URL && fetchedUrl) {
        try {
          const fetchedParsed = new URL(fetchedUrl);
          const isLocal = ['localhost', '127.0.0.1'].includes(fetchedParsed.hostname);
          if (isLocal && fetchedParsed.port) {
            const proxyBase = `/proxy/${fetchedParsed.port}`;
            const originalPath = fetchedParsed.pathname || '/';
            directUrl = `${proxyBase}${originalPath}`;
            effectiveBaseUrl = `${proxyBase}/`;
            htmlToConvert = htmlToConvert
              .replace(/<base\b[^>]*\/?>/gi, '')
              .replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${proxyBase}/`);
          }
        } catch { /* keep original URL if parsing fails */ }
      }

      const figmaData = await exportToFigmaJSON(htmlToConvert, effectiveBaseUrl, directUrl);

      // Download JSON file
      const jsonStr = JSON.stringify(figmaData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'figma-design.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Figma JSON export failed:', err);
      alert('导出失败: ' + (err.message || '未知错误'));
    } finally {
      setIsFigmaExporting(false);
    }
  };

  // SVG→HTML conversion
  const handleSvgToHtml = async () => {
    if (!inputSvg.trim()) return;

    setHtmlState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      let result: { html: string; css: string };
      if (svg2htmlMode === ConversionMode.LOCAL) {
        result = await convertSvgToHtmlLocal(inputSvg);
      } else {
        // Fallback to local if API mode selected
        result = await convertSvgToHtmlLocal(inputSvg);
      }
      setHtmlState({
        isLoading: false,
        error: null,
        htmlContent: result.html,
        cssContent: result.css,
      });
    } catch (err: any) {
      console.error(err);
      setHtmlState({
        isLoading: false,
        error: err.message || "An unexpected error occurred",
        htmlContent: null,
        cssContent: null,
      });
    }
  };

  // Handle HTML file upload for local files
  const handleHtmlFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Accept .html and .htm files
    if (!file.name.match(/\.html?$/i)) {
      alert('请选择 .html 或 .htm 文件');
      if (htmlFileInputRef.current) {
        htmlFileInputRef.current.value = '';
      }
      return;
    }

    try {
      const content = await file.text();
      setInputHtml(content);

      // Try to get the file's directory path for resolving relative resources
      // Modern browsers may expose the path via webkitRelativePath
      if ('webkitRelativePath' in file && file.webkitRelativePath) {
        // File was selected via directory picker - we have the relative path
        const dirPath = file.webkitRelativePath.substring(0, file.webkitRelativePath.lastIndexOf('/') + 1);
        setLocalFileBaseUrl(dirPath || '');
      } else {
        // For single file pick, try to get the full path via File System Access API
        // or use a file:// fallback if the browser supports it
        setLocalFileBaseUrl('');
      }

      // Auto-switch to HTML input mode to show the content
      setInputMode(InputMode.HTML);
    } catch (err: any) {
      console.error('Failed to read HTML file:', err);
      alert('无法读取文件: ' + err.message);
    }

    // Reset input
    if (htmlFileInputRef.current) {
      htmlFileInputRef.current.value = '';
    }
  };

  // Handle drag and drop
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setInputSvg(content);
      };
      reader.readAsText(file);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setInputSvg(content);
    } catch (err: any) {
      console.error('Failed to read SVG file:', err);
      alert('无法读取 SVG 文件: ' + err.message);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Multi-page management functions
  const addPage = () => {
    const url = inputUrl.trim();
    if (!url) return;
    // Avoid duplicate URLs
    if (pages.some(p => p.url === url)) return;

    // Auto-generate name from URL
    let name = url;
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        name = pathParts[pathParts.length - 1].replace(/\.[^.]+$/, '');
      } else {
        name = parsed.hostname;
      }
    } catch {
      // Use full URL as name if parsing fails
      const parts = url.split('/');
      name = parts[parts.length - 1] || url;
    }

    const newPage: PageItem = {
      id: Date.now().toString(),
      url,
      name,
      svgContent: null,
      isConverting: false,
      error: null,
    };
    setPages(prev => [...prev, newPage]);
    setInputUrl('');
  };

  const removePage = (id: string) => {
    setPages(prev => prev.filter(p => p.id !== id));
    if (activePageId === id) {
      setActivePageId(null);
    }
  };

  const updatePageName = (id: string, newName: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
  };

  const handleBatchConvert = async () => {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page.svgContent) continue; // Skip already converted pages

      // Set converting state
      setPages(prev => prev.map(p => p.id === page.id ? { ...p, isConverting: true, error: null } : p));
      setActivePageId(page.id);

      try {
        // Fetch HTML content
        const result = await fetchUrlContent(page.url);
        let htmlToConvert = result.html;
        const fetchedUrl = result.url;

        let effectiveBaseUrl = fetchedUrl;
        let directUrl: string | undefined;

        // Proxy logic for localhost URLs (same as handleHtmlToSvg)
        try {
          const fetchedParsed = new URL(fetchedUrl);
          const isLocal = ['localhost', '127.0.0.1'].includes(fetchedParsed.hostname);
          if (isLocal && fetchedParsed.port) {
            const proxyBase = `/proxy/${fetchedParsed.port}`;
            const originalPath = fetchedParsed.pathname || '/';
            directUrl = `${proxyBase}${originalPath}`;
            effectiveBaseUrl = `${proxyBase}/`;
            htmlToConvert = htmlToConvert
              .replace(/<base\b[^>]*\/?>/gi, '')
              .replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${proxyBase}/`);
          }
        } catch { /* keep original URL if parsing fails */ }

        // Convert using local renderer (Figma mode)
        const svg = await convertHtmlToSvgLocal(htmlToConvert, optimize, effectiveBaseUrl, rasterizeText, directUrl);

        setPages(prev => prev.map(p => p.id === page.id ? { ...p, svgContent: svg, isConverting: false } : p));
      } catch (err: any) {
        setPages(prev => prev.map(p => p.id === page.id ? {
          ...p,
          isConverting: false,
          error: err.message || '转换失败',
        } : p));
      }
    }
  };

  // Batch download all converted SVGs
  const handleBatchDownload = () => {
    const convertedPages = pages.filter(p => p.svgContent);
    if (convertedPages.length === 0) return;

    convertedPages.forEach((page) => {
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
      const encoder = new TextEncoder();
      const svgBytes = encoder.encode(page.svgContent!);
      const combinedBytes = new Uint8Array(bom.length + svgBytes.length);
      combinedBytes.set(bom);
      combinedBytes.set(svgBytes, bom.length);

      const blob = new Blob([combinedBytes], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${page.name || 'page'}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  };

  // Start interactive preview: set mode, useEffect creates iframe after DOM ready
  const pendingInteractiveUrlRef = useRef<string>('');
  const forceAutoViewportRef = useRef(false);

  const getInteractiveProxyInfo = (url: string) => {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { finalUrl: url, baseUrl: '' };
    }

    if (['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.port) {
      const proxyPrefix = `/proxy/${parsed.port}`;
      return {
        finalUrl: `${proxyPrefix}${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`,
        baseUrl: `${proxyPrefix}/`,
      };
    }

    const encodedOrigin = encodeURIComponent(parsed.origin);
    const proxyPrefix = `/proxy-url/${encodedOrigin}`;
    return {
      finalUrl: `${proxyPrefix}${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`,
      baseUrl: `${proxyPrefix}/`,
    };
  };

  const normalizeCapturedPageUrl = (capturedUrl: string) => {
    if (!capturedUrl) return inputUrl;

    try {
      const parsed = new URL(capturedUrl, window.location.origin);
      const proxyUrlMatch = parsed.pathname.match(/^\/proxy-url\/([^/]+)(\/.*)?$/);
      if (proxyUrlMatch) {
        const origin = decodeURIComponent(proxyUrlMatch[1]);
        return `${origin}${proxyUrlMatch[2] || '/'}${parsed.search}${parsed.hash}`;
      }

      const proxyMatch = parsed.pathname.match(/^\/proxy\/(\d+)(\/.*)?$/);
      if (proxyMatch) {
        return `http://localhost:${proxyMatch[1]}${proxyMatch[2] || '/'}${parsed.search}${parsed.hash}`;
      }
      return parsed.href;
    } catch {
      return capturedUrl;
    }
  };

  const clampViewportSize = (value: number) => {
    if (!Number.isFinite(value)) return 320;
    return Math.max(320, Math.min(2560, Math.round(value)));
  };

  const getDefaultInteractiveViewport = () => {
    const rect = interactiveContainerRef.current?.getBoundingClientRect();
    return {
      width: clampViewportSize(rect?.width || window.innerWidth || viewportW),
      height: clampViewportSize(rect?.height || window.innerHeight || viewportH),
    };
  };

  const handleViewportWChange = (value: string) => {
    setIsViewportCustom(true);
    setViewportW(clampViewportSize(Number(value)));
  };

  const handleViewportHChange = (value: string) => {
    setIsViewportCustom(true);
    setViewportH(clampViewportSize(Number(value)));
  };

  const startInteractivePreview = (forceAutoViewport = false) => {
    if (!inputUrl.trim()) return;
    setInteractiveError(null);
    setIsInteractiveReady(false);
    if (forceAutoViewport) {
      forceAutoViewportRef.current = true;
      setIsViewportCustom(false);
    }

    // Normalize URL
    let url = inputUrl.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) {
      url = 'http://' + url;
    }
    pendingInteractiveUrlRef.current = url;

    // Clean up previous
    stopInteractivePreview();

    // Set mode — useEffect will create iframe after container renders
    setInteractiveSessionKey(prev => prev + 1);
    setRenderMode(RenderMode.INTERACTIVE);
  };

  // useEffect: create interactive iframe AFTER the container div is in the DOM
  useEffect(() => {
    if (renderMode !== RenderMode.INTERACTIVE) return;
    if (!pendingInteractiveUrlRef.current) return;

    const url = pendingInteractiveUrlRef.current;

    // Small delay to ensure React has flushed the DOM
    const timer = setTimeout(() => {
      if (!interactiveContainerRef.current) return;
      setIsInteractiveReady(false);

      // Route localhost and private IP URLs through our same-origin proxy.
      let finalUrl = url;
      let baseUrl = '';
      try {
        ({ finalUrl, baseUrl } = getInteractiveProxyInfo(url));
      } catch { /* keep original */ }

      const shouldUseAutoViewport = forceAutoViewportRef.current || !isViewportCustom;
      forceAutoViewportRef.current = false;

      const viewport = shouldUseAutoViewport
        ? getDefaultInteractiveViewport()
        : { width: viewportW, height: viewportH };

      if (shouldUseAutoViewport) {
        setIsViewportCustom(false);
        setViewportW(viewport.width);
        setViewportH(viewport.height);
      }

      const handle = createInteractiveCapture(finalUrl, baseUrl, viewport.width, viewport.height);
      interactiveRef.current = handle;

      interactiveContainerRef.current.innerHTML = '';
      interactiveContainerRef.current.appendChild(handle.iframe);
      setIsInteractiveReady(true);
    }, 100);

    return () => clearTimeout(timer);
  }, [renderMode, interactiveSessionKey]);

  // Capture the current interactive iframe state as SVG
  const handleInteractiveCapture = async () => {
    setIsCapturing(true);
    try {
      let svg: string;
      let name: string;
      let capturedUrl = inputUrl;

      if (interactiveRef.current) {
        try {
          const result = await interactiveRef.current.capture();
          svg = result.svg;
          capturedUrl = normalizeCapturedPageUrl(result.url || interactiveRef.current.getCurrentUrl());
          captureCountRef.current++;
          name = `Capture ${captureCountRef.current}`;
        } catch (iframeErr: any) {
          throw new Error(`交互捕获失败: ${iframeErr.message || '无法读取当前页面'}`);
        }
      } else {
        // No interactive iframe — server-side fetch
        const result = await fetchUrlContent(inputUrl);
        svg = await convertHtmlToSvgLocal(result.html, false, result.url);
        capturedUrl = result.url;
        captureCountRef.current++;
        name = `Page ${captureCountRef.current}`;
      }

      const pageId = Date.now().toString();
      const newPage: PageItem = {
        id: pageId, url: capturedUrl, name,
        svgContent: svg, isConverting: false, error: null,
      };
      setPages(prev => [...prev, newPage]);
      setActivePageId(pageId);
      setSvgState(prev => ({ ...prev, svgContent: svg }));
      setInteractiveError(null);
      setRenderMode(RenderMode.BROWSER);
    } catch (err: any) {
      console.error('Capture failed:', err);
      const message = err.message || '捕获失败';
      setInteractiveError(message);
      setSvgState(prev => ({ ...prev, error: message }));
    } finally {
      setIsCapturing(false);
    }
  };

  // Cleanup interactive iframe when switching away
  const stopInteractivePreview = () => {
    if (interactiveRef.current) {
      interactiveRef.current.destroy();
      interactiveRef.current = null;
    }
    setIsInteractiveReady(false);
  };

  // Resizable panel divider handlers
  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    document.addEventListener('mousemove', handleDividerMouseMove);
    document.addEventListener('mouseup', handleDividerMouseUp);
  };

  const handleDividerMouseMove = (e: MouseEvent) => {
    if (!isDraggingDivider.current) return;
    const mainEl = document.querySelector('main');
    if (!mainEl) return;
    const rect = mainEl.getBoundingClientRect();
    const ratio = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPanelRatio(Math.max(25, Math.min(75, ratio)));
  };

  const handleDividerMouseUp = () => {
    isDraggingDivider.current = false;
    document.removeEventListener('mousemove', handleDividerMouseMove);
    document.removeEventListener('mouseup', handleDividerMouseUp);
  };

  const isHtmlToSvg = appMode === AppMode.HTML_TO_SVG;
  const currentColor = isHtmlToSvg
    ? (conversionMode === ConversionMode.AI ? 'indigo' : 'emerald')
    : 'amber';

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg transition-colors bg-${currentColor}-600`}>
            <Box className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-gray-100 to-gray-400 bg-clip-text text-transparent">
              {isHtmlToSvg ? 'HTML2SVG' : 'SVG2HTML'} <span className={`text-${currentColor}-400`}>
                {isHtmlToSvg ? 'Artboard' : 'Design2Code'}
              </span>
            </h1>
            <p className="text-xs text-gray-400">
              {isHtmlToSvg
                ? (conversionMode === ConversionMode.AI ? 'AI Vector Generation' : 'Figma-Compatible Local Renderer')
                : 'AI-Powered Design to Code'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* App Mode Toggle */}
          <div className="flex bg-gray-800 p-1 rounded-lg">
            <button
              onClick={() => setAppMode(AppMode.HTML_TO_SVG)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${isHtmlToSvg
                ? 'bg-gray-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>HTML→SVG</span>
            </button>
            <button
              onClick={() => setAppMode(AppMode.SVG_TO_HTML)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!isHtmlToSvg
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>SVG→HTML</span>
            </button>
          </div>

          <a
            href="#"
            className="text-gray-400 hover:text-white transition-colors"
            title="View on GitHub"
          >
            <Github className="w-5 h-5" />
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* Left Panel: Input Editor */}
        <div
          className={`flex flex-col border-r border-gray-800 bg-gray-900/30 overflow-hidden ${viewMode === ViewMode.SPLIT ? '' : 'hidden'}`}
          style={viewMode === ViewMode.SPLIT ? { width: `${leftPanelRatio}%`, minWidth: 280 } : undefined}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <div className="flex items-center space-x-2 text-gray-300">
              {isHtmlToSvg ? <Code className="w-4 h-4" /> : <FileCode2 className="w-4 h-4" />}
              <span className="text-sm font-medium">
                {isHtmlToSvg ? (inputMode === InputMode.URL ? 'Input URL' : 'Input HTML / CSS') : 'Input SVG'}
              </span>

              {/* URL/HTML Toggle - only for HTML→SVG */}
              {isHtmlToSvg && (
                <div className="flex bg-gray-800 p-0.5 rounded ml-2">
                  <button
                    onClick={() => setInputMode(InputMode.HTML)}
                    className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-all ${inputMode === InputMode.HTML
                      ? 'bg-gray-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                      }`}
                  >
                    <Code className="w-3 h-3" />
                    <span>HTML</span>
                  </button>
                  <button
                    onClick={() => setInputMode(InputMode.URL)}
                    className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-all ${inputMode === InputMode.URL
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                      }`}
                  >
                    <Globe className="w-3 h-3" />
                    <span>URL</span>
                  </button>
                </div>
              )}

              {/* Local File Upload Button - only for HTML→SVG */}
              {isHtmlToSvg && (
                <div className="ml-2">
                  <input
                    ref={htmlFileInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    onChange={handleHtmlFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => htmlFileInputRef.current?.click()}
                    className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-all text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                    title="选择本地 HTML 文件"
                  >
                    <FolderOpen className="w-3 h-3" />
                    <span>本地文件</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mode Toggle - only for HTML→SVG */}
            {isHtmlToSvg ? (
              <div className="flex items-center space-x-4">
                {/* Render Mode Toggle (Figma vs Browser) */}
                {conversionMode === ConversionMode.LOCAL && (
                  <div className="flex bg-gray-800 p-1 rounded-lg">
                    <button
                      onClick={() => { stopInteractivePreview(); setRenderMode(RenderMode.BROWSER); }}
                      className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${renderMode === RenderMode.BROWSER
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                        }`}
                      title="High Fidelity (foreignObject) - Best for viewing"
                    >
                      <Globe className="w-3 h-3" />
                      <span>Browser View</span>
                    </button>
                    <button
                      onClick={() => { stopInteractivePreview(); setRenderMode(RenderMode.FIGMA); }}
                      className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${renderMode === RenderMode.FIGMA
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                        }`}
                      title="Figma Compatible (Standard SVG) - Best for export"
                    >
                      <Box className="w-3 h-3" />
                      <span>Figma SVG</span>
                    </button>
                    <button
                      onClick={() => startInteractivePreview()}
                      className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${renderMode === RenderMode.INTERACTIVE
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                        }`}
                      title="Interactive Preview - Click around to navigate, then capture each state"
                    >
                      <Globe className="w-3 h-3" />
                      <span>交互捕获</span>
                    </button>
                  </div>
                )}

                <div className="h-4 w-px bg-gray-700"></div>

                <div className="flex bg-gray-800 p-1 rounded-lg">
                  <button
                    onClick={() => setConversionMode(ConversionMode.LOCAL)}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${conversionMode === ConversionMode.LOCAL
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                      }`}
                  >
                    <Zap className="w-3 h-3" />
                    <span>Local</span>
                  </button>
                  <button
                    onClick={() => setConversionMode(ConversionMode.AI)}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${conversionMode === ConversionMode.AI
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                      }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>AI Vector</span>
                  </button>
                </div>
              </div>
            ) : (
              // Local/AI toggle for SVG→HTML
              <div className="flex bg-gray-800 p-1 rounded-lg">
                <button
                  onClick={() => setSvg2htmlMode(ConversionMode.LOCAL)}
                  className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${svg2htmlMode === ConversionMode.LOCAL
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                    }`}
                >
                  <Zap className="w-3 h-3" />
                  <span>Local</span>
                </button>
                <button
                  onClick={() => setSvg2htmlMode(ConversionMode.AI)}
                  className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${svg2htmlMode === ConversionMode.AI
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                    }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>AI</span>
                </button>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div
            className="flex-1 relative"
            onDrop={!isHtmlToSvg ? handleDrop : undefined}
            onDragOver={!isHtmlToSvg ? handleDragOver : undefined}
          >
            {/* URL Input Mode */}
            {isHtmlToSvg && inputMode === InputMode.URL ? (
              <div className="h-full flex flex-col p-4 bg-gray-950">
                <div className="flex items-center space-x-2 mb-4">
                  <div className="flex-1 relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="url"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="输入网址或本地路径，例如 https://example.com 或 file:///Users/.../index.html 或 http://localhost:3000"
                      className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleHtmlToSvg();
                      }}
                    />
                  </div>
                  <button
                    onClick={addPage}
                    disabled={!inputUrl.trim()}
                    className="flex items-center space-x-1 px-3 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    title="添加到页面列表"
                  >
                    <Plus className="w-4 h-4" />
                    <span>添加</span>
                  </button>
                </div>

                {/* Page List */}
                {pages.length > 0 && (
                  <div className="mb-4 bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-800/50">
                      <div className="flex items-center space-x-2 text-gray-400">
                        <Layers className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">页面列表 ({pages.length})</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={handleBatchDownload}
                          disabled={!pages.some(p => p.svgContent)}
                          className="flex items-center space-x-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                          title="下载所有已转换的 SVG"
                        >
                          <Download className="w-3 h-3" />
                          <span>批量下载</span>
                        </button>
                        <button
                          onClick={handleBatchConvert}
                          disabled={pages.some(p => p.isConverting)}
                          className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                        >
                          {pages.some(p => p.isConverting) ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /><span>转换中...</span></>
                          ) : (
                            <><Zap className="w-3 h-3" /><span>批量转换</span></>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {pages.map((page) => (
                        <div
                          key={page.id}
                          onClick={() => {
                            setActivePageId(page.id);
                            if (page.svgContent) {
                              setSvgState(prev => ({ ...prev, svgContent: page.svgContent }));
                            }
                          }}
                          className={`flex items-center px-3 py-2 border-b border-gray-800/50 cursor-pointer transition-colors group/item ${
                            activePageId === page.id
                              ? 'bg-indigo-900/30 border-l-2 border-l-indigo-500'
                              : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                          }`}
                        >
                          {/* Status indicator */}
                          <div className="mr-2 flex-shrink-0">
                            {page.isConverting ? (
                              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                            ) : page.error ? (
                              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                            ) : page.svgContent ? (
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full border border-gray-600" />
                            )}
                          </div>

                          {/* Name (editable) + URL */}
                          <div className="flex-1 min-w-0 mr-2">
                            <input
                              type="text"
                              value={page.name}
                              onChange={(e) => { e.stopPropagation(); updatePageName(page.id, e.target.value); }}
                              onClick={(e) => e.stopPropagation()}
                              className="block w-full text-xs font-medium text-gray-200 bg-transparent border-none outline-none focus:text-white truncate p-0 hover:bg-gray-800/50 focus:bg-gray-800 rounded px-1 -ml-1 transition-colors"
                            />
                            <p className="text-[10px] text-gray-500 truncate mt-0.5" title={page.url}>
                              {page.url}
                            </p>
                            {page.error && (
                              <p className="text-[10px] text-red-400 truncate mt-0.5">{page.error}</p>
                            )}
                          </div>

                          {/* Remove button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); removePage(page.id); }}
                            className="flex-shrink-0 p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover/item:opacity-100 transition-all rounded hover:bg-gray-800"
                            title="移除"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
                  <p className="text-gray-500 text-sm mb-2">
                    <Link className="w-4 h-4 inline mr-2" />
                    支持远程 URL / 本地地址 / 本地文件路径
                  </p>
                  <p className="text-gray-600 text-xs mb-3 space-y-1">
                    <span className="block">• 远程: <code className="text-gray-500">https://example.com</code></span>
                    <span className="block">• 本地服务: <code className="text-gray-500">http://localhost:3000/page.html</code></span>
                    <span className="block">• 本地文件: <code className="text-gray-500">file:///Users/.../index.html</code></span>
                  </p>
                  {inputHtml && inputMode === InputMode.URL && (
                    <div className="mt-4">
                      <p className="text-gray-400 text-xs mb-2">已获取的 HTML 预览：</p>
                      <pre className="text-gray-500 text-xs overflow-auto max-h-48 bg-gray-950 rounded p-2">
                        {inputHtml.substring(0, 500)}...
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <textarea
                className="w-full h-full bg-gray-950 text-gray-300 font-mono text-sm p-4 resize-none focus:outline-none focus:ring-0 leading-relaxed"
                value={isHtmlToSvg ? inputHtml : inputSvg}
                onChange={(e) => isHtmlToSvg ? setInputHtml(e.target.value) : setInputSvg(e.target.value)}
                placeholder={isHtmlToSvg ? "Paste your HTML here..." : "Paste your SVG here or drag & drop an SVG file..."}
                spellCheck={false}
              />
            )}

            {/* Upload button overlay for SVG mode */}
            {!isHtmlToSvg && (
              <div className="absolute bottom-4 right-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-gray-800/80 hover:bg-gray-700"
                  icon={<Upload className="w-4 h-4" />}
                >
                  Upload SVG
                </Button>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-800 bg-gray-900/50">
            {isHtmlToSvg ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-400 font-medium mb-1">Options</span>
                    <label className="flex items-center cursor-pointer group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={optimize}
                          onChange={(e) => setOptimize(e.target.checked)}
                        />
                        <div className={`block w-8 h-5 rounded-full transition-colors ${optimize ? 'bg-indigo-600' : 'bg-gray-700'}`}></div>
                        <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${optimize ? 'translate-x-3' : 'translate-x-0'}`}></div>
                      </div>
                      <span className="ml-2 text-sm text-gray-300 group-hover:text-white transition-colors">Optimize Output</span>
                    </label>
                  </div>

                  {optimize && (
                    <div className="text-xs text-indigo-400 flex items-center bg-indigo-900/20 px-2 py-1 rounded">
                      <Settings2 className="w-3 h-3 mr-1" />
                      Minified
                    </div>
                  )}
                </div>

                {renderMode === RenderMode.FIGMA && (
                  <div className="flex flex-col mt-3 mb-2 p-2 bg-gray-800/50 rounded border border-gray-700/50">
                    <label className="flex items-center cursor-pointer mb-1">
                      <input
                        type="checkbox"
                        className="mr-2 rounded bg-gray-700 border-gray-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-gray-900"
                        checked={rasterizeText}
                        onChange={(e) => setRasterizeText(e.target.checked)}
                      />
                      <span className="text-xs text-gray-300">Rasterize Text (Fix Fonts)</span>
                    </label>
                    <p className="text-[10px] text-gray-500 ml-5 leading-tight">
                      Converts text to images. Solves all font/garbled text issues but makes text uneditable.
                    </p>
                  </div>
                )}

                <div className="mb-3">
                  {conversionMode === ConversionMode.AI ? (
                    <p className="text-xs text-indigo-300/70 flex items-center">
                      <Cpu className="w-3 h-3 mr-1" />
                      Converts HTML to editable vector paths. Perfect for Figma/Illustrator.
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-300/70 flex items-center">
                      <Zap className="w-3 h-3 mr-1" />
                      Real-time DOM measurement. Figma compatible (No foreignObject).
                    </p>
                  )}
                </div>
                <Button
                  onClick={handleHtmlToSvg}
                  isLoading={svgState.isLoading}
                  className={`w-full shadow-lg ${conversionMode === ConversionMode.AI
                    ? 'shadow-indigo-900/20 bg-indigo-600 hover:bg-indigo-700'
                    : 'shadow-emerald-900/20 bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
                    }`}
                  icon={conversionMode === ConversionMode.AI ? <Sparkles className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                >
                  {conversionMode === ConversionMode.AI ? 'Generate Vectors' : 'Render Local'}
                </Button>
                {conversionMode === ConversionMode.LOCAL && (
                  <Button
                    onClick={handleExportFigmaJSON}
                    isLoading={isFigmaExporting}
                    className="w-full mt-2 shadow-lg shadow-purple-900/20 bg-purple-600 hover:bg-purple-700 focus:ring-purple-500"
                    icon={<Download className="w-4 h-4" />}
                  >
                    导出 Figma JSON
                  </Button>
                )}
                {svgState.error && (
                  <p className="mt-2 text-xs text-red-400 text-center animate-pulse">
                    {svgState.error}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="mb-3">
                  <p className="text-xs text-amber-300/70 flex items-center">
                    {svg2htmlMode === ConversionMode.LOCAL ? (
                      <>
                        <Zap className="w-3 h-3 mr-1" />
                        Local parsing converts SVG elements to HTML/CSS.
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI converts SVG designs into semantic HTML + CSS code.
                      </>
                    )}
                  </p>
                </div>
                <Button
                  onClick={handleSvgToHtml}
                  isLoading={htmlState.isLoading}
                  className="w-full shadow-lg shadow-amber-900/20 bg-amber-600 hover:bg-amber-700"
                  icon={<ArrowRightLeft className="w-4 h-4" />}
                >
                  Convert to HTML
                </Button>
                {htmlState.error && (
                  <p className="mt-2 text-xs text-red-400 text-center animate-pulse">
                    {htmlState.error}
                  </p>
                )}
              </>
            )}
          </div>
        </div >

        {/* Resizable Divider */}
        {viewMode === ViewMode.SPLIT && (
          <div
            onMouseDown={handleDividerMouseDown}
            className="w-1.5 bg-gray-800 hover:bg-indigo-600 cursor-col-resize flex-shrink-0 transition-colors active:bg-indigo-500 relative group"
            title="拖拽调整面板宽度"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Right Panel: Preview */}
        < div
          className="flex flex-col h-full bg-gray-950 overflow-hidden"
          style={viewMode === ViewMode.SPLIT ? { width: `${100 - leftPanelRatio}%`, minWidth: 280 } : { width: '100%' }}
        >
          {/* Interactive Capture Mode */}
          {isHtmlToSvg && renderMode === RenderMode.INTERACTIVE ? (
            <div className="flex flex-col h-full relative">
              {/* Capture button bar */}
              <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-850 z-20">
                <div className="flex items-center space-x-4">
                  <span className="text-xs text-amber-400 flex items-center">
                    <Globe className="w-3.5 h-3.5 mr-1.5" />
                    交互预览
                  </span>
                  {interactiveError && (
                    <span className="text-xs text-red-400 max-w-[260px] truncate" title={interactiveError}>
                      {interactiveError}
                    </span>
                  )}
                  {/* Viewport size controls */}
                  <div className="flex items-center space-x-1.5 text-[10px] text-gray-400">
                    <span>{isViewportCustom ? '自定义:' : '画面:'}</span>
                    <input
                      type="number"
                      value={viewportW}
                      onChange={(e) => handleViewportWChange(e.target.value)}
                      className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:border-gray-600"
                      min={320}
                      max={2560}
                    />
                    <span>×</span>
                    <input
                      type="number"
                      value={viewportH}
                      onChange={(e) => handleViewportHChange(e.target.value)}
                      className="w-14 px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:border-gray-600"
                      min={320}
                      max={2560}
                    />
                    <button
                      onClick={() => startInteractivePreview(true)}
                      className="p-0.5 text-gray-500 hover:text-white ml-1"
                      title="适配当前预览区域"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => startInteractivePreview()}
                      className="text-gray-500 hover:text-white"
                      title="应用新尺寸"
                    >
                      ⟳
                    </button>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => { stopInteractivePreview(); setRenderMode(RenderMode.BROWSER); }}
                    className="px-2.5 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 rounded transition-colors"
                  >
                    退出
                  </button>
                  <button
                    onClick={handleInteractiveCapture}
                    disabled={isCapturing || !isInteractiveReady}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                  >
                    {isCapturing ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>捕获中...</span></>
                    ) : (
                      <><Plus className="w-3.5 h-3.5" /><span>捕获此画面</span></>
                    )}
                  </button>
                </div>
              </div>
              {/* Interactive iframe */}
              <div
                ref={interactiveContainerRef}
                className="flex-1 bg-white overflow-auto"
              />
            </div>
          ) : isHtmlToSvg ? (
              <SvgPreview
                svgContent={svgState.svgContent}
                isLoading={svgState.isLoading}
                pages={pages}
                activePageId={activePageId}
                onPageSelect={(id) => {
                  setActivePageId(id);
                  const page = pages.find(p => p.id === id);
                  if (page?.svgContent) {
                    setSvgState(prev => ({ ...prev, svgContent: page.svgContent }));
                  }
                }}
              />
            ) : (
              <HtmlPreview
                htmlContent={htmlState.htmlContent}
                cssContent={htmlState.cssContent}
                isLoading={htmlState.isLoading}
              />
            )}
        </div >
      </main >
    </div >
  );
}

export default App;
