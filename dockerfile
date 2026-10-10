FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build
ENV DATABASE_URL="file:/app/data/whtba.db"
VOLUME ["/app/data"]
CMD ["sh", "-c", "npx prisma db push && node build/entry.js"]
