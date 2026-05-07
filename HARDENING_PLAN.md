# Diagram Forge — Plano de Hardening Standalone

> Cole no agente do VS Code. **Todas as tarefas são autônomas** — não dependem de Redis, BullMQ, Postgres, ou nenhum serviço externo novo. Tudo roda no mesmo processo Node atual. Cada item tem **arquivo**, **linhas alvo**, **mudança** e **critério de aceitação**. Pode executar em qualquer ordem (mas sugestão de prioridade no fim).
>
> Dependências novas a adicionar (todas in-process, sem infra extra):
> ```bash
> npm i pino pino-http prom-client opossum express-rate-limit
> npm i -D vitest
> ```

---

## 1. SEGURANÇA — Sandbox, SSRF, XSS

### 1.1 Resolver symlinks antes do check de sandbox no filesystem
**Arquivo:** `src/tools/filesystem.ts` (em todas as funções que recebem `path` e checam `projectRoot`)
**Problema:** `path.resolve(absPath).startsWith(projectRoot)` não bloqueia symlinks. Repo com `link → /etc/passwd` é lido pela tool.
**Mudança:**
- Criar helper no topo do arquivo:
  ```ts
  function safeResolve(projectRoot: string, userPath: string): string {
    const rootReal = fs.realpathSync.native(projectRoot);
    const absolute = path.resolve(rootReal, userPath);
    let real: string;
    try {
      real = fs.realpathSync.native(absolute);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      // arquivo não existe ainda (caso write): valida o pai
      real = path.resolve(fs.realpathSync.native(path.dirname(absolute)), path.basename(absolute));
    }
    const rel = path.relative(rootReal, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Path outside sandbox");
    }
    return real;
  }
  ```
- Substituir todas as 4-5 ocorrências do check `startsWith(projectRoot)` por `safeResolve(projectRoot, userPath)` envolvido em try/catch que retorna o erro como string da tool.
**Aceitação:** repo com `ln -s /etc/passwd repo/x` + `read_file("x")` retorna erro "outside sandbox".

### ✅ 1.2 Bloquear SSRF e IPs privados no clone — DONE
**Arquivo:** `src/analyzer/clone.ts` (linhas ~18-34)
**Problema:** whitelist atual usa `endsWith` (permite `github.com.attacker.tld`). E não checa se hostname resolve para IP privado.
**Mudança:**
- Trocar whitelist para comparação exata: `const ALLOW = new Set(["github.com", "gitlab.com", "bitbucket.org"]); if (!ALLOW.has(url.hostname)) throw new Error("host not allowed");`
- Adicionar resolução DNS antes do clone:
  ```ts
  import { promises as dns } from "node:dns";
  const addrs = await dns.lookup(url.hostname, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("resolves to private IP");
  }
  ```
- Implementar `isPrivateIp`: blocks `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`.
**Aceitação:** `https://github.com.evil.tld/x/y` → 400; URL que resolve para 10.0.0.1 → 400.

### 1.3 Escapar input derivado do repo no SVG
**Arquivo:** `src/diagram/svg.ts` (linhas ~172-181 nos labels; ~268-274 no embed do JSON)
**Problema:** `node.label`, `node.description`, `edge.label` vão crus para SVG/HTML. README com `</text><script>` malicioso → XSS no viewer.
**Mudança:**
- Aplicar `escapeXml` (já existe) em **todo** texto derivado do grafo: labels de nodes, descriptions, file paths, edge labels, tech stack (já tem).
- No embed do JSON dentro de `<script>`: usar `JSON.stringify(graph).replace(/</g, '\\u003c')` para prevenir `</script>` breakout.
- Alternativa robusta: colocar grafo em `<script type="application/json" id="graph-data">` e ler via `JSON.parse(document.getElementById('graph-data').textContent)`.
**Aceitação:** node com label `</text><script>alert(1)</script>` aparece como texto literal no SVG, não executa.

