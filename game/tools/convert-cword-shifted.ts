import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PNG } from "pngjs";

const DOS_SYS = join(import.meta.dir, "../../lf1/SYS");
const OUT = join(import.meta.dir, "../public/assets/CWORD_DIM.png");

const palRaw = readFileSync(join(DOS_SYS, "PAL"));
const grhRaw = readFileSync(join(DOS_SYS, "CWORD.GRH"));

const width = (grhRaw[0] << 8) | grhRaw[1];
const height = (grhRaw[2] << 8) | grhRaw[3];
const pixels = grhRaw.subarray(300);

const SHIFT = 47; // [0x96] = 0x2F from disassembly

// The game writes the PAL file to VGA DAC starting at register 1
// (out 0x3c8, 1), so VGA DAC[j] = PAL_file[(j - 1) & 0xFF].
// The dim effect reads the color at VGA DAC index (srcIdx + SHIFT).
function dacColor(dacIdx: number): [number, number, number] {
  const palIdx = (dacIdx - 1) & 0xff;
  const r6 = palRaw[palIdx * 3 + 0] & 0x3f;
  const g6 = palRaw[palIdx * 3 + 1] & 0x3f;
  const b6 = palRaw[palIdx * 3 + 2] & 0x3f;
  return [(r6 << 2) | (r6 >> 4), (g6 << 2) | (g6 >> 4), (b6 << 2) | (b6 >> 4)];
}

const png = new PNG({ width, height });
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const srcIdx = pixels[y * width + x];
    if (srcIdx === 0) {
      png.data[(y * width + x) * 4 + 3] = 0;
      continue;
    }
    const shifted = (srcIdx + SHIFT) & 0xff;
    const [r, g, b] = dacColor(shifted);
    const i = (y * width + x) * 4;
    png.data[i + 0] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
}

writeFileSync(OUT, PNG.sync.write(png));
console.log(`Written ${OUT} (${width}x${height}, palette shift +${SHIFT})`);
