# Imagen base con Node
FROM node:20-slim

# Instalar dependencias de sistema necesarias para Tesseract y PDF
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de trabajo
WORKDIR /app

# Copiar dependencias primero
COPY package*.json ./

RUN npm install --production

# Copiar código
COPY . .

# Exponer puerto
EXPOSE 3000

# Arrancar la app
CMD ["node", "src/index.js"]
