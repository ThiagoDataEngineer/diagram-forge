// Simple Icons slugs and brand colors for common technologies.
// Full list: https://simpleicons.org
// Icons fetched via CDN at render time — they're MIT-licensed open-source SVGs.

export interface TechLogo {
  slug: string;      // simpleicons.org slug
  color: string;     // brand hex color (no #)
  label: string;     // display name
}

// ─── Technology → Logo mapping ────────────────────────────────────────────────

const TECH_MAP: Record<string, TechLogo> = {
  // Frontend
  "next.js":      { slug: "nextdotjs",     color: "000000", label: "Next.js" },
  "nextjs":       { slug: "nextdotjs",     color: "000000", label: "Next.js" },
  "react":        { slug: "react",         color: "61DAFB", label: "React" },
  "react native": { slug: "react",         color: "61DAFB", label: "React Native" },
  "vue":          { slug: "vuedotjs",      color: "4FC08D", label: "Vue.js" },
  "nuxt":         { slug: "nuxtdotjs",     color: "00DC82", label: "Nuxt" },
  "svelte":       { slug: "svelte",        color: "FF3E00", label: "Svelte" },
  "angular":      { slug: "angular",       color: "DD0031", label: "Angular" },
  "remix":        { slug: "remix",         color: "000000", label: "Remix" },
  "vite":         { slug: "vite",          color: "646CFF", label: "Vite" },
  "astro":        { slug: "astro",         color: "FF5D01", label: "Astro" },
  "flutter":      { slug: "flutter",       color: "02569B", label: "Flutter" },

  // Backend / Runtime
  "node.js":      { slug: "nodedotjs",     color: "5FA04E", label: "Node.js" },
  "nodejs":       { slug: "nodedotjs",     color: "5FA04E", label: "Node.js" },
  "express":      { slug: "express",       color: "000000", label: "Express" },
  "fastify":      { slug: "fastify",       color: "000000", label: "Fastify" },
  "nestjs":       { slug: "nestjs",        color: "E0234E", label: "NestJS" },
  "fastapi":      { slug: "fastapi",       color: "009688", label: "FastAPI" },
  "django":       { slug: "django",        color: "092E20", label: "Django" },
  "flask":        { slug: "flask",         color: "000000", label: "Flask" },
  "spring boot":  { slug: "springboot",    color: "6DB33F", label: "Spring Boot" },
  "spring":       { slug: "spring",        color: "6DB33F", label: "Spring" },
  "quarkus":      { slug: "quarkus",       color: "4695EB", label: "Quarkus" },
  "gin":          { slug: "go",            color: "00ADD8", label: "Gin/Go" },
  "actix":        { slug: "rust",          color: "000000", label: "Actix/Rust" },
  "axum":         { slug: "rust",          color: "000000", label: "Axum/Rust" },
  "trpc":         { slug: "trpc",          color: "2596BE", label: "tRPC" },
  "graphql":      { slug: "graphql",       color: "E10098", label: "GraphQL" },
  "grpc":         { slug: "grpc",          color: "244C5A", label: "gRPC" },

  // Databases
  "postgresql":   { slug: "postgresql",    color: "4169E1", label: "PostgreSQL" },
  "postgres":     { slug: "postgresql",    color: "4169E1", label: "PostgreSQL" },
  "mysql":        { slug: "mysql",         color: "4479A1", label: "MySQL" },
  "mongodb":      { slug: "mongodb",       color: "47A248", label: "MongoDB" },
  "sqlite":       { slug: "sqlite",        color: "003B57", label: "SQLite" },
  "supabase":     { slug: "supabase",      color: "3ECF8E", label: "Supabase" },
  "planetscale":  { slug: "planetscale",   color: "000000", label: "PlanetScale" },

  // Cache / Queue
  "redis":        { slug: "redis",         color: "FF4438", label: "Redis" },
  "rabbitmq":     { slug: "rabbitmq",      color: "FF6600", label: "RabbitMQ" },
  "kafka":        { slug: "apachekafka",   color: "231F20", label: "Kafka" },
  "sqs":          { slug: "amazonsqs",     color: "FF4F8B", label: "Amazon SQS" },
  "celery":       { slug: "celery",        color: "37814A", label: "Celery" },

  // Cloud / Infrastructure
  "aws":          { slug: "amazonaws",     color: "232F3E", label: "AWS" },
  "gcp":          { slug: "googlecloud",   color: "4285F4", label: "GCP" },
  "azure":        { slug: "microsoftazure",color: "0078D4", label: "Azure" },
  "vercel":       { slug: "vercel",        color: "000000", label: "Vercel" },
  "netlify":      { slug: "netlify",       color: "00C7B7", label: "Netlify" },
  "cloudflare":   { slug: "cloudflare",    color: "F48120", label: "Cloudflare" },
  "docker":       { slug: "docker",        color: "2496ED", label: "Docker" },
  "kubernetes":   { slug: "kubernetes",    color: "326CE5", label: "Kubernetes" },
  "terraform":    { slug: "terraform",     color: "844FBA", label: "Terraform" },

  // Storage
  "s3":           { slug: "amazons3",      color: "569A31", label: "Amazon S3" },
  "gcs":          { slug: "googlecloud",   color: "4285F4", label: "Google Cloud Storage" },
  "minio":        { slug: "minio",         color: "C72E49", label: "MinIO" },
  "cloudinary":   { slug: "cloudinary",    color: "3448C5", label: "Cloudinary" },

  // Auth
  "auth0":        { slug: "auth0",         color: "EB5424", label: "Auth0" },
  "clerk":        { slug: "clerk",         color: "6C47FF", label: "Clerk" },
  "keycloak":     { slug: "keycloak",      color: "4D4D4D", label: "Keycloak" },
  "jwt":          { slug: "jsonwebtokens", color: "000000", label: "JWT" },

  // ORM / Data
  "prisma":       { slug: "prisma",        color: "2D3748", label: "Prisma" },
  "drizzle":      { slug: "drizzle",       color: "C5F74F", label: "Drizzle" },
  "typeorm":      { slug: "typeorm",       color: "FE0902", label: "TypeORM" },
  "sqlalchemy":   { slug: "sqlalchemy",    color: "D01F00", label: "SQLAlchemy" },
  "dbt":          { slug: "dbt",           color: "FF694B", label: "dbt" },

  // ML / Data
  "jupyter":      { slug: "jupyter",       color: "F37626", label: "Jupyter" },
  "databricks":   { slug: "databricks",    color: "FF3621", label: "Databricks" },
  "spark":        { slug: "apachespark",   color: "E25A1C", label: "Apache Spark" },
  "mlflow":       { slug: "mlflow",        color: "0194E2", label: "MLflow" },
  "airflow":      { slug: "apacheairflow", color: "017CEE", label: "Airflow" },
  "pytorch":      { slug: "pytorch",       color: "EE4C2C", label: "PyTorch" },
  "tensorflow":   { slug: "tensorflow",    color: "FF6F00", label: "TensorFlow" },
  "openai":       { slug: "openai",        color: "412991", label: "OpenAI" },
  "anthropic":    { slug: "anthropic",     color: "D4A27F", label: "Anthropic" },

  // Monitoring
  "datadog":      { slug: "datadog",       color: "632CA6", label: "Datadog" },
  "grafana":      { slug: "grafana",       color: "F46800", label: "Grafana" },
  "prometheus":   { slug: "prometheus",    color: "E6522C", label: "Prometheus" },
  "sentry":       { slug: "sentry",        color: "362D59", label: "Sentry" },

  // Payment
  "stripe":       { slug: "stripe",        color: "635BFF", label: "Stripe" },
  "lightning":    { slug: "lightning",     color: "792EE5", label: "Lightning" },

  // Languages (fallback)
  "python":       { slug: "python",        color: "3776AB", label: "Python" },
  "typescript":   { slug: "typescript",    color: "3178C6", label: "TypeScript" },
  "javascript":   { slug: "javascript",    color: "F7DF1E", label: "JavaScript" },
  "java":         { slug: "openjdk",       color: "000000", label: "Java" },
  "scala":        { slug: "scala",         color: "DC322F", label: "Scala" },
  "go":           { slug: "go",            color: "00ADD8", label: "Go" },
  "rust":         { slug: "rust",          color: "000000", label: "Rust" },
};

