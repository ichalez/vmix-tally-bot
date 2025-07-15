FROM node:18-alpine

WORKDIR /app

# Copiar package.json
COPY package.json ./

# Instalar dependencias SIN lockfile
RUN npm install --no-package-lock

# Copiar código
COPY . .

# Exponer puerto
EXPOSE 3000

# Ejecutar bot
CMD ["node", "bot.js"]