### ✅ 1.4 Sanitizar env passado ao git — DONE
**Arquivo:** `src/analyzer/clone.ts` (linhas ~71-77)
**Problema:** `process.env` inteiro vai pro subprocess; vaza `GIT_*`, `SSH_*`, secrets.
**Mudança:**
- Substituir `env: process.env` por whitelist:
  ```ts
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/echo",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  }
  ```
**Aceitação:** clone funciona; subprocess não tem acesso a `GIT_CREDENTIALS`, `SSH_KEY`, `ANTHROPIC_API_KEY`, etc.

### ✅ 1.5 Remover `/dev/pay` por flag explícita — DONE
**Arquivo:** `src/server.ts` (linhas ~329-346)
**Problema:** se alguém deploya sem `LNBITS_URL`, endpoint de fake-payment fica aberto.
**Mudança:**
- Trocar `if (mockMode)` por `const devPayEnabled = process.env.NODE_ENV === "development" && process.env.ENABLE_DEV_PAY === "1"; if (devPayEnabled) { ... }`.
- Logar `console.warn("⚠️  /dev/pay endpoint enabled — DO NOT use in production")` no boot quando ativo.
- Atualizar `.env.example` documentando.
**Aceitação:** `NODE_ENV=production` → `/dev/pay` retorna 404.

### 1.6 Sanitizar mensagens de erro pro cliente
**Arquivo:** `src/server.ts` (todos os `res.status(...).json({error: ...})`)
**Problema:** `Path not found: ${absPath}` e mensagens cruas vazam paths internos e ajudam atacante.
**Mudança:**
- Criar `src/errors.ts` com códigos: `INVALID_REPO_URL`, `REPO_NOT_FOUND`, `ANALYSIS_TIMEOUT`, `PAYMENT_REQUIRED`, `RATE_LIMITED`, `INTERNAL_ERROR`, `INVALID_PAYLOAD`.
- Cliente recebe sempre `{error_code, message, request_id}` onde `message` é genérica.
- Detalhe vai pro log com `request_id` (ver tarefa 4.1).
**Aceitação:** path traversal tentativa não revela path absoluto na resposta; só `INTERNAL_ERROR` + request_id.

---

## 2. CONFIABILIDADE — Cap de tokens, timeout, retries, fallback

### ✅ 2.1 Cap de tokens e wall-clock por análise — DONE
**Arquivo:** `src/analyzer/agent.ts` (linhas ~142, ~174-285)
**Problema:** análise sem teto pode custar $3+ por chamada.
**Mudança:**
- Adicionar consts: `MAX_INPUT_TOKENS = 150_000`, `MAX_OUTPUT_TOKENS = 50_000`, `MAX_WALL_CLOCK_MS = 90_000`.
- Acumular `totalIn += msg.usage.input_tokens; totalOut += msg.usage.output_tokens` a cada `client.messages.create`.
- Antes de cada iteração checar: `if (totalIn > MAX_INPUT_TOKENS || totalOut > MAX_OUTPUT_TOKENS || Date.now() - startTime > MAX_WALL_CLOCK_MS) break;`
- Logar custo aproximado no fim: `console.log({ tokens_in: totalIn, tokens_out: totalOut, est_cost_usd: ... })`.
**Aceitação:** repo gigante (clonar `torvalds/linux`) termina em ~90s sem custar mais que o cap configurado.

### ✅ 2.2 Best-effort fallback no agent loop — DONE
**Arquivo:** `src/analyzer/agent.ts` (linhas ~174-285)
**Problema:** atinge 20 iterações sem `set_graph` final → 500.
**Mudança:**
- Manter referência ao último grafo recebido: a cada chamada de tool `set_graph`, fazer `lastGraph = input.graph`.
- Quando loop encerra por timeout, token cap, ou iteration cap **e** `lastGraph` existe: retornar `{ graph: lastGraph, partial: true, confidence: "low" }`.
- Só lançar erro se nem grafo parcial veio.
- Adicionar campo `partial` no schema do grafo (default false).
**Aceitação:** repo grande termina com `partial: true` e SVG renderizável em vez de 500.

