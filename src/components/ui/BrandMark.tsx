interface BrandMarkProps {
  size?: number;
  variant?: 'badge' | 'duotone';
  className?: string;
}

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
    <img
      src="/pwa-64x64.png"
      width={size}
      height={size}
      alt=""
      className={className}
    />
  );
}
