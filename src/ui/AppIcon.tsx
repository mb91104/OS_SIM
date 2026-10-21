import type { SVGProps } from "react";

/**
 * Monochrome line icons for apps and devices.
 *
 * They inherit `currentColor`, so the terminal's grey ramp drives them: dim in
 * a title bar, inverted when a Dock cell is hovered. `stroke="currentColor"`
 * also keeps the "paints only in greys" test honest — no baked-in hues.
 */
const paths: Record<string, React.ReactNode> = {
  browser: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
    </>
  ),
  music: (
    <>
      <path d="M9 17V6l10-2v11" />
      <circle cx="6" cy="17" r="3" />
      <circle cx="16" cy="15" r="3" />
    </>
  ),
  photos: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <circle cx="8.5" cy="9.5" r="1.7" />
      <path d="M4 18l5-5 4 4 3-2 4 4" />
    </>
  ),
  files: (
    <>
      <path d="M3 6h6l2 2h10v11H3z" />
      <path d="M3 10h18" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5" />
      <rect x="3" y="8" width="18" height="8" />
      <rect x="7" y="14" width="10" height="7" />
    </>
  ),
  code: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M7 9l4 3-4 3" />
      <path d="M13 15h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3v12H4z" />
      <circle cx="12" cy="14" r="3.4" />
    </>
  ),
  speakers: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  system: (
    <>
      <path d="M4 6h2.5M4 12h2.5M4 18h2.5" />
      <path d="M9.5 6h10M9.5 12h10M9.5 18h10" />
    </>
  ),
  device: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

interface Props extends Omit<SVGProps<SVGSVGElement>, "appId"> {
  appId: string;
  size?: number;
}

export function AppIcon({ appId, size = 16, className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`app-icon ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[appId] ?? paths.device}
    </svg>
  );
}
