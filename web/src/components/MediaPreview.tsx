import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ExternalLink, FileText, Film, type LucideIcon } from 'lucide-react'
import { useMediaSettings } from '../lib/mediaSettings'

// pdf.js is heavy; keep it (and its worker) in a separate chunk that is only
// fetched when a PDF is actually displayed.
const PdfViewer = lazy(() => import('./PdfViewer'))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function MediaHeader({ icon: Icon, filename, size, href, nameLink = false }: { icon: LucideIcon; filename?: string; size?: number; href?: string; nameLink?: boolean }) {
  const label = (
    <>
      <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
      <span className="font-medium text-text-secondary truncate">{filename}</span>
      {size != null && <span className="text-text-muted opacity-60 shrink-0">{formatBytes(size)}</span>}
    </>
  )
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary text-[11px] shrink-0">
      {nameLink && href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 min-w-0 hover:underline"
          title="Open in external tab"
        >
          {label}
        </a>
      ) : label}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-accent hover:underline shrink-0"
          title="Open in external tab"
        >
          ext tab <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}

function ExternalLinkButton({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
    >
      {children ?? 'Open in external tab'} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  )
}

/** Header + a single "open in external tab" link, used for the external modes. */
export function MediaLinkPreview({ icon, href, filename, size }: { icon: LucideIcon; href?: string; filename?: string; size?: number }) {
  if (!href) {
    return <div className="h-full flex items-center justify-center text-[12px] text-text-muted">{filename || 'File'} path unavailable</div>
  }
  return (
    <div className="h-full flex flex-col bg-bg-primary">
      <MediaHeader icon={icon} filename={filename} size={size} href={href} nameLink />
      <div className="flex-1 flex items-center justify-center p-6">
        <ExternalLinkButton href={href} />
      </div>
    </div>
  )
}

export function PdfPreview({ href, filename, size, forceEmbed = false, target }: {
  href?: string
  filename?: string
  size?: number
  // When another member is leading, external tabs break the shared view — keep
  // the PDF inside the app regardless of the saved preference.
  forceEmbed?: boolean
  target?: { page: number; u?: number; v?: number; seq?: number }
}) {
  const [{ pdf: mode }] = useMediaSettings()
  // "tab-choose" asks once per opened PDF; picking "open here" swaps this tab
  // to the embedded viewer without changing the saved preference. Remembering
  // the href (rather than a boolean) naturally resets when the tab changes.
  const [embedHref, setEmbedHref] = useState<string | null>(null)

  if (!href) {
    return <div className="h-full flex items-center justify-center text-[12px] text-text-muted">PDF path unavailable</div>
  }

  const effective = forceEmbed || embedHref === href ? 'tab-pdf-js' : mode

  return (
    <div className="h-full flex flex-col bg-bg-primary min-h-0">
      <MediaHeader icon={FileText} filename={filename} size={size} href={href} nameLink />
      <div className="flex-1 min-h-0">
        {effective === 'tab-pdf-js' ? (
          <Suspense fallback={<div className="h-full flex items-center justify-center text-[12px] text-text-muted">Loading PDF viewer…</div>}>
            <PdfViewer key={href} href={href} target={target} />
          </Suspense>
        ) : effective === 'tab-choose' ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-[12px] text-text-muted">{filename || 'This PDF'}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setEmbedHref(href)}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hover transition-colors"
              >
                Open here
              </button>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-md border border-border text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                Open in external tab
              </a>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center p-6">
            <ExternalLinkButton href={href} />
          </div>
        )}
      </div>
    </div>
  )
}

export function VideoPreview({ href, filename, size }: { href?: string; filename?: string; size?: number }) {
  if (!href) {
    return <div className="h-full flex items-center justify-center text-[12px] text-text-muted">Video path unavailable</div>
  }
  return (
    <div className="h-full flex flex-col bg-bg-primary">
      <MediaHeader icon={Film} filename={filename} size={size} href={href} />
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black/90 p-2">
        <video src={href} controls playsInline preload="metadata" className="max-w-full max-h-full" />
      </div>
    </div>
  )
}
