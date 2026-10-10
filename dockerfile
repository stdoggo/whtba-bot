FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/yt-dlp/bin:${PATH}"
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build
CMD ["node", "build/entry.js"]
