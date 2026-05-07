/**
 * Testes de integração reais contra a API Blink.
 * Requer: BLINK_API_KEY e BLINK_WALLET_ID no .env
 * Rodar: npm run test:blink
 *
 * Cria uma invoice real de 1 sat e verifica que está pendente.
 * NÃO paga — só valida que o backend está conectado e respondendo.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { BlinkBackend } from "../../payment/lightning.js";

const SKIP = !process.env.BLINK_API_KEY || !process.env.BLINK_WALLET_ID;

describe.skipIf(SKIP)("BlinkBackend — integração real", () => {
  let backend: BlinkBackend;

  beforeAll(() => {
    backend = new BlinkBackend(
      process.env.BLINK_API_KEY!,
      process.env.BLINK_WALLET_ID!
    );
  });

  it("cria invoice real de 1 sat e retorna payment_hash + bolt11", async () => {
    const invoice = await backend.createInvoice(1, "Diagram Forge — teste integração");

    expect(invoice.payment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(invoice.payment_request).toMatch(/^lnbc/);
    expect(invoice.amount_sats).toBe(1);
    expect(invoice.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

    console.log("\n⚡ Invoice criada com sucesso!");
    console.log(`   Hash:    ${invoice.payment_hash}`);
    console.log(`   Bolt11:  ${invoice.payment_request.slice(0, 40)}...`);
    console.log(`   Expira:  ${new Date(invoice.expires_at * 1000).toISOString()}`);
  }, 15_000);

  it("invoice recém-criada retorna status PENDENTE (não paga)", async () => {
    const invoice = await backend.createInvoice(1, "Diagram Forge — check status");
    const paid = await backend.checkPaid(invoice.payment_hash);

    expect(paid).toBe(false);
    console.log("\n✓ Invoice pendente confirmada (não paga)");
  }, 15_000);

  it("verifyPreimage valida SHA256 corretamente", () => {
    const preimage = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256")
      .update(Buffer.from(preimage, "hex"))
      .digest("hex");

    expect(backend.verifyPreimage(hash, preimage)).toBe(true);
    expect(backend.verifyPreimage(hash, "0".repeat(64))).toBe(false);
  });
});

describe("BlinkBackend — sem credenciais (skip automático)", () => {
  it("skipa se BLINK_API_KEY não estiver configurado", () => {
    if (SKIP) {
      console.log("ℹ️  BLINK_API_KEY não configurado — pulando testes reais");
    }
    expect(true).toBe(true);
  });
});