### 2.3 Retry com backoff em chamadas externas
**Arquivos:** `src/analyzer/clone.ts`, `src/payment/lightning.ts`, `src/analyzer/agent.ts`
**Problema:** uma latência transiente vira 500.
**Mudança:**
- Criar `src/util/retry.ts`:
  ```ts
  export async function withRetry<T>(fn: () => Promise<T>, opts = { tries: 3, baseMs: 500, maxMs: 5000 }): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < opts.tries; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;
        const delay = Math.min(opts.maxMs, opts.baseMs * 2 ** i) * (0.5 + Math.random());
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }
  function isRetryable(e: any) {
    // network errors, 429, 5xx — não retry em 4xx de validação
    if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT" || e?.code === "ENOTFOUND") return true;
    if (e?.status >= 500 || e?.status === 429) return true;
    return false;
  }
  ```
- Aplicar em: `git clone` (cuidado: clone parcialmente concluído precisa ser limpo antes de retry), `lnbits.createInvoice`, `lnbits.checkInvoice`, `client.messages.create`.
**Aceitação:** simular 1ª chamada com 503, 2ª com 200 — request final é 200.

### 2.4 Circuit breaker no Lightning (opossum, in-process)
**Arquivo:** `src/payment/lightning.ts`
**Problema:** LNbits down → todos requests timeout 30s antes de falhar.
**Mudança:**
- `npm i opossum` (já listado).
- Envolver `createInvoice` e `checkInvoice` em `CircuitBreaker`:
  ```ts
  import CircuitBreaker from "opossum";
  const breaker = new CircuitBreaker(callLnbits, {
    timeout: 8000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  });
  breaker.fallback(() => { throw new Error("PAYMENT_BACKEND_UNAVAILABLE"); });
  ```
- Endpoint `/health` reflete estado: `breaker.opened ? "degraded" : "ok"`.
**Aceitação:** matar LNbits → após 5 falhas, novos requests retornam 503 em <50ms em vez de timeout.

---

## 3. ROBUSTEZ — Validação, rate limit, idempotency, GC

### ✅ 3.1 Validação Zod em entradas externas — DONE (parcial: /analyze body)
**Arquivos:** `src/server.ts` (handlers de `/analyze`, `/diagram`, `/share`), `src/analyzer/agent.ts` (input das tools)
**Problema:** payloads malformados ou gigantes derrubam o servidor; cast `Record<string, unknown>` em tool input pode crashar.
**Mudança:**
- Criar `src/schemas.ts` com schemas Zod (já tem `zod` na dep):
  ```ts
  export const AnalyzeReq = z.object({
    repo_url: z.string().url().max(500),
    tier: z.enum(["fast","full"]).optional(),
  });
  export const NodeSchema = z.object({
    id: z.string().max(100),
    label: z.string().max(200),
    type: z.string().max(50),
    description: z.string().max(500).optional(),
  });
  export const GraphSchema = z.object({
    nodes: z.array(NodeSchema).max(200),
    edges: z.array(z.object({...})).max(500),
    techStack: z.array(z.string().max(50)).max(50).optional(),
  });
  ```
- Validar em todo handler: `const body = AnalyzeReq.parse(req.body)` (catch ZodError → 400 com `INVALID_PAYLOAD`).
- Em `agent.ts:207`, substituir cast por schema Zod por nome de tool:
  ```ts
  const ToolInputSchemas = {
    set_graph: z.object({ graph: GraphSchema }),
    read_file: z.object({ path: z.string().max(500) }),
    list_directory: z.object({ path: z.string().max(500) }),
    search_files: z.object({ pattern: z.string().max(200), max_results: z.number().int().max(100).optional() }),
  };
  const parsed = ToolInputSchemas[name].safeParse(input);
  if (!parsed.success) return { tool_use_id: id, content: `invalid input: ${parsed.error.message}`, is_error: true };
  ```
