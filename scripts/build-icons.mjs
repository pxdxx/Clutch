import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'icons', 'svg', 'clutch-icon-512.svg');
const OUT_ICO = path.join(ROOT, 'icons', 'ico', 'clutch.ico');

const SIZES = [16, 32, 48, 64, 128, 256];

if (!fs.existsSync(SVG)) {
  console.error('Missing', SVG);
  process.exit(1);
}
const svg = fs.readFileSync(SVG);

const pngBuffers = [];
for (const s of SIZES) {
  const buf = await sharp(svg).resize(s, s).png().toBuffer();
  pngBuffers.push(buf);
}

const ico = await pngToIco(pngBuffers);
fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true });
fs.writeFileSync(OUT_ICO, ico);
console.log('Wrote', OUT_ICO);
