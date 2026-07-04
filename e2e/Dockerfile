FROM mcr.microsoft.com/playwright:v1.48.0-noble

WORKDIR /e2e
COPY package.json ./
RUN npm install
COPY . .

CMD ["npx", "playwright", "test"]
