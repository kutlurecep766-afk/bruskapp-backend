FROM node:20 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
RUN useradd --system --no-create-home --shell /bin/false nodejs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma/client ./node_modules/.prisma/client
RUN mkdir -p /app/data/uploads && chown -R nodejs:nodejs /app/data
USER nodejs
EXPOSE 4000
ENV PORT=4000
CMD ["sh", "-c", "mkdir -p /app/data/uploads 2>/dev/null; chown -R nodejs:nodejs /app/data 2>/dev/null; npx prisma migrate deploy 2>/dev/null; node dist/main"]
