// WARP wordmark icons. Light variant for light backgrounds, dark for dark.
// Kept compact — they're base64-encoded into JSON config files.

const LIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="16" fill="#1a1a2e"/>
  <text x="50" y="62" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">WARP</text>
</svg>`;

const DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="16" fill="#e8e8f0"/>
  <text x="50" y="62" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#1a1a2e" text-anchor="middle">WARP</text>
</svg>`;

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const ICON_LIGHT_DATA_URI = toDataUri(LIGHT_SVG);
export const ICON_DARK_DATA_URI = toDataUri(DARK_SVG);

export const ICONS = [
  {
    src: toDataUri(LIGHT_SVG),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "light" as const,
  },
  {
    src: toDataUri(DARK_SVG),
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "dark" as const,
  },
];
