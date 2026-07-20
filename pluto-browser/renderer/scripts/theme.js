/* ═══════════════════════════════════════════════════════════════
   PLUTO — Theme Engine
   Color-adaptive omnibox, dominant color extraction
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const addressBar = document.querySelector('#address-bar');

  /* ── Color-Adaptive Address Bar ──────────────────────────── */
  plutoAPI.onTabUpdated((info) => {
    if (!info.active || !info.favicon) return;
    extractDominantColor(info.favicon).then(color => {
      if (color) {
        document.documentElement.style.setProperty('--omnibox-accent', color);
      } else {
        document.documentElement.style.setProperty('--omnibox-accent', 'var(--pluto-accent)');
      }
    });
  });

  /**
   * Extract dominant color from a favicon URL using a hidden canvas.
   * Returns an HSL color string or null.
   */
  function extractDominantColor(faviconUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 16;
          canvas.height = 16;
          ctx.drawImage(img, 0, 0, 16, 16);

          const data = ctx.getImageData(0, 0, 16, 16).data;
          let rSum = 0, gSum = 0, bSum = 0, count = 0;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            /* Skip transparent and near-white/near-black pixels */
            if (a < 128) continue;
            const brightness = (r + g + b) / 3;
            if (brightness < 20 || brightness > 235) continue;
            rSum += r; gSum += g; bSum += b; count++;
          }

          if (count === 0) { resolve(null); return; }

          const rAvg = Math.round(rSum / count);
          const gAvg = Math.round(gSum / count);
          const bAvg = Math.round(bSum / count);

          /* Convert to HSL and bump saturation for vibrancy */
          const [h, s, l] = rgbToHsl(rAvg, gAvg, bAvg);
          const color = `hsl(${h}, ${Math.min(s + 15, 100)}%, ${Math.max(Math.min(l, 55), 35)}%)`;
          resolve(color);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = faviconUrl;
    });
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }
})();
