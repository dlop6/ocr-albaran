# Imagen base con Node


FROM node:20-slim

# Instalar dependencias de sistema necesarias para Tesseract (con idiomas español e inglés) y PDF
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-spa \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    libtesseract-dev \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*


# Crear directorio de trabajo y asegurar permisos
WORKDIR /app
RUN chmod -R 755 /app

ENV NODE_ENV=production
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/4.00/tessdata/

# Copiar dependencias primero
COPY package*.json ./

RUN npm install --production


# Copiar código (excluyendo data/ si no se requiere)
COPY . .

# Exponer puerto
EXPOSE 3000

# Cambiar a usuario no root para mayor seguridad
USER node

# Arrancar la app principal
CMD ["node", "src/index.js"]
