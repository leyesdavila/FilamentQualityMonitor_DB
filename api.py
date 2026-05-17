"""
FilaPrint — api.py (versión SQLite portable)
Backend Flask + SQLite. Sirve también el frontend estático.
Ideal para empaquetar como .exe con PyInstaller.
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from datetime import datetime, timedelta
import sqlite3
import numpy as np
from dateutil import parser
import sys
import os

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# ── Configuración de BD (SQLite) ────────────────────────────────
if getattr(sys, 'frozen', False):
    DB_PATH = os.path.join(os.path.dirname(sys.executable), "filaprint.db")
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "filaprint.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Crea las tablas si no existen"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS diametro (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tiempo TEXT NOT NULL,
            mm TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS caracteristicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upperlimit REAL NOT NULL DEFAULT 18.5,
            lowerlimit REAL NOT NULL DEFAULT 17.5
        )
    ''')
    cur.execute('SELECT COUNT(*) FROM caracteristicas')
    if cur.fetchone()[0] == 0:
        cur.execute('INSERT INTO caracteristicas (upperlimit, lowerlimit) VALUES (1.777, 1.723)')
    conn.commit()
    conn.close()

# ── Helpers ────────────────────────────────────────────────────
def parse_fecha_hora(tiempo_str):
    return parser.parse(tiempo_str.strip(), dayfirst=True)

def calcular_metricas(valores):
    if not valores:
        return {"media": 0, "desv": 0, "min": 0, "max": 0, "n": 0}
    arr = np.array(valores, dtype=float)
    return {
        "media": round(float(np.mean(arr)), 3),
        "desv":  round(float(np.std(arr)), 3),
        "min":   round(float(np.min(arr)), 3),
        "max":   round(float(np.max(arr)), 3),
        "n":     len(valores)
    }

def calcular_estado(media, lim_low, lim_high):
    rango  = lim_high - lim_low
    margen = rango * 0.5
    if lim_low <= media <= lim_high:
        return "ok"
    if (lim_low - margen) <= media <= (lim_high + margen):
        return "warn"
    return "alert"

def razon_por_estado(estado, media, lim_low, lim_high):
    if estado == "ok":
        return None
    if media < lim_low:
        return f"Media {media} < límite inferior {lim_low}"
    if media > lim_high:
        return f"Media {media} > límite superior {lim_high}"
    return "Valor dentro de zona de alerta"

# ── BD: límites de control ─────────────────────────────────────
def get_caracteristicas():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute('SELECT upperlimit, lowerlimit FROM caracteristicas LIMIT 1')
        row = cur.fetchone()
        conn.close()
        if row:
            return {"upperlimit": float(row["upperlimit"]), "lowerlimit": float(row["lowerlimit"])}
    except Exception as e:
        print(f"[ERROR] get_caracteristicas: {e}")
    return {"upperlimit": 1.777, "lowerlimit": 1.723}

def update_caracteristicas(upper, lower):
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute('UPDATE caracteristicas SET upperlimit = ?, lowerlimit = ?', (upper, lower))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[ERROR] update_caracteristicas: {e}")
        return False

# ── Agrupación de filas en lotes ──────────────────────────────
def agrupar_filas_en_lotes(rows):
    lotes = []
    current = []
    current_date = None

    for row in rows:
        tiempo_str = row["tiempo"].strip()
        mm_str = row["mm"].strip() if row["mm"] else ""

        if mm_str == "nuevo_lote":
            if current:
                lotes.append(current)
                current = []
                current_date = None
            continue

        try:
            mm_val = float(mm_str)
        except ValueError:
            continue

        try:
            dt = parse_fecha_hora(tiempo_str)
            fecha = dt.strftime("%Y-%m-%d")
        except Exception:
            if current:
                current.append((tiempo_str, mm_val))
            else:
                current.append((tiempo_str, mm_val))
            continue

        if not current:
            current.append((tiempo_str, mm_val))
            current_date = fecha
        else:
            if fecha != current_date:
                lotes.append(current)
                current = [(tiempo_str, mm_val)]
                current_date = fecha
            else:
                current.append((tiempo_str, mm_val))

    if current:
        lotes.append(current)
    return lotes

# ── Procesar lote ──────────────────────────────────────────────
def procesar_lote(lote_data, counter):
    if not lote_data:
        return None
    try:
        tiempos, valores = zip(*lote_data)
        metricas = calcular_metricas(list(valores))
        primer_tiempo = parse_fecha_hora(tiempos[0].strip())
        fecha = primer_tiempo.strftime("%Y-%m-%d")
        hora  = primer_tiempo.strftime("%H:%M")
        id_lote = f"LOT-{fecha.replace('-','')}-{str(counter).zfill(3)}"

        limites = get_caracteristicas()
        estado = calcular_estado(metricas["media"], limites["lowerlimit"], limites["upperlimit"])
        razon = razon_por_estado(estado, metricas["media"], limites["lowerlimit"], limites["upperlimit"])

        return {
            "id": id_lote,
            "fecha": fecha,
            "hora": hora,
            "estado": estado,
            "img": None,
            "metricas": metricas,
            "razon": razon
        }
    except Exception as e:
        print(f"[ERROR] procesar_lote: {e}")
        return None

# ── Endpoints ──────────────────────────────────────────────────
@app.route("/api/status")
def status():
    return jsonify({"status": "ok", "version": "1.0"})

@app.route("/api/lotes")
def lotes():
    hoy = datetime.today()
    desde = request.args.get("desde") or (hoy - timedelta(days=6)).strftime("%Y-%m-%d")
    hasta = request.args.get("hasta") or hoy.strftime("%Y-%m-%d")

    try:
        desde_dt = datetime.strptime(desde, "%Y-%m-%d")
        hasta_dt = datetime.strptime(hasta, "%Y-%m-%d") + timedelta(days=1)

        conn = get_connection()
        cur = conn.cursor()
        cur.execute('SELECT tiempo, mm FROM diametro ORDER BY tiempo')
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()

        # Filtrar por fecha manualmente (SQLite no tiene to_timestamp)
        rows_filtradas = []
        for row in rows:
            try:
                dt = parse_fecha_hora(row["tiempo"])
                if desde_dt <= dt <= hasta_dt:
                    rows_filtradas.append(row)
            except Exception:
                pass

        lotes_crudos = agrupar_filas_en_lotes(rows_filtradas)
        resultado = []
        for idx, lote_crudo in enumerate(lotes_crudos, start=1):
            lote_procesado = procesar_lote(lote_crudo, idx)
            if lote_procesado:
                resultado.append(lote_procesado)

        return jsonify({"lotes": resultado})
    except Exception as e:
        print(f"[ERROR] get_lotes: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/lotes/<lote_id>")
def lote_detalle(lote_id):
    try:
        partes = lote_id.split('-')
        if len(partes) < 3:
            return jsonify({"tiempos": [], "mm": []})

        fecha_str = partes[1]
        lote_counter_str = partes[2]
        target_counter = int(lote_counter_str)

        fecha = f"{fecha_str[:4]}-{fecha_str[4:6]}-{fecha_str[6:]}"
        desde_dt = datetime.strptime(fecha, "%Y-%m-%d")
        hasta_dt = desde_dt + timedelta(days=1)

        conn = get_connection()
        cur = conn.cursor()
        cur.execute('SELECT tiempo, mm FROM diametro ORDER BY tiempo')
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()

        # Filtrar por fecha
        rows_filtradas = []
        for row in rows:
            try:
                dt = parse_fecha_hora(row["tiempo"])
                if desde_dt <= dt <= hasta_dt:
                    rows_filtradas.append(row)
            except Exception:
                pass

        lotes_crudos = agrupar_filas_en_lotes(rows_filtradas)
        if target_counter < 1 or target_counter > len(lotes_crudos):
            return jsonify({"tiempos": [], "mm": []})

        lote_seleccionado = lotes_crudos[target_counter - 1]
        tiempos_list = [t for t, v in lote_seleccionado]
        mm_list = [v for t, v in lote_seleccionado]
        return jsonify({"tiempos": tiempos_list, "mm": mm_list})
    except Exception as e:
        print(f"[ERROR] get_lote_data: {e}")
        return jsonify({"tiempos": [], "mm": []})

@app.route("/api/caracteristicas", methods=["GET", "POST"])
def caracteristicas():
    if request.method == "GET":
        return jsonify(get_caracteristicas())
    if request.method == "POST":
        data = request.get_json()
        upper = data.get("upperlimit")
        lower = data.get("lowerlimit")
        if upper is not None and lower is not None:
            if update_caracteristicas(upper, lower):
                return jsonify({"status": "updated"})
            return jsonify({"error": "No se pudo actualizar"}), 500
        return jsonify({"error": "Invalid data"}), 400

@app.route("/api/lotes/<lote_id>", methods=["DELETE"])
def eliminar_lote(lote_id):
    try:
        partes = lote_id.split('-')
        if len(partes) < 3:
            return jsonify({"error": "ID de lote inválido"}), 400
        fecha_str = partes[1]
        lote_counter_str = partes[2]
        target_counter = int(lote_counter_str)
        fecha = f"{fecha_str[:4]}-{fecha_str[4:6]}-{fecha_str[6:]}"

        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, tiempo, mm FROM diametro ORDER BY tiempo")
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()

        # Filtrar solo las del día
        desde_dt = datetime.strptime(fecha, "%Y-%m-%d")
        hasta_dt = desde_dt + timedelta(days=1)
        rows_fecha = []
        for r in rows:
            try:
                dt = parse_fecha_hora(r["tiempo"])
                if desde_dt <= dt <= hasta_dt:
                    rows_fecha.append(r)
            except:
                pass

        # Agrupar en lotes con IDs
        lotes_con_ids = agrupar_con_ids(rows_fecha)  # definida abajo

        if target_counter < 1 or target_counter > len(lotes_con_ids):
            return jsonify({"error": "Lote no encontrado"}), 404

        lote_a_eliminar = lotes_con_ids[target_counter - 1]

        # Eliminar cada fila por ID
        conn = get_connection()
        cur = conn.cursor()
        ids = [fila["id"] for fila in lote_a_eliminar]
        cur.executemany("DELETE FROM diametro WHERE id = ?", [(i,) for i in ids])
        conn.commit()
        conn.close()

        return jsonify({"status": "eliminado", "registros": len(ids)})
    except Exception as e:
        print(f"[ERROR] eliminar_lote: {e}")
        return jsonify({"error": str(e)}), 500
    
def agrupar_con_ids(rows):
    """Agrupa filas (con id, tiempo, mm) en lotes, devolviendo listas de dicts completas."""
    lotes = []
    current = []
    current_date = None

    for row in rows:
        tiempo_str = row["tiempo"].strip()
        mm_str = row["mm"].strip() if row["mm"] else ""

        if mm_str == "nuevo_lote":
            if current:
                lotes.append(current)
            current = []
            current_date = None
            continue
        try:
            mm_val = float(mm_str)
        except ValueError:
            continue
        try:
            dt = parse_fecha_hora(tiempo_str)
            fecha = dt.strftime("%Y-%m-%d")
        except:
            if current:
                current.append(row)
            else:
                current.append(row)
            continue

        if not current:
            current.append(row)
            current_date = fecha
        else:
            if fecha != current_date:
                lotes.append(current)
                current = [row]
                current_date = fecha
            else:
                current.append(row)

    if current:
        lotes.append(current)
    return lotes

@app.route("/api/diametro", methods=["DELETE"])
def limpiar_diametro():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM diametro")
        conn.commit()
        conn.close()
        return jsonify({"status": "limpio"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── NUEVO: Endpoint para recibir datos del ESP32 ───────────────
@app.route("/api/medicion", methods=["POST"])
def recibir_medicion():
    data = request.get_json()
    if not data or "mm" not in data:
        return jsonify({"error": "Falta el campo 'mm'"}), 400

    mm_valor = data["mm"]
    es_nuevo_lote = data.get("nuevo_lote", False)
    ahora = datetime.now()
    tiempo_str = ahora.strftime("%d/%m/%Y %H:%M:%S")

    try:
        conn = get_connection()
        cur = conn.cursor()

        if es_nuevo_lote:
            cur.execute('INSERT INTO diametro (tiempo, mm) VALUES (?, ?)', (tiempo_str, "nuevo_lote"))
            if mm_valor != "nuevo_lote":
                cur.execute('INSERT INTO diametro (tiempo, mm) VALUES (?, ?)', (tiempo_str, str(mm_valor)))
        else:
            cur.execute('INSERT INTO diametro (tiempo, mm) VALUES (?, ?)', (tiempo_str, str(mm_valor)))

        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "tiempo": tiempo_str}), 201
    except Exception as e:
        print(f"[ERROR] recibir_medicion: {e}")
        return jsonify({"error": str(e)}), 500

# ── Servir el frontend estático ─────────────────────────────────
@app.route('/')
def servir_index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def servir_estaticos(path):
    return send_from_directory('static', path)

if __name__ == "__main__":
    init_db()
    print("=" * 50)
    print("FilaPrint Server iniciado (SQLite)")
    print("Accede en http://localhost:5000")
    print("=" * 50)
    app.run(debug=False, host="0.0.0.0", port=5000)