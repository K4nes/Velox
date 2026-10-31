import { useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme/theme-provider'

type AnimationContext = {
  duration: number
  viewportHeight: number
}

const swipe =
  (from: 'top' | 'bottom') =>
  ({ duration, viewportHeight }: AnimationContext) => {
    const closed =
      from === 'top'
        ? `inset(${viewportHeight}px 0 0 0)`
        : `inset(0 0 ${viewportHeight}px 0)`
    document.documentElement.animate(
      { clipPath: [closed, 'inset(0 0 0 0)'] },
      {
        duration,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        pseudoElement: '::view-transition-new(root)',
      }
    )
  }

const ANIMATIONS = {
  none: () => {},
  'swipe-up': swipe('top'),
  'swipe-down': swipe('bottom'),
} as const

type AnimationType = keyof typeof ANIMATIONS

interface ToggleThemeProps extends React.ComponentPropsWithoutRef<'button'> {
  duration?: number
  animationType?: AnimationType | { toLight: AnimationType; toDark: AnimationType }
}

export const ToggleTheme = ({
  className,
  duration = 400,
  animationType = 'none',
  ...props
}: ToggleThemeProps) => {
  const { isDark, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)

  // A single type runs both ways; a pair picks by the theme being entered.
  const animation =
    typeof animationType === 'string'
      ? animationType
      : isDark
        ? animationType.toLight
        : animationType.toDark

  const toggleTheme = useCallback(async () => {
    if (!buttonRef.current) return

    const applyTheme = () => {
      setTheme(isDark ? 'light' : 'dark')
    }

    // Without the View Transition API the theme still toggles, just without
    // the page-wide animation.
    if (!document.startViewTransition) {
      applyTheme()
      return
    }

    await document.startViewTransition(() => {
      flushSync(applyTheme)
    }).ready

    ANIMATIONS[animation]({
      duration,
      viewportHeight: window.innerHeight,
    })
  }, [isDark, duration, animation, setTheme])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        className={cn(
          'rounded-full p-2 transition-colors duration-300',
          isDark ? 'hover:text-amber-400' : 'hover:text-foreground',
          className
        )}
        {...props}
      >
        {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>

      <style>{`
        ::view-transition-old(root),
        ::view-transition-new(root) {
          animation: none;
          mix-blend-mode: normal;
        }
      `}</style>
    </>
  )
}