- Limite global: `app.use(express.json({ limit: "256kb" }))`.
**Aceitação:** POST `/diagram` com 100k nodes → 400; tool com input inválido não crasha agent.

### 3.2 Rate limiting in-memory
**Arquivo:** `src/server.ts`
**Problema:** atacante paga uma vez e martela `/analyze`.
**Mudança:**
- `npm i express-rate-limit` (memory store é default — não precisa Redis).
- Dois limiters:
  ```ts
  import rateLimit from "express-rate-limit";
  const ipLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true });
  const dailyIpLimiter = rateLimit({ windowMs: 24*60*60*1000, max: 1000 });
  app.use("/analyze", ipLimiter, dailyIpLimiter);
  app.use("/diagram", ipLimiter);
  ```
- Para limit por `payment_hash`: criar custom keyGen extraindo do header L402:
  ```ts
  const paymentLimiter = rateLimit({
    windowMs: 60*60*1000, max: 10,
    keyGenerator: (req) => extractPaymentHash(req.headers.authorization) ?? req.ip,
  });
  app.use("/analyze", paymentLimiter);
  ```
- Aceitar trade-off: memory store reseta no restart e não compartilha entre processos. Documentar em TODO.
**Aceitação:** loop curl > 60 req/min recebe 429 com `Retry-After`.

### ✅ 3.3 Idempotency key em `/analyze` (in-memory com TTL) — DONE
**Arquivo:** `src/server.ts`
**Problema:** duplo-clique do front gera duas análises pagas.
**Mudança:**
- Estrutura in-memory:
  ```ts
  const idemStore = new Map<string, { status: "running" | "done", result?: any, expiresAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of idemStore) if (v.expiresAt < now) idemStore.delete(k);
  }, 60_000).unref();
  ```
- No handler `/analyze`: ler header `Idempotency-Key`; se existe e tem entry `done`, retornar cacheado; se `running`, retornar 409.
- Key composta: `${idempotencyKey}:${paymentHash}` para evitar cross-user.
- TTL: 24h.
**Aceitação:** dois POSTs com mesma key e mesmo macaroon → uma análise, dois 200 com mesmo grafo.

### ✅ 3.4 Lock por payment_hash no L402 (in-memory) — DONE
**Arquivo:** `src/payment/l402.ts`
**Problema:** dois requests simultâneos com mesmo preimage passam ambos.
**Mudança:**
- Manter `Map<string, number>` com TTL curto (5s):
  ```ts
  const usedPreimages = new Map<string, number>();
  function tryClaim(preimageHash: string): boolean {
    const now = Date.now();
    for (const [k, t] of usedPreimages) if (t < now) usedPreimages.delete(k);
    if (usedPreimages.has(preimageHash)) return false;
    usedPreimages.set(preimageHash, now + 5000);
    return true;
  }
  ```
- No middleware: depois de validar macaroon e preimage, `if (!tryClaim(hash)) return res.status(401).json({...})`.
**Aceitação:** dois requests paralelos com mesmo macaroon → um passa, outro 401.

### 3.5 GC defensivo de clones e shares
**Arquivos:** `src/analyzer/clone.ts`, `src/server.ts`
**Problema:** crash hard deixa diretórios em `/tmp`; share IDs nunca expiram.
**Mudança:**
- Cleanup no boot do `server.ts`:
  ```ts
  import fs from "fs/promises";
  async function bootCleanup() {
    const tmpDir = process.env.CLONE_DIR ?? "/tmp/diagram-forge";
    try {
      const entries = await fs.readdir(tmpDir, { withFileTypes: true });
      const cutoff = Date.now() - 60*60*1000;
      for (const e of entries) {
        if (!e.name.startsWith("df-")) continue;
        const full = path.join(tmpDir, e.name);
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) await fs.rm(full, { recursive: true, force: true });
      }
    } catch {}
  }
  bootCleanup();
  setInterval(bootCleanup, 10*60*1000).unref();
  ```
