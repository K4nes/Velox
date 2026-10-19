import { useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme/theme-provider'

type AnimationType =
  | 'none'
  | 'circle-spread'
  | 'round-morph'
  | 'swipe-left'
  | 'swipe-up'
  | 'diag-down-right'
  | 'fade-in-out'
  | 'shrink-grow'
  | 'flip-x-in'
  | 'split-vertical'
  | 'swipe-right'
  | 'swipe-down'
  | 'wave-ripple'

interface ToggleThemeProps extends React.ComponentPropsWithoutRef<'button'> {
  duration?: number
  animationType?: AnimationType | { toLight: AnimationType; toDark: AnimationType }
}

export const ToggleTheme = ({
  className,
  duration = 400,
  animationType = 'circle-spread',
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

    const { top, left, width, height } = buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top)
    )
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    switch (animation) {
      case 'circle-spread':
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${maxRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'round-morph':
        document.documentElement.animate(
          [
            { opacity: 0, transform: 'scale(0.8) rotate(5deg)' },
            { opacity: 1, transform: 'scale(1) rotate(0deg)' },
          ],
          {
            duration: duration * 1.2,
            easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'swipe-left':
        document.documentElement.animate(
          {
            clipPath: [`inset(0 0 0 ${viewportWidth}px)`, `inset(0 0 0 0)`],
          },
          {
            duration,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'swipe-up':
        document.documentElement.animate(
          {
            clipPath: [`inset(${viewportHeight}px 0 0 0)`, `inset(0 0 0 0)`],
          },
          {
            duration,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'diag-down-right':
        document.documentElement.animate(
          {
            clipPath: [
              `polygon(0 0, 0 0, 0 0, 0 0)`,
              `polygon(0 0, 100% 0, 100% 100%, 0 100%)`,
            ],
          },
          {
            duration: duration * 1.5,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'fade-in-out':
        document.documentElement.animate(
          {
            opacity: [0, 1],
          },
          {
            duration: duration * 0.5,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'shrink-grow':
        document.documentElement.animate(
          [
            { transform: 'scale(0.9)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          {
            duration: duration * 1.2,
            easing: 'cubic-bezier(0.19, 1, 0.22, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        document.documentElement.animate(
          [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(1.05)', opacity: 0 },
          ],
          {
            duration: duration * 1.2,
            easing: 'cubic-bezier(0.19, 1, 0.22, 1)',
            pseudoElement: '::view-transition-old(root)',
          }
        )
        break

      case 'flip-x-in': {
        const styleElement = document.createElement('style')
        styleElement.textContent = `
          ::view-transition-group(root) { perspective: 1000px; }
          ::view-transition-old(root) { transform-origin: center; animation: flip-out 400ms forwards; }
          ::view-transition-new(root) { transform-origin: center; animation: flip-in 400ms forwards; }

          @keyframes flip-out { from { transform: rotateY(0deg); opacity: 1; } to { transform: rotateY(-90deg); opacity: 0; } }
          @keyframes flip-in { from { transform: rotateY(90deg); opacity: 0; } to { transform: rotateY(0deg); opacity: 1; } }
        `
        document.head.appendChild(styleElement)
        break
      }

      case 'split-vertical':
        document.documentElement.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: duration * 0.75,
          easing: 'ease-in',
          pseudoElement: '::view-transition-new(root)',
        })
        document.documentElement.animate(
          [
            { clipPath: 'inset(0 0 0 0)', transform: 'none' },
            { clipPath: 'inset(0 40% 0 40%)', transform: 'scale(1.2)' },
            { clipPath: 'inset(0 50% 0 50%)', transform: 'scale(1)' },
          ],
          {
            duration: duration * 1.5,
            easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            pseudoElement: '::view-transition-old(root)',
          }
        )
        break

      case 'swipe-right':
        document.documentElement.animate(
          {
            clipPath: [`inset(0 ${viewportWidth}px 0 0)`, `inset(0 0 0 0)`],
          },
          {
            duration,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'swipe-down':
        document.documentElement.animate(
          {
            clipPath: [`inset(0 0 ${viewportHeight}px 0)`, `inset(0 0 0 0)`],
          },
          {
            duration,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'wave-ripple':
        document.documentElement.animate(
          {
            clipPath: [`circle(0% at 50% 50%)`, `circle(${maxRadius}px at 50% 50%)`],
          },
          {
            duration: duration * 1.5,
            easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            pseudoElement: '::view-transition-new(root)',
          }
        )
        break

      case 'none':
      default:
        break
    }
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

      {animation !== 'flip-x-in' && (
        <style>{`
          ::view-transition-old(root),
          ::view-transition-new(root) {
            animation: none;
            mix-blend-mode: normal;
          }
        `}</style>
      )}
    </>
  )
}
