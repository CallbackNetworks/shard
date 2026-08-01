FROM node:22-slim

WORKDIR /app

# Install deps first (cached layer — only re-runs when package.json changes)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
