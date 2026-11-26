// The corners of the chat header band (src/components/chat/ChatHeaderSheet.tsx): white with alpha,
// the top-left corner; the right one is the same image mirrored.
//
// The conversation reads as a card with rounded TOP corners tucked under the band. Alpha is a
// function of one distance, from the card's edge out into the band (a signed distance field), so the
// band's colour and the iOS blur follow exactly the same rounded line; only how far each one takes to
// come in differs (`FADE` per asset). The tile covers the corner quadrant from `FADE_MAX` above the
// card's top edge down to where the arc meets the screen's side, so it joins the straight edge
// gradient (same curve, same distance) without a seam and ends without a cut.
//
// Run with `node scripts/make-chat-header-corner.js` after changing a constant here, and keep RADIUS,
// FADE_* and FADE_MAX equal to the ones in ChatHeaderSheet.tsx.
const fs = require('fs');
const path = require('path');
const { PNG } = require(path.join(__dirname, '..', 'node_modules', 'pngjs'));

const RADIUS = 56;
const FADE_MAX = 20;
const SCALE = 3;
const smooth = (t) => t * t * (3 - 2 * t);

function corner(file, fade) {
  const w = RADIUS * SCALE;
  const h = (FADE_MAX + RADIUS) * SCALE;
  const png = new PNG({ width: w, height: h });
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / SCALE;
      // From the card's top edge, positive downward.
      const y = (py + 0.5) / SCALE - FADE_MAX;
      // Distance from the arc (centre RADIUS, RADIUS) out into the band; negative inside the card.
      const d = Math.hypot(RADIUS - x, RADIUS - y) - RADIUS;
      const a = d <= 0 ? 0 : smooth(Math.min(1, d / fade));
      const i = (py * w + px) * 4;
      png.data[i] = 255;
      png.data[i + 1] = 255;
      png.data[i + 2] = 255;
      png.data[i + 3] = Math.round(a * 255);
    }
  }
  const out = path.join(__dirname, '..', 'assets', file);
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`wrote ${out} ${w}x${h}`);
}

// The colour comes in over 20 pt, so the band stays soft; the blur over 8, so the line reads clearly.
corner('chat-header-corner.png', 20);
corner('chat-header-corner-blur.png', 8);
