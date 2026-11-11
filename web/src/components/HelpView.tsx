import helpText from '../helpContent.txt?raw'

export default function HelpView() {
  const blocks = helpText.trim().split(/\n{2,}/)

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-text-primary mb-1">How to use wede</h1>
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
      </div>
    </div>
  )
}
