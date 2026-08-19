# =============================================================
# SANGAM Supply Chain Management System — Dockerfile
# Multi-stage build: keeps the production image minimal
# =============================================================

# ── Stage 1: Build the frontend ───────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Install backend production dependencies ──────────
FROM node:22-alpine AS deps

WORKDIR /build

# Copy only package files first (layer cache: deps rarely change)
COPY package.json package-lock.json ./

RUN npm ci --only=production --ignore-scripts && \
    # Clean npm cache to reduce layer size
    npm cache clean --force

# ── Stage 3: Final production image ────────────────────────────
FROM node:22-alpine AS final

# Add tini for proper PID 1 signal handling
RUN apk add --no-cache tini

WORKDIR /app

# Create non-root user (uid 1001)
RUN addgroup -g 1001 -S sangam && \
    adduser  -u 1001 -S sangam -G sangam

# Copy dependencies from deps stage
COPY --from=deps --chown=sangam:sangam /build/node_modules ./node_modules

# Copy application source
COPY --chown=sangam:sangam backend/     ./backend/
COPY --chown=sangam:sangam database/    ./database/
COPY --chown=sangam:sangam package.json ./

# Copy the built frontend — app.js serves this statically and falls back
# to index.html for SPA routes (see backend/src/app.js Day 28 static block)
COPY --from=frontend-build --chown=sangam:sangam /build/frontend/dist ./frontend/dist

# Run as non-root
USER sangam

# Application port
EXPOSE 3000

# Health check — polls /health every 30s, 3 retries, 10s timeout
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use tini as PID 1 for clean signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default: run server (docker-compose can override for migrations etc.)
CMD ["node", "backend/src/server.js"]
