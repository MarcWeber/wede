import { useTheme } from '../hooks/useTheme'
import { useBranding } from '../hooks/useBranding'

interface LogoProps {
  size?: number
  showName?: boolean
  nameClass?: string
  className?: string
}

export default function Logo({ size = 24, showName = false, nameClass = '', className = '' }: LogoProps) {
  const { isDark } = useTheme()
  const branding = useBranding()
  const src = isDark ? '/icon.svg' : '/icon-light.svg'

  return (
    <span className={`inline-flex items-center gap-1.5 shrink-0 ${className}`}>
      <img src={src} alt={branding} width={size} height={size} className="shrink-0" />
      {showName && (
        <span className={`font-brand font-semibold tracking-tight ${nameClass}`}>
          {branding}
        </span>
      )}
    </span>
  )
}
