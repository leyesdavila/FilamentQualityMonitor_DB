# 🖨️ Filament Quality Monitor

![Versión](https://img.shields.io/badge/version-1.0.0-blue)
![Python](https://img.shields.io/badge/python-3.11+-green)
![SQLite](https://img.shields.io/badge/database-SQLite-blue)

## 📝 Sobre el Proyecto
*(Escribe 2-3 líneas explicando el problema que resuelves)*
> *Ejemplo: "Sistema de monitoreo para impresión 3D que analiza la calidad del filamento en tiempo real, evitando fallos de impresión mediante alertas tempranas."*

**Características Principales:**
- ✅ Análisis de calidad en tiempo real
- ✅ Historial de impresiones (Base de datos SQLite)
- ✅ Panel de control web interactivo

## 📦 Instalación y Configuración

Sigue estos pasos para tener el entorno listo:

```bash
# 1. Clonar el repositorio
git clone https://github.com/leyesdavila/FilamentQualityMonitor_DB.git

# 2. Crear y activar entorno virtual
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Configurar variables de entorno
# Crea un archivo .env con tus claves (si aplica)
