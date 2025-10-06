#!/usr/bin/env python3
"""
Script para convertir PDF a imágenes PNG usando pymupdf (fitz)
Basado en el diseño de migración documentado en docs/planeacion_migracion_python.md

Uso: python pdf2images.py <ruta_pdf> <directorio_salida>
Salida: JSON por stdout con array de rutas de imágenes generadas
"""

import sys
import os
import json
import fitz  # PyMuPDF
import traceback
from pathlib import Path


def validate_arguments():
    """Valida argumentos de línea de comandos según diseño"""
    if len(sys.argv) != 3:
        print("Error: Se requieren exactamente 2 argumentos", file=sys.stderr)
        print("Uso: python pdf2images.py <ruta_pdf> <directorio_salida>", file=sys.stderr)
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Validar que el PDF existe
    if not os.path.isfile(pdf_path):
        print(f"Error: El archivo PDF no existe: {pdf_path}", file=sys.stderr)
        sys.exit(1)
    
    # Crear directorio de salida si no existe
    try:
        os.makedirs(output_dir, exist_ok=True)
    except Exception as e:
        print(f"Error: No se pudo crear el directorio de salida: {e}", file=sys.stderr)
        sys.exit(1)
    
    return pdf_path, output_dir


def convert_pdf_to_images(pdf_path, output_dir):
    """
    Convierte PDF a imágenes PNG usando pymupdf
    Basado en el comportamiento actual de Poppler en pdfService.js
    """
    image_paths = []
    doc = None
    
    try:
        # Abrir PDF con pymupdf
        doc = fitz.open(pdf_path)
        
        if doc.page_count == 0:
            raise Exception("El PDF no contiene páginas")
        
        # Procesar cada página
        for page_num in range(doc.page_count):
            try:
                page = doc[page_num]
                
                # Configurar resolución similar a Poppler (-r 300)
                mat = fitz.Matrix(300/72, 300/72)  # 300 DPI
                
                # Renderizar página como imagen 
                # type: ignore - Pylance no reconoce el método pero es válido en PyMuPDF
                pix = page.get_pixmap(matrix=mat)  # type: ignore
                
                # Generar nombre de archivo consistente con pdfService.js
                # pdfService.js genera: page-{i}.png (donde i es 1-based)
                image_filename = f"page-{page_num + 1}.png"
                image_path = os.path.join(output_dir, image_filename)
                
                # Guardar imagen PNG
                pix.save(image_path)
                pix = None  # Liberar memoria
                
                # Validar que el archivo se creó correctamente
                if not os.path.exists(image_path):
                    raise Exception(f"No se generó la imagen para página {page_num + 1}")
                
                # Agregar ruta absoluta al resultado
                image_paths.append(os.path.abspath(image_path))
                
            except Exception as e:
                print(f"Error al convertir página {page_num + 1}: {e}", file=sys.stderr)
                raise Exception(f"Error en conversión de página {page_num + 1}: {e}")
        
    except Exception as e:
        print(f"Error al procesar PDF: {e}", file=sys.stderr)
        raise
    
    finally:
        # Limpiar recursos de pymupdf
        if doc:
            doc.close()
    
    return image_paths


def main():
    """Función principal que coordina la conversión"""
    try:
        # Validar argumentos
        pdf_path, output_dir = validate_arguments()
        
        # Convertir PDF a imágenes
        image_paths = convert_pdf_to_images(pdf_path, output_dir)
        
        # Verificar que se generaron imágenes
        if not image_paths:
            print("Error: No se generaron imágenes", file=sys.stderr)
            sys.exit(1)
        
        # Salida JSON por stdout según diseño
        result = {
            "images": image_paths
        }
        
        # Imprimir JSON a stdout (Node.js lo capturará)
        print(json.dumps(result, ensure_ascii=False))
        
        # Salir con código 0 (éxito)
        sys.exit(0)
        
    except Exception as e:
        # Manejar cualquier error no capturado
        print(f"Error crítico: {e}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()