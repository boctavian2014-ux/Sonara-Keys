# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy manifests first to maximise layer-cache reuse
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies needed for tsc)
RUN npm ci

# Copy source and compile TypeScript → dist/
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# LilyPond (SVG backend) + fonts for consistent rendering in /render-score-svg
RUN apt-get update \
  && apt-get install -y --no-install-recommends lilypond fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Copy manifests so we can install production deps in the final image.
# Re-running npm ci --omit=dev here (rather than copying node_modules from the
# builder) ensures any native add-ons (TensorFlow, etc.) are compiled against
# the exact libc/arch of this image layer.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled application from the build stage
COPY --from=builder /app/dist ./dist

# Drop to the built-in non-root user that the node image ships with
USER node

# Railway injects PORT; we default to 8787 locally.
EXPOSE 3000

# Healthcheck – mirrors the /health endpoint defined in src/index.ts
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || process.env.TRANSCRIBE_PORT || process.env.BP_PORT || 8787) + '/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "run", "start"]
