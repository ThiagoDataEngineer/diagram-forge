FROM node:20-slim

# git for cloning repos + canvas native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

# Skip Chromium download (puppeteer only used for GIF recording, not core server)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev

# Reinstall canvas with build (needs native compile)
RUN npm rebuild canvas --update-binary 2>/dev/null || true

# .dockerignore excludes .env, *.key, *.pem, node_modules
COPY . .

# Switch to non-root before starting
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/server.ts"]
