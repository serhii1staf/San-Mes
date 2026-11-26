// The soft inverted corner for the chat header band (src/components/chat/ChatHeaderSheet.tsx):
// white with alpha, the top-left corner; the right one is the same image mirrored.
//
// The band is solid down to its edge, and below the edge the transcript reads as a card with rounded
// TOP corners tucked under it. Inside the corner tile the alpha falls off with the distance into that
// card (smoothstep over FADE pt, the same curve as the band's straight edge), and the shoulder fades
// out toward the tile's bottom so the corner has no hard end at the screen edge.
const fs = require('fs');
const { PNG } = require('C:/Users/Bruker/Downloads/San-Mes/node_modules/pngjs');
const R = 34;
const FADE = 26;
const S = 3;
const N = R * S;
const png = new PNG({ width: N, height: N });
const smooth = (t) => t * t * (3 - 2 * t);
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    const x = (px + 0.5) / S;
    const y = (py + 0.5) / S;
    const dist = Math.hypot(R - x, R - y);
    let a = dist >= R ? 1 : 1 - smooth(Math.min(1, (R - dist) / FADE));
    a *= 1 - smooth(Math.min(1, Math.max(0, (y / R - 0.5) / 0.5)));
    const i = (py * N + px) * 4;
    png.data[i] = 255;
    png.data[i + 1] = 255;
    png.data[i + 2] = 255;
    png.data[i + 3] = Math.round(a * 255);
  }
}
const out = 'C:/Users/Bruker/Downloads/San-Mes/assets/chat-header-corner.png';
fs.writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out} ${N}x${N}`);
