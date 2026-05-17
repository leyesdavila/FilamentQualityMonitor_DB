from api import app, init_db
import sys
import os
import webbrowser
import threading
import time

def abrir_navegador():
    """Espera un momento y abre el navegador"""
    time.sleep(2)  # Dar tiempo al servidor para iniciar
    webbrowser.open('http://localhost:5000')

if __name__ == "__main__":
    init_db()
    
    # Iniciar el navegador en un hilo separado
    threading.Thread(target=abrir_navegador, daemon=True).start()
    
    print("=" * 50)
    print("FilaPrint iniciado")
    print("Abre http://localhost:5000 en tu navegador")
    print("=" * 50)
    app.run(debug=False, host="0.0.0.0", port=5000)