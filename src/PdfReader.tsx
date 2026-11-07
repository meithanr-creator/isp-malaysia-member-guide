import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PdfFileLease } from './content';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfReaderProps {
  title: string;
  load: (signal: AbortSignal) => Promise<PdfFileLease>;
  onClose: () => void;
}

export default function PdfReader({ title, load, onClose }: PdfReaderProps) {
  const container = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const lease = useRef<PdfFileLease | null>(null), rendering = useRef<RenderTask | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(100), [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true), [drawing, setDrawing] = useState(false), [error, setError] = useState(''), [pageText, setPageText] = useState('');

  function clearCanvas() {
    const current = canvas.current;
    if (current) { current.width = 0; current.height = 0; current.style.width = ''; current.style.height = ''; }
  }
  useLayoutEffect(() => {
    let active = true, task: PDFDocumentLoadingTask | null = null;
    const controller = new AbortController();
    rendering.current?.cancel(); clearCanvas();
    container.current?.scrollIntoView({ block: 'start' }); container.current?.focus({ preventScroll: true });
    setPdf(null); setPage(1); setZoom(100); setPageText(''); setError(''); setLoading(true); setDrawing(false);
    void (async () => {
      const file = await load(controller.signal);
      if (!active || controller.signal.aborted || !file.isCurrent()) { file.release(); return; }
      lease.current = file;
      task = getDocument({
        data: file.data, enableXfa: false, stopAtErrors: true,
        cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/', useWorkerFetch: true,
        maxImageSize: 20_000_000, canvasMaxAreaInBytes: 32 * 1024 * 1024,
        isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      });
      const document = await task.promise;
      if (!active || controller.signal.aborted || !file.isCurrent()) return;
      setPdf(document); setLoading(false);
    })().catch(caught => {
      if (!active || controller.signal.aborted) return;
      clearCanvas(); setLoading(false); lease.current?.release(); lease.current = null;
      void task?.destroy().catch(() => {});
      setError(caught instanceof Error ? caught.message : 'This PDF could not be opened. Close the reader and try again.');
    });
    return () => {
      active = false; controller.abort(); rendering.current?.cancel(); rendering.current = null;
      clearCanvas(); lease.current?.release(); lease.current = null;
      void task?.destroy().catch(() => {});
    };
  }, [load]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let measuredWidth = -1;
    const update = () => {
      // Page height and scrollbar changes must not restart the page render.
      const outerWidth = Math.round(element.getBoundingClientRect().width);
      if (outerWidth === measuredWidth) return;
      measuredWidth = outerWidth;
      setWidth(Math.max(1, element.clientWidth - 24));
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!pdf || !width) return;
    let active = true;
    let renderTask: RenderTask | null = null;
    const temporary = document.createElement('canvas'), file = lease.current;
    clearCanvas(); setPageText(''); setDrawing(true); setError('');
    void (async () => {
      if (!file?.isCurrent()) throw Error('Your access changed. Close the reader and sign in again.');
      const pdfPage = await pdf.getPage(page);
      if (!active || !file?.isCurrent()) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = width / base.width * zoom / 100;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const budgetScale = Math.sqrt(4_000_000 / (base.width * base.height));
      const renderScale = Math.min(cssScale * pixelRatio, budgetScale, 8192 / Math.max(base.width, base.height));
      const pageViewport = pdfPage.getViewport({ scale: renderScale });
      temporary.width = Math.max(1, Math.floor(pageViewport.width));
      temporary.height = Math.max(1, Math.floor(pageViewport.height));
      renderTask = pdfPage.render({ canvas: temporary, viewport: pageViewport, annotationMode: AnnotationMode.DISABLE, background: '#ffffff' });
      rendering.current = renderTask;
      await renderTask.promise;
      if (!active || !file?.isCurrent() || !canvas.current) return;
      const target = canvas.current, context = target.getContext('2d');
      if (!context) throw Error('This device could not display the PDF page.');
      target.width = temporary.width; target.height = temporary.height;
      target.style.width = base.width * cssScale + 'px'; target.style.height = base.height * cssScale + 'px';
      context.drawImage(temporary, 0, 0); setDrawing(false);
      const text = await pdfPage.getTextContent();
      if (active && file?.isCurrent()) setPageText(text.items.map(item => 'str' in item ? item.str : '').join(' '));
      if (active) pdfPage.cleanup();
    })().catch(caught => {
      if (!active || caught?.name === 'RenderingCancelledException') return;
      clearCanvas(); setDrawing(false);
      setError(caught instanceof Error ? caught.message : 'This page could not be displayed. Try another page.');
    }).finally(() => {
      temporary.width = 0; temporary.height = 0;
      if (rendering.current === renderTask) rendering.current = null;
    });
    return () => { active = false; renderTask?.cancel(); clearCanvas(); };
  }, [pdf, page, zoom, width]);

  const pages = pdf?.numPages || 0;
  function turn(delta: number) { setPage(current => Math.min(pages, Math.max(1, current + delta))); }
  function changeZoom(delta: number) { setZoom(current => Math.min(200, Math.max(75, current + delta))); }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!pages || loading) return;
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); turn(-1); }
    else if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); turn(1); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(25); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(-25); }
  }
  return <section className="page pdf-reader" ref={container} tabIndex={-1} aria-label={title + ' reader'} onKeyDown={keyboard}>
    <button type="button" className="link-button pdf-reader-back" onClick={onClose}>‹ Back to details</button>
    <span className="eyebrow">Read in the app</span><h1>{title}</h1>
    <div className="pdf-reader-controls" aria-label="PDF reading controls">
      <div className="pdf-page-controls"><button type="button" className="secondary" disabled={!pages || page <= 1} onClick={() => turn(-1)} aria-label="Previous page">‹ Previous</button><span role="status" aria-live="polite">{pages ? 'Page ' + page + ' of ' + pages : 'Opening PDF…'}</span><button type="button" className="secondary" disabled={!pages || page >= pages} onClick={() => turn(1)} aria-label="Next page">Next ›</button></div>
      <div className="pdf-zoom-controls"><button type="button" className="secondary" disabled={!pages || zoom <= 75} onClick={() => changeZoom(-25)} aria-label="Zoom out">−</button><span aria-live="polite">{zoom}%</span><button type="button" className="secondary" disabled={!pages || zoom >= 200} onClick={() => changeZoom(25)} aria-label="Zoom in">+</button></div>
    </div>
    {error && <div className="validation-errors" role="alert">{error}</div>}
    {(loading || drawing) && <p className="form-hint" role="status">{loading ? 'Opening the approved PDF…' : 'Displaying page ' + page + '…'}</p>}
    <div className="pdf-reader-viewport" ref={viewport} tabIndex={0} role="region" aria-label="PDF page. Scroll to read; use arrow keys to turn pages." aria-busy={loading || drawing}>
      <canvas ref={canvas} role="img" aria-label={pages ? title + ', page ' + page + ' of ' + pages : title} />
    </div>
    {pageText && <div className="sr-only" aria-label={'Page ' + page + ' text'}>{pageText}</div>}
    <p className="form-hint pdf-reader-hint">Use Previous and Next to turn pages. Use + or − to resize the page, then scroll to read.</p>
  </section>;
}

