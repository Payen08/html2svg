import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Hand, Maximize2, Minus, Plus } from 'lucide-react';

interface Props {
  iframe: HTMLIFrameElement | null;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

const clampZoom = (value: number) => Math.max(0.02, Math.min(3, value));

export function InteractiveViewport({ iframe, viewportRef }: Props) {
  const frameHost = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 1440, height: 900 });
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [panMode, setPanMode] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const fitZoom = clampZoom(Math.min(1, (viewSize.width - 32) / frameSize.width, (viewSize.height - 32) / frameSize.height));
  const zoom = manualZoom ?? fitZoom;
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewSize({ width: viewport.clientWidth, height: viewport.clientHeight }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);

  useEffect(() => {
    if (!iframe || !frameHost.current) return;
    iframe.style.transform = 'none';
    iframe.style.margin = '0';
    frameHost.current.appendChild(iframe);
    const updateSize = () => setFrameSize({
      width: Number(iframe.getAttribute('width')) || 1440,
      height: Number(iframe.getAttribute('height')) || 900,
    });
    updateSize();
    setManualZoom(null);
    const observer = new MutationObserver(updateSize);
    observer.observe(iframe, { attributes: true, attributeFilter: ['width', 'height'] });
    return () => { observer.disconnect(); iframe.remove(); };
  }, [iframe]);

  const changeZoom = (value: number, point?: { clientX: number; clientY: number }) => {
    const viewport = viewportRef.current;
    const host = frameHost.current;
    if (viewport && host) {
      const rect = viewport.getBoundingClientRect();
      const clientX = point?.clientX ?? rect.left + viewport.clientWidth / 2;
      const clientY = point?.clientY ?? rect.top + viewport.clientHeight / 2;
      const hostRect = host.getBoundingClientRect();
      anchor.current = {
        x: (clientX - hostRect.left) / currentZoom.current,
        y: (clientY - hostRect.top) / currentZoom.current,
        clientX, clientY,
      };
    }
    setManualZoom(clampZoom(value));
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const host = frameHost.current;
    if (!viewport || !host) return;
    if (manualZoom === null) {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    } else if (anchor.current) {
      const point = anchor.current;
      const rect = host.getBoundingClientRect();
      viewport.scrollLeft += rect.left + point.x * zoom - point.clientX;
      viewport.scrollTop += rect.top + point.y * zoom - point.clientY;
    }
    anchor.current = null;
  }, [zoom, frameSize, manualZoom, viewportRef]);

  // Wheel events inside a same-origin iframe do not bubble to its parent.
  // Let scrollable page controls consume their own wheel; otherwise scroll the canvas.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent, insideFrame = false) => {
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const dx = event.deltaX * factor;
      const dy = event.deltaY * factor;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = iframe?.getBoundingClientRect();
        changeZoom(currentZoom.current * Math.exp(-dy * 0.002), insideFrame && rect
          ? { clientX: rect.left + event.clientX * currentZoom.current, clientY: rect.top + event.clientY * currentZoom.current }
          : event);
      } else if (insideFrame) {
        const doc = iframe?.contentDocument;
        let element = (event.target as Element | null)?.nodeType === 1 ? event.target as Element : null;
        while (element && doc) {
          const style = doc.defaultView!.getComputedStyle(element);
          const scrollingRoot = element === doc.scrollingElement;
          const canY = (scrollingRoot || /auto|scroll/.test(style.overflowY)) && element.scrollHeight > element.clientHeight + 1 &&
            (dy > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : dy < 0 && element.scrollTop > 0);
          const canX = (scrollingRoot || /auto|scroll/.test(style.overflowX)) && element.scrollWidth > element.clientWidth + 1 &&
            (dx > 0 ? element.scrollLeft + element.clientWidth < element.scrollWidth - 1 : dx < 0 && element.scrollLeft > 0);
          if (canY || canX) return;
          element = element.parentElement;
        }
        event.preventDefault();
        viewport.scrollBy(dx, dy);
      }
    };
    const outerWheel = (event: WheelEvent) => wheel(event);
    const innerWheel = (event: WheelEvent) => wheel(event, true);
    let frameDoc: Document | null = null;
    const bindFrame = () => {
      frameDoc?.removeEventListener('wheel', innerWheel, true);
      try { frameDoc = iframe?.contentDocument || null; } catch { frameDoc = null; }
      frameDoc?.addEventListener('wheel', innerWheel, { passive: false, capture: true });
    };
    viewport.addEventListener('wheel', outerWheel, { passive: false });
    iframe?.addEventListener('load', bindFrame);
    bindFrame();
    return () => {
      viewport.removeEventListener('wheel', outerWheel);
      iframe?.removeEventListener('load', bindFrame);
      frameDoc?.removeEventListener('wheel', innerWheel, true);
    };
  }, [iframe, viewportRef]);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const buttonClass = 'flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-700 disabled:opacity-40';

  return <div className="flex flex-1 min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
      <button className={buttonClass} aria-label="缩小预览" disabled={!iframe} onClick={() => changeZoom(zoom / 1.2)}><Minus className="h-4 w-4" /></button>
      <span aria-label="预览缩放比例" className="w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
      <button className={buttonClass} aria-label="放大预览" disabled={!iframe} onClick={() => changeZoom(zoom * 1.2)}><Plus className="h-4 w-4" /></button>
      <button className={buttonClass} disabled={!iframe} onClick={() => { anchor.current = null; setManualZoom(null); viewportRef.current?.scrollTo(0, 0); }}><Maximize2 className="h-3.5 w-3.5" />适应窗口</button>
      <button className={buttonClass} disabled={!iframe} onClick={() => changeZoom(1)}>100%</button>
      <button className={`${buttonClass} ${panMode ? 'bg-indigo-600 text-white' : ''}`} aria-pressed={panMode} disabled={!iframe} onClick={() => setPanMode(value => !value)}><Hand className="h-3.5 w-3.5" />拖动画布</button>
      <span className="ml-auto text-gray-500">滚轮滚动 · ⌘/Ctrl + 滚轮缩放</span>
    </div>
    <div ref={viewportRef} aria-label="交互预览画布" className={`relative min-h-0 flex-1 overflow-auto bg-gray-200 ${panMode ? 'cursor-grab active:cursor-grabbing' : ''}`} style={{ padding: 16, overscrollBehavior: 'contain' }}
      onPointerDown={event => {
        if ((!panMode && event.button !== 1) || !iframe) return;
        event.preventDefault();
        drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="relative mx-auto" style={{ width: frameSize.width * zoom, height: frameSize.height * zoom, overflow: 'hidden' }}>
        <div ref={frameHost} style={{ position: 'absolute', left: 0, top: 0, width: frameSize.width, height: frameSize.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
        {panMode && <div aria-label="画布拖动层" className="absolute inset-0" style={{ touchAction: 'none' }} />}
      </div>
    </div>
  </div>;
}
