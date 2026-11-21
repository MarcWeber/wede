import type { ReactNode } from 'react'

export function H({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-text-primary mb-3">{children}</h2>
}

export function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[12px] text-text-secondary leading-relaxed ${className}`}>{children}</p>
}

export function List({ items, className = '' }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={`list-disc pl-5 space-y-1 text-[12px] text-text-secondary leading-relaxed ${className}`}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

export function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-text-primary font-medium">{label}</span> — {children}
    </>
  )
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="space-y-1.5 text-xs">
      {rows.map(([label, text]) => (
        <div key={label} className="py-1.5 px-3 bg-bg-secondary rounded-lg border border-border">
          <span className="text-text-primary font-medium">{label}</span>
          <span className="text-text-secondary"> — {text}</span>
        </div>
      ))}
    </div>
  )
}

export function KeyRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="space-y-1.5 text-xs">
      {rows.map(([action, keys]) => (
        <div key={action} className="flex items-center justify-between py-1.5 px-3 bg-bg-secondary rounded-lg border border-border">
          <span className="text-text-secondary">{action}</span>
          <kbd className="text-[10px] font-mono text-text-muted bg-bg-hover px-1.5 py-0.5 rounded border border-border">
            {keys}
          </kbd>
        </div>
      ))}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <H>{title}</H>
      {children}
    </section>
  )
}
