# Imagen base con Node

FROM node:20-slim

# Instalar dependencias de sistema necesarias para Tesseract (con idiomas español e inglés) y PDF
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-spa \
    tesseract-ocr-eng \
    libtesseract-dev \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*


# Crear directorio de trabajo y asegurar permisos
WORKDIR /app
RUN chmod -R 755 /app

# Definir entorno de producción
ENV NODE_ENV=production

# Copiar dependencias primero
COPY package*.json ./

RUN npm install --production

# Copiar código
COPY . .

# Exponer puerto
EXPOSE 3000

# Cambiar a usuario no root para mayor seguridad
USER node

# Arrancar la app
CMD ["node", "src/index.js"]
