/**
 * convert-grh.ts — Convert GRH files to PNG
 *
 * Both START.EXE and FIGHT.EXE load the PAL file and write it to the
 * VGA DAC starting at register 1 (out 0x3c8, 1), NOT register 0.
 * This shifts the entire palette by +1: PAL entry 0 → VGA DAC index 1,
 * PAL entry 1 → VGA DAC index 2, ..., PAL entry 255 → VGA DAC index 0.
 *
 * Index 0 is transparent for sprite blitting (addput skips index 0).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { PNG } from "pngjs";

const LF1_SYS = join(import.meta.dir, "../../lf1/SYS");

/**
 * Load palette from PAL file with the +1 DAC shift the game applies.
 *
 * The game's palette-set routine (FUN_142d_0060 / FUN_152b_0057) writes
 * 768 bytes to the VGA DAC starting at register 1:
 *     out(0x3c8, 1);
 *     for (i = 0; i < 0x300; i++) out(0x3c9, buffer[i]);
 *
 * The DAC auto-increments and wraps, so:
 *     VGA DAC[i] = PAL_file[(i - 1) & 0xFF]
 */
function loadPaletteFromPAL(path: string): Uint8Array {
  const raw = readFileSync(path);
  const palette = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const palIdx = (i - 1) & 0xff;
    const r6 = raw[palIdx * 3 + 0] & 0x3f;
    const g6 = raw[palIdx * 3 + 1] & 0x3f;
    const b6 = raw[palIdx * 3 + 2] & 0x3f;
    palette[i * 4 + 0] = (r6 << 2) | (r6 >> 4);
    palette[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
    palette[i * 4 + 2] = (b6 << 2) | (b6 >> 4);
    palette[i * 4 + 3] = 255;
  }

  // Index 0 = transparent for sprite blitting
  palette[3] = 0;

  return palette;
}
const OUT_DIR = join(import.meta.dir, "../assets");
const PUBLIC_DIR = join(import.meta.dir, "../public/assets");

function convertGRH(
  filePath: string,
  palette: Uint8Array,
  outPath: string,
  transparentIndex = 0,
) {
  const raw = readFileSync(filePath);
  const width = (raw[0] << 8) | raw[1];
  const height = (raw[2] << 8) | raw[3];
  const headerSize = 300;
  const pixelData = raw.subarray(headerSize);
  const computedHeight = Math.floor(pixelData.length / width);

  if (width === 0 || computedHeight === 0) {
    console.error(`Skipping ${filePath}: invalid dimensions ${width}x${height}`);
    return null;
  }

  const png = new PNG({ width, height: computedHeight });

  for (let y = 0; y < computedHeight; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x;
      const dstIdx = (y * width + x) * 4;
      const colorIdx = pixelData[srcIdx];
      png.data[dstIdx + 0] = palette[colorIdx * 4 + 0];
      png.data[dstIdx + 1] = palette[colorIdx * 4 + 1];
      png.data[dstIdx + 2] = palette[colorIdx * 4 + 2];
      png.data[dstIdx + 3] =
        colorIdx === transparentIndex ? 0 : palette[colorIdx * 4 + 3];
    }
  }

  const buffer = PNG.sync.write(png);
  writeFileSync(outPath, buffer);
  console.log(`Converted ${basename(filePath)} -> ${basename(outPath)} (${width}x${computedHeight})`);
  return { width, height: computedHeight };
}

const palette = loadPaletteFromPAL(join(LF1_SYS, "PAL"));

for (const dir of [OUT_DIR, PUBLIC_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const grhFiles = readdirSync(LF1_SYS).filter((f) =>
  f.toUpperCase().endsWith(".GRH"),
);

console.log(`Found ${grhFiles.length} GRH files to convert`);
console.log(`Using PAL file with +1 DAC shift (out 0x3c8, 1)\n`);

for (const file of grhFiles.sort()) {
  const inPath = join(LF1_SYS, file);
  const outName = file.replace(/\.GRH$/i, ".png");
  convertGRH(inPath, palette, join(OUT_DIR, outName));
  convertGRH(inPath, palette, join(PUBLIC_DIR, outName));
}

for (const extra of ["NEWFONTS", "WORDS"]) {
  const inPath = join(LF1_SYS, extra);
  if (existsSync(inPath)) {
    convertGRH(inPath, palette, join(OUT_DIR, `${extra}.png`));
    convertGRH(inPath, palette, join(PUBLIC_DIR, `${extra}.png`));
  }
}

console.log("\nDone!");