- Adicionar prefix `df-` no nome do tmpdir em `clone.ts`.
- Cleanup de `data/graphs/`: opcional similar com TTL 30 dias (decisão de produto se shares expiram).
**Aceitação:** matar processo no meio da análise → diretório some na próxima janela do GC (10min).

### 3.6 Cache de análise por commit-SHA (filesystem)
**Arquivos:** `src/analyzer/clone.ts`, `src/server.ts`
**Problema:** mesmo repo + mesmo commit analisado N vezes paga N vezes à Anthropic.
**Mudança:**
- Em `clone.ts`, após clone, retornar também `sha = execSync("git rev-parse HEAD")`.
- Antes de chamar `analyzeProject`:
  ```ts
  const cacheKey = `${normalizeRepoUrl(repo_url)}:${sha}`;
  const cacheFile = path.join("data", "cache", crypto.createHash("sha256").update(cacheKey).digest("hex") + ".json");
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    return cached;
  }
  // ... rodar análise ...
  fs.mkdirSync("data/cache", { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  ```
- TTL via mtime check: se arquivo > 30 dias, ignorar e re-analisar.
- **Importante:** cobrança ainda acontece (cache hit não é grátis). Decisão de produto se quer dar desconto.
**Aceitação:** segunda análise do mesmo SHA volta em <1s sem chamar Claude.

---

## 4. OBSERVABILIDADE — Logs e métricas (in-process)

### ✅ 4.1 Logging estruturado com pino — DONE (server.ts + pinoHttp middleware; console.log restante nos outros arquivos é aceitável por ora)
**Arquivos:** todos os `console.log` em `server.ts`, `l402.ts`, `agent.ts`, `clone.ts`, `lightning.ts`
**Mudança:**
- `npm i pino pino-http`.
- Criar `src/logger.ts`:
  ```ts
  import pino from "pino";
  export const log = pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["headers.authorization", "*.preimage", "*.macaroon", "*.api_key"],
  });
  ```
- Em `server.ts`, adicionar `app.use(pinoHttp({ logger: log, genReqId: () => crypto.randomUUID() }))` — popula `req.id` automático.
- Trocar `console.log` por `log.info({...}, "msg")` e `console.error` por `log.error({err}, "msg")`.
- Propagar `req.id` para o agent: `analyzeProject(..., { traceId: req.id })` e logar dentro do loop.
- Nunca logar: `MACAROON_SECRET`, `ANTHROPIC_API_KEY`, `LNBITS_API_KEY`, preimage, conteúdo de arquivos do repo.
**Aceitação:** `curl /analyze` produz logs JSON com `req.id` correlacionando todas as etapas.

### ✅ 4.2 Métricas Prometheus no `/metrics` — DONE
**Arquivo novo:** `src/metrics.ts`; integrar em `src/server.ts`.
**Mudança:**
- `npm i prom-client`.
  ```ts
  import client from "prom-client";
  client.collectDefaultMetrics();
  export const analyzeRequests = new client.Counter({ name: "analyze_requests_total", help: "...", labelNames: ["status"] });
  export const analyzeDuration = new client.Histogram({ name: "analyze_duration_seconds", help: "...", buckets: [1,5,10,30,60,120] });
  export const analyzeTokens = new client.Counter({ name: "analyze_tokens_total", help: "...", labelNames: ["kind"] });
  export const analyzeCostUsd = new client.Counter({ name: "analyze_cost_usd_total", help: "..." });
  export const lightningInvoices = new client.Counter({ name: "lightning_invoice_total", help: "...", labelNames: ["result"] });
  export const breakerState = new client.Gauge({ name: "circuit_breaker_state", help: "...", labelNames: ["component"] });
  ```
