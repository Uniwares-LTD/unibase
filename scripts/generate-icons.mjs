// Render the existing project-owned vector; no generated artwork or remote assets.
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
const svg = await readFile("src/app/icon.svg");
await mkdir("public/icons", { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["apple-touch-icon", 180],
]) {
  await sharp(svg).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#98492f" },
})
  .composite([
    {
      input: await sharp(svg).resize(384, 384).png().toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toFile("public/icons/maskable-512.png");