// ─── Lookup ───────────────────────────────────────────────────────────────────

export function getTechLogo(technology: string): TechLogo | null {
  const key = technology.toLowerCase().trim();
  // exact match
  if (TECH_MAP[key]) return TECH_MAP[key];
  // partial match (e.g. "PostgreSQL 15" → "postgresql")
  for (const [mapKey, logo] of Object.entries(TECH_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) return logo;
  }
  return null;
}

// Returns a <image> tag referencing Simple Icons CDN, or null if no logo found
export function logoImageTag(
  technology: string,
  x: number,
  y: number,
  size = 28
): string | null {
  const logo = getTechLogo(technology);
  if (!logo) return null;

  // Simple Icons CDN: https://cdn.simpleicons.org/{slug}/{color}
  const url = `https://cdn.simpleicons.org/${logo.slug}/${logo.color}`;

  return `<image href="${url}" x="${x}" y="${y}" width="${size}" height="${size}"
    onerror="this.style.display='none'" />`;
}

// ─── Node type → theme color ──────────────────────────────────────────────────

export const NODE_THEME: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  frontend:     { bg: "#EFF6FF", border: "#3B82F6", text: "#1E3A5F", badge: "#3B82F6" },
  backend:      { bg: "#F0FDF4", border: "#22C55E", text: "#14532D", badge: "#22C55E" },
  database:     { bg: "#FFF7ED", border: "#F97316", text: "#7C2D12", badge: "#F97316" },
  cache:        { bg: "#FEF2F2", border: "#EF4444", text: "#7F1D1D", badge: "#EF4444" },
  queue:        { bg: "#FFFBEB", border: "#F59E0B", text: "#78350F", badge: "#F59E0B" },
  storage:      { bg: "#F5F3FF", border: "#8B5CF6", text: "#4C1D95", badge: "#8B5CF6" },
  auth:         { bg: "#FDF4FF", border: "#A855F7", text: "#581C87", badge: "#A855F7" },
  gateway:      { bg: "#F0F9FF", border: "#0EA5E9", text: "#0C4A6E", badge: "#0EA5E9" },
  external_api: { bg: "#F8FAFC", border: "#64748B", text: "#1E293B", badge: "#64748B" },
  ml_model:     { bg: "#FFF1F2", border: "#FB7185", text: "#881337", badge: "#FB7185" },
  worker:       { bg: "#ECFDF5", border: "#10B981", text: "#064E3B", badge: "#10B981" },
  cdn:          { bg: "#FEF3C7", border: "#D97706", text: "#78350F", badge: "#D97706" },
  monitoring:   { bg: "#EEF2FF", border: "#6366F1", text: "#312E81", badge: "#6366F1" },
  other:        { bg: "#F9FAFB", border: "#9CA3AF", text: "#374151", badge: "#9CA3AF" },
};
