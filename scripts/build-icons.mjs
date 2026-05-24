import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const iconsDir = resolve(root, 'icons');

const main = readFileSync(resolve(iconsDir, 'icon.svg'));
const maskable = readFileSync(resolve(iconsDir, 'icon-maskable.svg'));

const targets = [
  { svg: main, size: 192, out: 'icon-192.png' },
  { svg: main, size: 512, out: 'icon-512.png' },
  { svg: main, size: 180, out: 'apple-touch-icon.png' },
  { svg: maskable, size: 512, out: 'icon-maskable-512.png' },
  { svg: main, size: 32, out: 'favicon-32.png' }
];

for (const { svg, size, out } of targets) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(resolve(iconsDir, out));
  console.log(`gerado: icons/${out} (${size}x${size})`);
}
