import helpText from '../helpContent.txt?raw'

import { useBranding } from '../hooks/useBranding'

export default function HelpView() {
  const branding = useBranding()
  const blocks = helpText.trim().split(/\n{2,}/)

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-text-primary mb-1">How to use {branding}</h1>
        <p className="text-[13px] text-text-muted mb-7">
          One layout on desktop and mobile: the menu, the view tabs, and the content area.
        </p>
        <div className="space-y-4">
          {blocks.map((block, i) => (
            <p key={i} className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-line">
              {block}
            </p>
          ))}
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Shortcuts</h2>
          <div className="space-y-1.5 text-xs">
            {[
              ['Command palette', 'Ctrl/Cmd + Shift + P'],
              ['Save file', 'Ctrl/Cmd + S'],
              ['Go to line', 'Ctrl + G'],
              ['Search in file', 'Ctrl/Cmd + F'],
              ['Workspace search', 'Ctrl/Cmd + Shift + F'],
              ['Close tab', 'Ctrl/Cmd + W'],
              ['Multi-cursor', 'Alt + Click'],
              ['Column select', 'Alt + Drag'],
            ].map(([action, keys]) => (
              <div key={action} className="flex items-center justify-between py-1.5 px-3 bg-bg-secondary rounded-lg border border-border">
                <span className="text-text-secondary">{action}</span>
                <kbd className="text-[10px] font-mono text-text-muted bg-bg-hover px-1.5 py-0.5 rounded border border-border">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-text-primary mb-2">Terminal help</h2>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            See <span className="font-mono text-text-primary">terminal &gt; settings &gt; help</span>.
          </p>
        </div>
      </div>
    </div>
  )
}
