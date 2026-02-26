FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npx tsc -p tsconfig.cloudrun.json

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/variants.json ./variants.json

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