- Endpoint:
  ```ts
  app.get("/metrics", async (req, res) => {
    if (process.env.METRICS_TOKEN && req.query.token !== process.env.METRICS_TOKEN) return res.status(401).end();
    res.set("Content-Type", client.register.contentType).end(await client.register.metrics());
  });
  ```
- Instrumentar pontos quentes: incrementar `analyzeRequests`, observar `analyzeDuration`, somar tokens em `agent.ts`.
**Aceitação:** `curl /metrics?token=...` retorna formato Prometheus com contadores reais.

### ✅ 4.3 Endpoint `/health` honesto — DONE
**Arquivo:** `src/server.ts`
**Mudança:**
- Trocar `/health` (se existe) por:
  ```ts
  app.get("/health", (req, res) => {
    const status = {
      ok: true,
      lightning: lightningBreaker.opened ? "degraded" : "ok",
      anthropic: anthropicBreaker?.opened ? "degraded" : "ok",
      uptime_s: Math.floor(process.uptime()),
      idem_size: idemStore.size,
    };
    res.status(status.lightning === "ok" ? 200 : 503).json(status);
  });
  ```
**Aceitação:** matar LNbits → após circuit abrir, `/health` retorna 503 com `lightning: "degraded"`.

---

## 5. L402 — Robustez

### 5.1 Suporte a rotação de MACAROON_SECRET
**Arquivo:** `src/payment/l402.ts`
**Mudança:**
- Aceitar `MACAROON_SECRET_PRIMARY` e opcionalmente `MACAROON_SECRET_PREVIOUS`.
- Manter compat com `MACAROON_SECRET` (usar como primary se primary não definido).
- Verify tenta primary primeiro, depois previous se configurado.
- Sign sempre usa primary.
- Validar entropia mínima no boot: se `secret.length < 64` (32 bytes hex), `console.error` e `process.exit(1)` em produção.
**Aceitação:** rotacionar secret sem invalidar macaroons em voo durante a janela de previous.

### 5.2 Não logar preimage nem macaroon
**Arquivos:** `src/payment/l402.ts`, `src/payment/lightning.ts`
**Mudança:**
- Toda string contendo `Authorization`, `preimage`, `macaroon`, `payment_hash` (este último OK em metadata, não no log raw) passa por redact (já configurado no pino logger acima).
- Verificar manualmente que nenhum `console.log(req.headers)` ou similar existe.
**Aceitação:** grep `preimage\|macaroon\|MACAROON_SECRET` em logs de teste não retorna nada.

---

## 6. CÓDIGO — Limpeza e tipagem

### 6.1 Remover dead code
**Arquivo:** `src/diagram/layout.ts` (linha ~122)
**Mudança:** deletar `void totalH` e a variável `totalH` se não é usada.
**Aceitação:** `tsc --noEmit` passa.

### 6.2 Pré-compilar regex em search
**Arquivo:** `src/tools/filesystem.ts` (linha ~302)
**Mudança:** mover `new RegExp(pattern)` pra fora do loop de arquivos. Se pattern muda por chamada, criar uma vez no início da função.
**Aceitação:** busca em repo grande mais rápida em microbench.

### 6.3 Padronizar tratamento de erro em tools
**Arquivo:** `src/tools/filesystem.ts`
**Mudança:** todas as funções retornam `string` (mensagem que vai pro Claude). Erros nunca lançam; viram `"Error: ..."`. Já está parcialmente assim — auditar e padronizar.
**Aceitação:** nenhuma tool lança exceção que escapa do agent loop.

