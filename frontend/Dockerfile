FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
# Invoke vite via node to avoid exec-bit issues on bind-mounted node_modules.
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0"]
