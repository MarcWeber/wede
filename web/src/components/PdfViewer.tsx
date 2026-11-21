import { useEffect, useRef, useState, type RefObject } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

interface PdfViewerProps {
  href: string
  // Reveal a peer's location: page number, plus a normalized point on that page.
  target?: { page: number; u?: number; v?: number; seq?: number }
}

/**
 * Embedded PDF viewer. Loaded via React.lazy so pdf.js (and its worker) stay in
 * their own chunk and are only downloaded when a PDF is actually shown.
 */
export default function PdfViewer({ href, target }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const task = getDocument({ url: href })
    task.promise
      .then((doc) => {
        if (cancelled) return
        setPdf(doc)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load this PDF')
        setLoading(false)
      })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [href])

  // Reveal a followed/jumped peer's page (and point). Pages render
  // asynchronously, so retry a few frames until the target canvas exists.
  const targetPage = target?.page
  const targetV = target?.v
  const targetSeq = target?.seq
  useEffect(() => {
    if (!pdf || targetPage == null || !Number.isInteger(targetPage) || targetPage < 1) return undefined
    let raf = 0
    let tries = 0
    const reveal = () => {
      const scroller = scrollRef.current
      if (!scroller) return
      const pageEl = scroller.querySelector<HTMLElement>(`[data-pdf-page="${targetPage}"]`)
      if (!pageEl) {
        if (tries++ < 30) raf = requestAnimationFrame(reveal)
        return
      }
      const sr = scroller.getBoundingClientRect()
      const pr = pageEl.getBoundingClientRect()
      const pageTop = scroller.scrollTop + (pr.top - sr.top)
      const top = targetV != null
        ? pageTop + targetV * pr.height - scroller.clientHeight / 2
        : pageTop - 8
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    }
    raf = requestAnimationFrame(reveal)
    return () => cancelAnimationFrame(raf)
  }, [pdf, targetPage, targetV, targetSeq])

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[12px] text-red">{error}</p>
        <a href={href} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
          Open in external tab
        </a>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-bg-tertiary p-3">
      {loading && <div className="py-6 text-center text-[12px] text-text-muted">Loading PDF…</div>}
      {pdf && <PdfPages pdf={pdf} widthSource={scrollRef} />}
    </div>
  )
}

function PdfPages({ pdf, widthSource }: { pdf: PDFDocumentProxy; widthSource: RefObject<HTMLDivElement | null> }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = widthSource.current
    if (!el) return undefined
    const measure = () => setWidth(Math.max(0, el.clientWidth - 24))
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [widthSource])

  return (
    <div className="flex flex-col items-center gap-3">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={width} />
      ))}
    </div>
  )
}

function PdfPage({ pdf, pageNumber, width }: { pdf: PDFDocumentProxy; pageNumber: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!width) return undefined
    let cancelled = false
    let task: RenderTask | null = null

    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      const dpr = window.devicePixelRatio || 1
      const cssWidth = Math.floor(viewport.width)
      const cssHeight = Math.floor(viewport.height)
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(cssHeight * dpr)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      setSize({ width: cssWidth, height: cssHeight })

      task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      try {
        await task.promise
      } catch { /* cancelled while re-rendering */ }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, width])

  return (
    <canvas
      ref={canvasRef}
      className="bg-white shadow-sm"
      style={{ width: size.width || undefined, height: size.height || undefined }}
      aria-label={`PDF page ${pageNumber}`}
      data-pdf-page={pageNumber}
    />
  )
}
