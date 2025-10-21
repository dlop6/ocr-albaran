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
    poppler-utils \
    wget \
    ca-certificates \
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

# Copiar traineddata locales (si existen en el contexto de build)
RUN mkdir -p /usr/share/tesseract-ocr/4.00/tessdata
# NOTE: copy of local traineddata removed because build context may not include them.
# If you have local traineddata files (eng.traineddata, spa.traineddata, etc.),
# add a COPY line here or place them under the 'data/' directory before building.

# Asegurar que el traineddata para OSD está presente (si no, descargarlo)
RUN set -eux; \
    if [ ! -f /usr/share/tesseract-ocr/4.00/tessdata/osd.traineddata ]; then \
        echo "osd.traineddata no encontrada, descargando..."; \
        wget -O /usr/share/tesseract-ocr/4.00/tessdata/osd.traineddata \
            https://github.com/tesseract-ocr/tessdata_fast/raw/main/osd.traineddata || true; \
    else \
        echo "osd.traineddata ya presente"; \
    fi

# Asegurar también los idiomas principales (spa, eng) para evitar depender de paquetes apt
RUN set -eux; \
    for lang in spa eng; do \
        target=/usr/share/tesseract-ocr/4.00/tessdata/${lang}.traineddata; \
        if [ ! -f "$target" ]; then \
            echo "${lang}.traineddata no encontrada, descargando..."; \
            wget -O "$target" "https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata" || true; \
        else \
            echo "${lang}.traineddata ya presente"; \
        fi; \
    done

# Exponer puerto
EXPOSE 3000

# Cambiar a usuario no root para mayor seguridad
USER node

# Arrancar la app principal
CMD ["node", "src/index.js"]
