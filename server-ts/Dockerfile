FROM node:20-bookworm

# LilyPond (SVG backend) + fonts for consistent rendering
RUN apt-get update \
  && apt-get install -y --no-install-recommends lilypond fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm","run","start"]

