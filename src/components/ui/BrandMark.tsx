interface BrandMarkProps {
  size?: number;
  variant?: 'badge' | 'duotone';
  className?: string;
}

/**
 * Custom RTL Persian notebook brand mark («شیرازه و برگ»).
 *
 * Uses semantic CSS custom properties (`--accent`, `--surface`, `--canvas`,
 * `--label-sand`, `--ink`, `--separator`) — never raw hex — so it adapts
 * automatically between light and dark themes (DESIGN.md §1).
 *
 * Optical sizing:
 * - `badge` (32px navbar mark): bold silhouette, crisp spine, and 2 high-contrast lines.
 * - `duotone` (56px empty-state emblem): layered sheets, folded corner, sand bookmark, and 3 lines.
 */
export function BrandMark({
  size = 32,
  variant = 'badge',
  className,
}: BrandMarkProps) {
  if (variant === 'duotone') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        {/* Back stacked sheet on the left (inline-end) */}
        <rect
          x="10"
          y="11"
          width="36"
          height="42"
          rx="6"
          fill="var(--accent-soft)"
          stroke="var(--separator)"
          strokeWidth="1.25"
        />

        {/* Sand bookmark ribbon (--label-sand) */}
        <path
          d="M19 49H26V58L22.5 55.2L19 58V49Z"
          fill="var(--label-sand)"
        />

        {/* Main warm paper sheet with top-left page fold */}
        <path
          d="M23 8H47C50.3137 8 53 10.6863 53 14V48C53 51.3137 50.3137 54 47 54H19C15.6863 54 13 51.3137 13 48V18L23 8Z"
          fill="var(--surface)"
          stroke="var(--separator)"
          strokeWidth="1.5"
        />

        {/* Top-left folded corner */}
        <path
          d="M23 8V15C23 16.6569 21.6569 18 20 18H13L23 8Z"
          fill="var(--accent-soft)"
          stroke="var(--separator)"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />

        {/* Right (inline-start) RTL Spine */}
        <path
          d="M44 8H47C50.3137 8 53 10.6863 53 14V48C53 51.3137 50.3137 54 47 54H44V8Z"
          fill="var(--accent)"
        />

        {/* Spine binding stitches */}
        <rect x="47.25" y="15" width="2.5" height="4.5" rx="1.25" fill="var(--surface)" />
        <rect x="47.25" y="28.75" width="2.5" height="4.5" rx="1.25" fill="var(--surface)" />
        <rect x="47.25" y="42.5" width="2.5" height="4.5" rx="1.25" fill="var(--surface)" />

        {/* Right-aligned (RTL) Persian lines */}
        <circle cx="38" cy="21" r="1.75" fill="var(--label-sand)" />
        <rect x="24" y="19.5" width="11" height="3" rx="1.5" fill="var(--accent)" />
        <rect x="19" y="28" width="20.5" height="2.5" rx="1.25" fill="var(--ink)" fillOpacity="0.28" />
        <rect x="22" y="34.5" width="17.5" height="2.5" rx="1.25" fill="var(--ink)" fillOpacity="0.28" />
        <rect x="27" y="41" width="12.5" height="2.5" rx="1.25" fill="var(--ink)" fillOpacity="0.18" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Squircle badge chassis */}
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        stroke="var(--glass-edge)"
        strokeWidth="1"
      />

      {/* Sand bookmark ribbon at bottom-left */}
      <path d="M11 23.5H14V27.5L12.5 26.3L11 27.5V23.5Z" fill="var(--label-sand)" />

      {/* Main notebook sheet with top-left fold */}
      <path
        d="M12.5 6.5H21.5C22.8807 6.5 24 7.61929 24 9V23C24 24.3807 22.8807 25.5 21.5 25.5H10.5C9.11929 25.5 8 24.3807 8 23V11L12.5 6.5Z"
        fill="var(--surface)"
      />

      {/* Top-left folded corner */}
      <path
        d="M12.5 6.5V9.5C12.5 10.3284 11.8284 11 11 11H8L12.5 6.5Z"
        fill="var(--accent-soft)"
      />

      {/* Right (inline-start) RTL Spine */}
      <path
        d="M19.5 6.5H21.5C22.8807 6.5 24 7.61929 24 9V23C24 24.3807 22.8807 25.5 21.5 25.5H19.5V6.5Z"
        fill="var(--ink)"
        fillOpacity="0.28"
      />

      {/* Spine stitches */}
      <rect x="21" y="9.5" width="1.5" height="2.75" rx="0.75" fill="var(--surface)" />
      <rect x="21" y="14.625" width="1.5" height="2.75" rx="0.75" fill="var(--surface)" />
      <rect x="21" y="19.75" width="1.5" height="2.75" rx="0.75" fill="var(--surface)" />

      {/* Right-aligned lines inside sheet */}
      <circle cx="17" cy="12.25" r="1.1" fill="var(--label-sand)" />
      <rect x="11.5" y="11.35" width="4.2" height="1.8" rx="0.9" fill="var(--accent)" />
      <rect x="10.25" y="15.5" width="7.75" height="1.6" rx="0.8" fill="var(--ink)" fillOpacity="0.38" />
      <rect x="12.25" y="19" width="5.75" height="1.6" rx="0.8" fill="var(--ink)" fillOpacity="0.26" />
    </svg>
  );
}
