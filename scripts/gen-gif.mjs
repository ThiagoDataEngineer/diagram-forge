import GIFEncoder from "gif-encoder-2";
import { Jimp } from "jimp";
import { createWriteStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(__dirname, "../vscode-extension/media");

const frames = [
  { file: "01-idle.png",       delay: 2500 },
  { file: "02-confirming.png", delay: 2500 },
  { file: "03-analyzing.png",  delay: 2000 },
  { file: "04-done.png",       delay: 3000 },
];

// Load first frame to get dimensions
const first = await Jimp.read(path.join(MEDIA, frames[0].file));
const W = first.bitmap.width;
const H = first.bitmap.height;

// Use widest frame as canvas width, tallest as canvas height
let maxW = W, maxH = H;
for (const f of frames) {
  const img = await Jimp.read(path.join(MEDIA, f.file));
  if (img.bitmap.width > maxW) maxW = img.bitmap.width;
  if (img.bitmap.height > maxH) maxH = img.bitmap.height;
}

const encoder = new GIFEncoder(maxW, maxH, "neuquant", true);
const out = createWriteStream(path.join(MEDIA, "demo-extension.gif"));
encoder.createReadStream().pipe(out);
encoder.start();
encoder.setRepeat(0);    // loop forever
encoder.setQuality(10);

for (const { file, delay } of frames) {
  const img = await Jimp.read(path.join(MEDIA, file));
  // Pad to maxW x maxH with #1e1e1e background
  const canvas = new Jimp({ width: maxW, height: maxH, color: 0x1e1e1eff });
  canvas.composite(img, 0, 0);

  const pixels = new Uint8Array(canvas.bitmap.data);
  // GIFEncoder expects RGB (no alpha)
  const rgb = new Uint8Array(maxW * maxH * 3);
  for (let i = 0; i < maxW * maxH; i++) {
    rgb[i * 3]     = pixels[i * 4];     // R
    rgb[i * 3 + 1] = pixels[i * 4 + 1]; // G
    rgb[i * 3 + 2] = pixels[i * 4 + 2]; // B
  }

  encoder.setDelay(delay);
  encoder.addFrame(rgb);
  console.log(`✅ added ${file} (${delay}ms)`);
}

encoder.finish();
await new Promise(r => out.on("finish", r));
console.log(`\n🎉 demo-extension.gif saved to vscode-extension/media/`);
