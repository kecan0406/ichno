// A 3×2 block of seats with one picked.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {[0, 1, 2].flatMap((col) =>
        [0, 1].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={2 + col * 7}
            y={5 + row * 8}
            width={6}
            height={6}
            rx={1.8}
            fill={col === 2 && row === 0 ? 'var(--theme-accent)' : 'currentColor'}
          />
        )),
      )}
    </svg>
  )
}
