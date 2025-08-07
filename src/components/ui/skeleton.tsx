// src/components/ui/skeleton.tsx
'use client'
import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Generic grey placeholder with a subtle shimmer.
 * Use height/width classes where you drop it in.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-md bg-muted/30',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite]',
        'after:bg-gradient-to-r after:from-transparent after:via-muted/40 after:to-transparent',
        className,
      )}
      {...props}
    />
  )
}

/* Tailwind keyframes in your globals or tailwind.config.js
------------------------------------------------------------------------
  theme: {
    extend: {
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
------------------------------------------------------------------------
*/