### 6.4 Type guard exaustivo no switch de tools
**Arquivo:** `src/analyzer/agent.ts` (linhas ~212-270)
**Mudança:**
- Tipar `name` como union: `type ToolName = "read_file" | "list_directory" | "search_files" | "set_graph"`.
- Adicionar `default: const _exhaustive: never = name; return "unknown tool";`
**Aceitação:** adicionar nova tool sem case → erro de compilação.

---

## 7. TESTES — Cobertura mínima

### 7.1 Vitest com testes críticos
**Arquivos:** `tests/sandbox.test.ts`, `tests/clone-validation.test.ts`, `tests/macaroon.test.ts`, `tests/layout.test.ts`
**Mudança:** `npm i -D vitest`. Adicionar `"test": "vitest run"` no `package.json`.
- `sandbox.test.ts`: criar tmpdir + symlink saindo, verificar que `safeResolve` rejeita.
- `clone-validation.test.ts`: validar URL parser rejeita IPs privados, hosts não-whitelisted, schemes diferentes.
- `macaroon.test.ts`: sign + verify roundtrip, expiry, secret errado.
- `layout.test.ts`: layout determinístico (mesmo input → mesmo output) para snapshot test.
**Aceitação:** `npm test` verde em CI.

---

## Ordem sugerida (todas independentes, mas algumas habilitam outras)

**Sessão 1 (segurança imediata, ~1-2h):**
1. 1.1 (symlink) — mais perigoso, fácil
2. 1.4 (env do git) — 5min
3. 1.5 (dev/pay) — 5min
4. 1.3 (XSS no SVG) — meia hora

**Sessão 2 (segurança e custo, ~2-3h):**
5. 1.2 (SSRF + IP privado)
6. 2.1 (cap de tokens) — protege a carteira
7. 2.2 (best-effort fallback)
8. 1.6 (sanitizar erros)

**Sessão 3 (robustez, ~3-4h):**
9. 3.1 (Zod) — habilita confiança nas próximas
10. 3.2 (rate limit)
11. 3.3 (idempotency)
12. 3.4 (lock L402)
13. 3.5 (GC de clones)

**Sessão 4 (resiliência e cache, ~2-3h):**
14. 2.3 (retry)
15. 2.4 (circuit breaker)
16. 3.6 (cache por SHA)

**Sessão 5 (observabilidade, ~2-3h):**
17. 4.1 (pino)
18. 4.2 (prometheus)
19. 4.3 (/health)
20. 5.1, 5.2 (L402 polish)

**Sessão 6 (limpeza, ~1h):**
21. 6.1, 6.2, 6.3, 6.4
22. 7.1 (testes)

---

## Smoke test final

1. `git clone https://github.com.evil.com/x/y` → 400 `INVALID_REPO_URL`.
2. Repo com symlink para `/etc/passwd` + tool `read_file` → erro "outside sandbox".
3. POST `/analyze` 100x em 10s do mesmo IP → 60 passam, restante 429.
4. Mesmo `repo_url + sha` analisado 2x → segunda chamada <1s, sem chamar Claude.
5. `kill -9` no servidor durante análise → restart, `/tmp/df-*` é limpo no boot.
6. Matar LNbits → após 5 erros, novos requests retornam 503 `PAYMENT_BACKEND_UNAVAILABLE` em <50ms.
7. `curl /metrics?token=...` mostra contadores incrementando com tráfego.
8. `MACAROON_SECRET=short` no boot → processo aborta com erro.
9. Node label `</text><script>alert(1)</script>` → renderiza como texto literal no SVG.
10. `npm test` → tudo verde.

---

## Notas

- **Memory stores são intencionais nesta fase.** Resetam no restart, não compartilham entre processos. Quando o produto justificar, migrar para Redis (rate limit, idempotency, lock L402, cache) é troca de adapter — desenhar interfaces que isolem isso já agora se possível.
- **Não fazer purchase decisions sem dado.** Não adicione fila/Redis/Postgres antes de bater problema real de escala.
- **Cada PR deve passar `tsc --noEmit` e `npm test`.**
