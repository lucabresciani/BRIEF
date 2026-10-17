/** App mark: a plot frame with three measurements and a fitted line. Single geometric glyph. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="21" height="21" rx="4" fill="var(--primary)" />
      <path
        d="M6 5.5V18h12.5"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 16 17.5 7.5"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="13.4" r="1.45" fill="white" />
      <circle cx="12.6" cy="12.1" r="1.45" fill="white" />
      <circle cx="15.6" cy="8.9" r="1.45" fill="white" />
    </svg>
  )
}
