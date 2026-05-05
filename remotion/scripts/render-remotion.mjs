import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition, openBrowser } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "video";
const outputArg = process.argv[3];
const frameArg = process.argv[4];

console.log("Bundling...");
const bundled = await bundle({
  entryPoint: path.resolve(__dirname, "../src/index.ts"),
  webpackOverride: (config) => config,
});

console.log("Launching browser...");
const browser = await openBrowser("chrome", {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/bin/chromium",
  chromiumOptions: {
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  },
  chromeMode: "chrome-for-testing",
});

const composition = await selectComposition({
  serveUrl: bundled,
  id: "main",
  puppeteerInstance: browser,
});

if (mode === "still") {
  const out = outputArg || "/tmp/still.png";
  const frame = parseInt(frameArg || "60", 10);
  console.log(`Rendering still frame ${frame} -> ${out}`);
  await renderStill({
    composition,
    serveUrl: bundled,
    output: out,
    frame,
    puppeteerInstance: browser,
  });
} else {
  const out = outputArg || "/mnt/documents/izenzo-yc-walkthrough.mp4";
  console.log(`Rendering video -> ${out}`);
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: out,
    puppeteerInstance: browser,
    muted: true,
    concurrency: 1,
    onProgress: ({ progress }) => {
      if (Math.floor(progress * 100) % 5 === 0) {
        process.stdout.write(`\rProgress: ${(progress * 100).toFixed(0)}%   `);
      }
    },
  });
  console.log("\nDone");
}

await browser.close({ silent: false });
