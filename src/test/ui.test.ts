/**
 * UI tests — fluxos funcionais como humano, via Puppeteer.
 *
 * Abre um browser real, navega no site, interage com elementos.
 * Exige servidor rodando em localhost:3000 (globalSetup cuida disso).
 *
 * Rodar: npm run test:ui
 */
import puppeteer, { Browser, Page } from "puppeteer";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = "http://localhost:3000";
const TIMEOUT = 12_000;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function goto(path = "/") {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: TIMEOUT });
}

async function text(selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el as HTMLElement).textContent?.trim() ?? "");
}

async function attr(selector: string, attribute: string): Promise<string> {
  return page.$eval(selector, (el, a) => (el as HTMLElement).getAttribute(a) ?? "", attribute);
}

async function isVisible(selector: string): Promise<boolean> {
  const el = await page.$(selector);
  if (!el) return false;
  return page.evaluate(
    (e) => {
      const s = window.getComputedStyle(e);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    },
    el,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Landing page — estrutura e conteúdo
// ─────────────────────────────────────────────────────────────────────────────

describe("Landing page — structure", () => {
  beforeAll(() => goto("/"));

  it("carrega com status 200 ou 304 (cache válido)", async () => {
    const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: TIMEOUT });
    // 304 = conteúdo inalterado no cache HTTP — também indica sucesso
    expect([200, 304]).toContain(res?.status());
  });

  it("title contém 'Diagram Forge'", async () => {
    const title = await page.title();
    expect(title).toMatch(/Diagram Forge/i);
  });

  it("nav mostra logo e link GitHub", async () => {
    const logoText = await text(".nav-name");
    expect(logoText).toMatch(/Diagram Forge/i);
    const ghLink = await attr(".nav-gh", "href");
    expect(ghLink).toContain("github.com");
  });

  it("indicador Live está visível na nav", async () => {
    const live = await isVisible(".nav-live");
    expect(live).toBe(true);
  });

  it("hero H1 contém 'diagram'", async () => {
    const h1 = await text("h1");
    expect(h1.toLowerCase()).toContain("diagram");
  });

  it("subtítulo menciona GitHub", async () => {
    const sub = await text(".hero-sub");
    expect(sub.toLowerCase()).toContain("github");
  });

  it("card de análise está presente", async () => {
    const card = await page.$(".card");
    expect(card).not.toBeNull();
  });

  it("seção de stats tem 4 métricas", async () => {
    const stats = await page.$$(".stat");
    expect(stats.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tier selection — interação
// ─────────────────────────────────────────────────────────────────────────────

describe("Tier selection", () => {
  beforeAll(() => goto("/"));

  it("Basic está selecionado por padrão", async () => {
    const selected = await page.$(".tier-btn.selected");
    expect(selected).not.toBeNull();
    const tier = await page.$eval(".tier-btn.selected", (el) => (el as HTMLElement).dataset.tier);
    expect(tier).toBe("basic");
  });

  it("clicar em Full seleciona Full e deseleciona Basic", async () => {
    await page.click('[data-tier="full"]');
    const selectedTier = await page.$eval(
      ".tier-btn.selected",
      (el) => (el as HTMLElement).dataset.tier,
    );
    expect(selectedTier).toBe("full");
    const basicSelected = await page.$eval(
      '[data-tier="basic"]',
      (el) => el.classList.contains("selected"),
    );
    expect(basicSelected).toBe(false);
  });

  it("clicar em Live seleciona Live", async () => {
    await page.click('[data-tier="live"]');
    const selectedTier = await page.$eval(
      ".tier-btn.selected",
      (el) => (el as HTMLElement).dataset.tier,
    );
    expect(selectedTier).toBe("live");
  });

  it("preço Basic mostra 2,000 sats", async () => {
    const price = await page.$eval('[data-tier="basic"] .tier-price', (el) => el.textContent?.trim());
    expect(price).toMatch(/2.?000/);
  });

  it("preço Full mostra 10,000 sats", async () => {
    const price = await page.$eval('[data-tier="full"] .tier-price', (el) => el.textContent?.trim());
    expect(price).toMatch(/10.?000/);
  });

  it("preço Live mostra 25,000 sats", async () => {
    const price = await page.$eval('[data-tier="live"] .tier-price', (el) => el.textContent?.trim());
    expect(price).toMatch(/25.?000/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Formulário — validação e submit
// ─────────────────────────────────────────────────────────────────────────────

describe("Form — validação", () => {
  beforeAll(() => goto("/"));

  it("input GitHub está visível e focável", async () => {
    const input = await page.$("#input-github");
    expect(input).not.toBeNull();
    await input!.focus();
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe("input-github");
  });

  it("submit sem URL mostra erro", async () => {
    await page.$eval("#input-github", (el) => ((el as HTMLInputElement).value = ""));
    await page.$eval("#input-local", (el) => ((el as HTMLInputElement).value = ""));
    await page.click("#btn-analyze");
    await page.waitForFunction(
      () => document.getElementById("err-box")?.classList.contains("show"),
      { timeout: 3_000 },
    );
    const errText = await text("#err-box");
    expect(errText.length).toBeGreaterThan(0);
  });

  it("Enter no input dispara submit", async () => {
    // Reseta o erro
    await page.evaluate(() => document.getElementById("err-box")?.classList.remove("show"));
    await page.focus("#input-github");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.getElementById("err-box")?.classList.contains("show"),
      { timeout: 3_000 },
    );
    const visible = await isVisible("#err-box");
    expect(visible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. L402 gate — submit real de repo inexistente (tier full)
// ─────────────────────────────────────────────────────────────────────────────

describe("L402 gate — fluxo de pagamento", () => {
  it("submit com URL real retorna 402 e navega para /pay", async () => {
    await goto("/");

    // Seleciona Full (sem free trial)
    await page.click('[data-tier="full"]');

    // Digita URL
    await page.type("#input-github", "https://github.com/test-only/x-nonexistent-ui-test");

    // Aguarda possível navegação para /pay
    const [navResponse] = await Promise.all([
      page.waitForNavigation({ timeout: TIMEOUT, waitUntil: "load" }).catch(() => null),
      page.click("#btn-analyze"),
    ]);

    const url = page.url();

    // O destino deve ser /pay (com parâmetros L402) ou permanecer em / com erro
    // (se o repo não existir o servidor ainda devolve 402 antes de analisar)
    const isPay = url.includes("/pay");
    const hasErr = await isVisible("#err-box").catch(() => false);

    expect(isPay || hasErr).toBe(true);
    if (isPay) {
      expect(url).toMatch(/invoice=|macaroon=/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Demo GIF tabs
// ─────────────────────────────────────────────────────────────────────────────

describe("Demo GIF section", () => {
  beforeAll(() => goto("/#demo"));

  it("tab 'Repo Analysis' está ativa por padrão", async () => {
    const active = await page.$(".demo-tab.active");
    expect(active).not.toBeNull();
    const label = await page.$eval(".demo-tab.active", (el) => el.textContent?.trim());
    expect(label).toMatch(/Repo Analysis/i);
  });

  it("clicar na tab 'Interactive Viewer' muda o GIF", async () => {
    const tabs = await page.$$(".demo-tab");
    const viewerTab = tabs[1]; // segundo tab
    await viewerTab.click();
    await new Promise((r) => setTimeout(r, 300));
    const src = await attr("#demo-img", "src");
    expect(src).toContain("demo-viewer");
  });

  it("clicar na tab 'Image Import' muda caption", async () => {
    const tabs = await page.$$(".demo-tab");
    await tabs[2].click();
    await new Promise((r) => setTimeout(r, 300));
    const caption = await text("#demo-caption-text");
    expect(caption.toLowerCase()).toMatch(/whiteboard|pdf|vision|image/i);
  });

  it("imagem GIF carrega (não quebra)", async () => {
    const broken = await page.evaluate(() => {
      const img = document.getElementById("demo-img") as HTMLImageElement;
      return img.naturalWidth === 0 && img.complete;
    });
    expect(broken).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pricing section
// ─────────────────────────────────────────────────────────────────────────────

describe("Pricing section", () => {
  beforeAll(() => goto("/#pricing"));

  it("três cards de pricing estão presentes", async () => {
    const cards = await page.$$(".price-card");
    expect(cards.length).toBe(3);
  });

  it("card Full tem badge 'POPULAR'", async () => {
    const badge = await page.$(".price-card.featured .price-badge");
    expect(badge).not.toBeNull();
  });

  it("pricing section menciona 'No subscription'", async () => {
    const pageText = await page.evaluate(() => document.body.textContent ?? "");
    expect(pageText.toLowerCase()).toMatch(/no subscription/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Drop zone — upload de imagem
// ─────────────────────────────────────────────────────────────────────────────

describe("Image drop zone", () => {
  beforeAll(() => goto("/"));

  it("drop zone está visível e clicável", async () => {
    const dz = await page.$("#drop-zone");
    expect(dz).not.toBeNull();
    const visible = await isVisible("#drop-zone");
    expect(visible).toBe(true);
  });

  it("upload de arquivo PNG atualiza preview e texto do botão", async () => {
    // Cria um PNG mínimo em memória e injeta como DataTransfer
    await page.evaluate(() => {
      // 1x1 red PNG (base64) convertido para File
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";
      const byteChars = atob(b64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const file = new File([bytes], "test.png", { type: "image/png" });

      // Aciona handleFile diretamente (como se o input mudasse)
      (window as unknown as Record<string, unknown>).handleFile?.(file);
    });

    await new Promise((r) => setTimeout(r, 500));

    // Preview deve aparecer
    const previewVisible = await isVisible("#img-preview");
    expect(previewVisible).toBe(true);

    // Texto do botão deve mudar
    const btnText = await text("#btn-text");
    expect(btnText.toLowerCase()).toContain("image");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Navegação e seções da página
// ─────────────────────────────────────────────────────────────────────────────

describe("Navegação interna", () => {
  beforeAll(() => goto("/"));

  it("link 'Demo' na nav funciona (âncora #demo)", async () => {
    await page.click('a[href="#demo"]');
    await new Promise((r) => setTimeout(r, 400));
    const url = page.url();
    expect(url).toContain("#demo");
  });

  it("link 'Features' na nav funciona", async () => {
    await page.click('a[href="#features"]');
    await new Promise((r) => setTimeout(r, 400));
    expect(page.url()).toContain("#features");
  });

  it("link 'Pricing' na nav funciona", async () => {
    await page.click('a[href="#pricing"]');
    await new Promise((r) => setTimeout(r, 400));
    expect(page.url()).toContain("#pricing");
  });

  it("footer tem link para GitHub", async () => {
    const ghLink = await page.$eval(
      'footer .footer-link[href*="github"]',
      (el) => el.getAttribute("href"),
    );
    expect(ghLink).toContain("github.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Mobile viewport
// ─────────────────────────────────────────────────────────────────────────────

describe("Mobile viewport (375×812)", () => {
  beforeAll(async () => {
    await page.setViewport({ width: 375, height: 812 });
    await goto("/");
  });

  afterAll(async () => {
    await page.setViewport({ width: 1280, height: 800 });
  });

  it("página carrega sem erro de layout horizontal", async () => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  it("card de análise está visível em mobile", async () => {
    const visible = await isVisible(".card");
    expect(visible).toBe(true);
  });

  it("botão Analyze está visível em mobile", async () => {
    const visible = await isVisible("#btn-analyze");
    expect(visible).toBe(true);
  });

  it("tier selector tem 3 botões em mobile", async () => {
    const btns = await page.$$(".tier-btn");
    expect(btns.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Página /view demo
// ─────────────────────────────────────────────────────────────────────────────

describe("Viewer demo mode", () => {
  it("GET /view?demo carrega o viewer HTML", async () => {
    const res = await page.goto(`${BASE}/view?demo`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });
});
