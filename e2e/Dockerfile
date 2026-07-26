# The base image ships the browser binaries for exactly one Playwright version,
# so package.json pins @playwright/test to the same version (no caret). Bump
# both together or the run fails with "Executable doesn't exist".
FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /e2e
COPY package.json ./
RUN npm install
COPY . .

CMD ["npx", "playwright", "test"]
