/** Loads font dynamically via CSS */
export function loadFont(fontName: string, fontPath?: string) {
  if (typeof document === "undefined") return;

  const safeId = `font-${fontName.replace(/\s+/g, "-")}`;
  // Skip if already injected
  if (document.getElementById(safeId)) return;

  const resolvedFontPath = resolveFontPath(fontPath);

  const style = document.createElement("style");
  style.id = safeId;
  style.textContent = `
    @font-face {
      font-family: "${fontName}";
      src: url("${resolvedFontPath}") format('truetype');
      font-display: swap;
    }
  `;
  document.head.appendChild(style);
}

function resolveFontPath(fontPath?: string) {
  return `/${fontPath?.replace(/^\/+/, "")}`;
}