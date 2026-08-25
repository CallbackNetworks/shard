FROM node:22-slim

# Node's default old-space ceiling (~2GB) is sized without regard to what else is
# running. This image runs on a shared host — dev sessions and the CI runner both
# compete with a couple dozen unrelated containers for a fixed, small pool of RAM —
# so a run that would fit comfortably on a quiet machine can still starve. Raised
# here rather than per-invocation so every command run from this image (vitest,
# vite build, npm scripts) inherits it the same way, dev and CI alike.
ENV NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /app

# Install deps first (cached layer — only re-runs when package.json changes)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
