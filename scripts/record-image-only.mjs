import puppeteer from "puppeteer";
import GIFEncoder from "gif-encoder-2";
import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import gifsicle from "gifsicle";

const W = 960, H = 540, BASE = "http://localhost:3000";
const DOCS = new URL("../docs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function captureFrames(page, count, intervalMs = 150) {
  const f = [];
  for (let i = 0; i < count; i++) {
    f.push(await page.screenshot({ type: "png" }));
    if (i < count - 1) await sleep(intervalMs);
  }
  return f;
}

async function makeGIF(name, frames, delayMs = 80) {
  const outPath = path.join(DOCS, name);
  const encoder = new GIFEncoder(W, H, "neuquant", true);
  const stream = encoder.createReadStream();
  const chunks = [];
  stream.on("data", c => chunks.push(c));
  encoder.start(); encoder.setRepeat(0); encoder.setDelay(delayMs); encoder.setQuality(10);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  for (const frame of frames) {
    const img = await loadImage(frame);
    ctx.drawImage(img, 0, 0, W, H);
    encoder.addFrame(ctx.getImageData(0, 0, W, H).data);
  }
  encoder.finish();
  await new Promise(r => stream.on("end", r));
  const raw = Buffer.concat(chunks);
  fs.writeFileSync(outPath, raw);
  try {
    const tmp = outPath + ".tmp.gif";
    fs.renameSync(outPath, tmp);
    execFileSync(gifsicle, ["--optimize=3", "--colors", "128", "--lossy=80", "-o", outPath, tmp]);
    fs.unlinkSync(tmp);
    console.log(`✅ ${name} — ${Math.round(fs.statSync(outPath).size / 1024)} KB`);
  } catch { console.log(`✅ ${name} (raw)`); }
}

const DEMO_GRAPH = {
  nodes: [
    { id: "cli", label: "Meltano CLI", type: "backend", technology: "Python", description: "CLI entrypoint" },
    { id: "core", label: "Core Engine", type: "backend", technology: "Python", description: "Pipeline engine" },
    { id: "db", label: "PostgreSQL", type: "database", technology: "PostgreSQL", description: "Data warehouse" },
    { id: "dbt", label: "dbt Transform", type: "worker", technology: "dbt", description: "SQL transforms" },
    { id: "api", label: "REST API", type: "backend", technology: "FastAPI", description: "HTTP API" },
    { id: "tap", label: "Singer Tap", type: "worker", technology: "Singer", description: "Data extractor" },
    { id: "target", label: "Singer Target", type: "worker", technology: "Singer", description: "Data loader" },
  ],
  edges: [
    { from: "cli", to: "core", protocol: "HTTP", direction: "unidirectional", async: false },
    { from: "core", to: "tap", protocol: "HTTP", direction: "unidirectional", async: true },
    { from: "tap", to: "db", protocol: "SQL", direction: "unidirectional", async: false },
    { from: "core", to: "dbt", protocol: "HTTP", direction: "unidirectional", async: true },
    { from: "dbt", to: "db", protocol: "SQL", direction: "unidirectional", async: false },
    { from: "cli", to: "api", protocol: "HTTP", direction: "unidirectional", async: false },
    { from: "core", to: "target", protocol: "HTTP", direction: "unidirectional", async: true },
    { from: "target", to: "db", protocol: "SQL", direction: "unidirectional", async: false },
  ],
  summary: "Meltano ELT platform — CLI-driven Singer + dbt pipeline with PostgreSQL.",
  tech_stack: ["Python", "dbt", "PostgreSQL", "FastAPI", "Singer"],
  confidence: 0.88,
  analysis_steps: 12,
};

async function apiShare(graph) {
  const r = await fetch(`${BASE}/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  return r.json();
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  console.log("🎬 Recording demo-image.gif ...");
  const shareRes = await apiShare(DEMO_GRAPH);
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.goto(`${BASE}/g/${shareRes.id}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await sleep(800);

  const frames = [];
  frames.push(...await captureFrames(page, 5, 120));

  // Inject drop-zone UI
  await page.evaluate(() => {
    const o = document.createElement("div");
    o.className = "df-image-demo";
    o.style.cssText = "position:fixed;inset:0;background:rgba(13,17,23,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:Inter,system-ui,sans-serif;";
    o.innerHTML = `<div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:36px 44px;max-width:520px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.6);color:#e6edf3">
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:800">Import from Image</h2>
      <p style="margin:0 0 24px;color:#8b949e;font-size:14px">Upload a whiteboard photo, screenshot, Visio export, or PDF</p>
      <div id="drop-zone" style="border:2px dashed #7c3aed;border-radius:12px;padding:40px 24px;text-align:center;background:rgba(124,58,237,.04)">
        <div style="font-size:36px;margin-bottom:12px">🖼️</div>
        <div style="color:#e6edf3;font-weight:600;margin-bottom:6px">Drop your diagram here</div>
        <div style="font-size:12px;color:#8b949e">PNG · JPG · PDF · WebP — or click to browse</div>
      </div>
      <div style="margin-top:16px;padding:12px;background:#0d1117;border-radius:8px;font-size:12px;color:#8b949e;border:1px solid #21262d">
        💡 Works with whiteboard photos, Visio exports, Lucidchart screenshots, hand-drawn sketches
      </div>
    </div>`;
    document.body.appendChild(o);
  });
  await sleep(300);
  frames.push(...await captureFrames(page, 5, 150));

  // Hover state
  await page.evaluate(() => {
    const dz = document.getElementById("drop-zone");
    if (dz) { dz.style.borderColor = "#a855f7"; dz.style.background = "rgba(168,85,247,.08)"; dz.querySelector("div:nth-child(2)").textContent = "Drop to analyze with Claude Vision"; }
  });
  frames.push(...await captureFrames(page, 4, 150));

  // Analyzing state
  await page.evaluate(() => {
    const dz = document.getElementById("drop-zone");
    if (dz) dz.innerHTML = `<div style="font-size:28px;margin-bottom:12px">🔍</div>
      <div style="color:#a855f7;font-weight:700;margin-bottom:6px">Claude Vision analyzing…</div>
      <div style="font-size:12px;color:#8b949e">Detecting services, connections, protocols…</div>
      <div style="margin-top:16px;width:200px;height:3px;background:#21262d;border-radius:3px;overflow:hidden;margin:16px auto 0">
        <div id="img-prog" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#a855f7);border-radius:3px"></div>
      </div>`;
  });
  for (let p = 0; p <= 100; p += 11) {
    await page.evaluate(pct => { const el = document.getElementById("img-prog"); if (el) el.style.width = pct + "%"; }, p);
    frames.push(await page.screenshot({ type: "png" }));
    await sleep(170);
  }

  // Reveal diagram
  await page.evaluate(() => document.querySelector(".df-image-demo")?.remove());
  await sleep(300);
  frames.push(...await captureFrames(page, 10, 150));

  await page.close();
  await makeGIF("demo-image.gif", frames, 110);
} finally {
  await browser.close();
}
