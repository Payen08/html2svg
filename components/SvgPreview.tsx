import React, { useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, ZoomIn, ZoomOut, Maximize, Move, Grid3X3, Sun, Moon, Hash, Layers } from 'lucide-react';
import { Button } from './Button';
import { PageItem } from '../types';

interface SvgPreviewProps {
  svgContent: string | null;
  isLoading: boolean;
  pages?: PageItem[];
  activePageId?: string | null;
  onPageSelect?: (id: string) => void;
}

type BackgroundType = 'grid' | 'dots' | 'dark' | 'light' | 'transparent';

export const SvgPreview: React.FC<SvgPreviewProps> = ({ svgContent, isLoading, pages, activePageId, onPageSelect }) => {
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [bgType, setBgType] = useState<BackgroundType>('dots');

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Reset view when content changes
  useEffect(() => {
    if (svgContent) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [svgContent]);

  const handleCopy = async () => {
    if (svgContent) {
      await navigator.clipboard.writeText(svgContent);
      setCopied(true);
    }
  };

  const handleDownload = () => {
    if (svgContent) {
      downloadSvg(svgContent, `ui-artboard-${Date.now()}.svg`);
    }
  };

  const downloadSvg = (content: string, filename: string) => {
    // Add UTF-8 BOM for proper encoding
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const encoder = new TextEncoder();
    const svgBytes = encoder.encode(content);
    const combinedBytes = new Uint8Array(bom.length + svgBytes.length);
    combinedBytes.set(bom);
    combinedBytes.set(svgBytes, bom.length);

    const blob = new Blob([combinedBytes], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    if (!pages) return;
    const pagesWithContent = pages.filter(p => p.svgContent);
    pagesWithContent.forEach((page, index) => {
      // Small timeout between downloads to prevent browser blocking
      setTimeout(() => {
        downloadSvg(page.svgContent!, `${page.name || `page-${index + 1}`}.svg`);
      }, index * 200);
    });
  };

  // Panning Logic
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only allow left click drag if holding space or using middle mouse, OR just allow left drag for simplicity
    // Here we allow left drag on the background
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.max(0.1, Math.min(5, z + delta)));
    }
  };

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // Background Styles
  const getBackgroundStyle = () => {
    switch (bgType) {
      case 'dots':
        return {
          backgroundImage: 'radial-gradient(#4a5568 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundColor: '#0f1115'
        };
      case 'grid':
        return {
          backgroundImage: 'linear-gradient(#1f2937 1px, transparent 1px), linear-gradient(90deg, #1f2937 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          backgroundColor: '#0f1115'
        };
      case 'light':
        return { backgroundColor: '#f3f4f6' };
      case 'dark':
        return { backgroundColor: '#0f1115' };
      case 'transparent':
        return {
          backgroundImage: `linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)`,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          backgroundColor: '#1a202c'
        };
      default:
        return {};
    }
  };

  // Determine which pages have SVG content (for tabs)
  const pagesWithContent = pages?.filter(p => p.svgContent) || [];
  const showPageTabs = pagesWithContent.length > 0;

  // Determine effective SVG content: if pages exist and one is active, show that page's content
  const effectiveSvgContent = (() => {
    if (showPageTabs && activePageId) {
      const activePage = pages?.find(p => p.id === activePageId);
      if (activePage?.svgContent) return activePage.svgContent;
    }
    return svgContent;
  })();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 rounded-xl border border-gray-800 p-8 text-gray-500 animate-pulse">
        <div className="w-16 h-16 rounded-full bg-gray-800 mb-4"></div>
        <p>Designing vector graphics...</p>
      </div>
    );
  }

  if (!effectiveSvgContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 rounded-xl border border-gray-800 p-8 text-gray-500">
        <Maximize className="w-12 h-12 mb-4 opacity-50" />
        <p>Render HTML to see the Artboard</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-800 overflow-hidden relative group">
      {/* Toolbar / Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-850 z-20 shadow-sm">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center">
            <Move className="w-3 h-3 mr-1" /> Artboard
          </span>
          <div className="h-4 w-px bg-gray-700 mx-2"></div>

          {/* Zoom Controls */}
          <div className="flex items-center bg-gray-800 rounded-md p-0.5">
            <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-1.5 hover:bg-gray-700 rounded text-gray-400">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-gray-300 w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="p-1.5 hover:bg-gray-700 rounded text-gray-400">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button variant="ghost" size="sm" onClick={resetView} className="h-7 text-xs px-2" title="Reset View">
            Reset
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          {/* Background Toggles */}
          <div className="flex items-center bg-gray-800 rounded-md p-0.5 mr-2">
            <button onClick={() => setBgType('dots')} className={`p-1.5 rounded ${bgType === 'dots' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Dots">
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setBgType('grid')} className={`p-1.5 rounded ${bgType === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Grid">
              <Hash className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setBgType('transparent')} className={`p-1.5 rounded ${bgType === 'transparent' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Transparent">
              <div className="w-3.5 h-3.5 bg-gray-400 rounded-sm border border-gray-500 opacity-50" style={{ backgroundImage: 'linear-gradient(45deg, #000 25%, transparent 25%)', backgroundSize: '4px 4px' }}></div>
            </button>
            <button onClick={() => setBgType('light')} className={`p-1.5 rounded ${bgType === 'light' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Light Mode">
              <Sun className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-8 px-2"
            title="Copy SVG Code"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
          {showPageTabs && pagesWithContent.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadAll}
              className="h-8 text-xs"
              icon={<Layers className="w-4 h-4" />}
            >
              All
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleDownload}
            className="h-8 text-xs"
            icon={<Download className="w-4 h-4" />}
          >
            Export
          </Button>
        </div>
      </div>

      {/* Page Tabs */}
      {showPageTabs && (
        <div className="flex items-center overflow-x-auto border-b border-gray-800 bg-gray-900/80 px-2">
          {pagesWithContent.map((page) => (
            <button
              key={page.id}
              onClick={() => onPageSelect?.(page.id)}
              className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${
                activePageId === page.id
                  ? 'border-b-indigo-500 text-white bg-indigo-600/10'
                  : 'border-b-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              <span>{page.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Canvas Area */}
      <div
        className={`flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing ${isDragging ? 'cursor-grabbing' : ''}`}
        style={getBackgroundStyle()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={containerRef}
          className="absolute left-1/2 top-1/2 origin-center transition-transform duration-75 ease-out will-change-transform"
          style={{
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          }}
        >
          {/* The Content */}
          <div className="relative shadow-2xl bg-transparent">
            {/* Visual border for the SVG 'Artboard' */}
            <div className="absolute -inset-[1px] border border-indigo-500/30 pointer-events-none"></div>

            {/* Dimension Label (Top) */}
            <div className="absolute -top-6 left-0 text-[10px] text-gray-500 font-mono">
              SVG Artboard
            </div>

            <div
              dangerouslySetInnerHTML={{ __html: effectiveSvgContent }}
              className="block" // Ensure no extra whitespace
            />
          </div>
        </div>

        {/* Overlay Instructions */}
        <div className="absolute bottom-4 right-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="bg-gray-900/80 backdrop-blur text-gray-400 text-[10px] px-2 py-1 rounded border border-gray-800">
            Scroll to Zoom • Drag to Pan
          </div>
        </div>
      </div>
    </div>
  );
};