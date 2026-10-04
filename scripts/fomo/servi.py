# Ponte fra Playwright (avvia_scarico.js, chiudi_scarico.js) e i dati locali, solo su 127.0.0.1:
#   GET  /noti.json      id -> ora dell'ultimo swap salvato (cosi' la pagina scarica solo il nuovo)
#   GET  /extra.json     id da scaricare oltre alle classifiche (dati/fomo/extra.json, facoltativo)
#   GET  /scarico_pagina.js  la funzione che gira nella pagina
#   POST /scarico        la pagina manda lo scarico; finisce in dati/fomo/grezzi/ e viene importato
# Uso: python3 scripts/fomo/servi.py   (resta acceso durante lo scarico; Ctrl-C per chiudere)
import json, os, subprocess, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(__file__))
from comune import DATI, utenti, utente
ORIGINE = 'https://fomo.family'
class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', ORIGINE)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/scarico_pagina.js':
            b = open(os.path.join(os.path.dirname(__file__), 'scarico_pagina.js'), 'rb').read()
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b); return
        if self.path == '/extra.json':
            f = os.path.join(DATI, 'extra.json'); b = open(f, 'rb').read() if os.path.exists(f) else b'[]'
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b); return
        if self.path != '/noti.json': self.send_response(404); self._cors(); self.end_headers(); return
        noti = {}
        for u in utenti():
            sw = utente(u).get('swaps') or []
            if sw: noti[u] = sw[-1]['t']
        b = json.dumps(noti).encode()
        self.send_response(200); self._cors(); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        if self.path != '/scarico': self.send_response(404); self._cors(); self.end_headers(); return
        n = int(self.headers['content-length']); corpo = self.rfile.read(n)
        f = os.path.join(DATI, 'grezzi', f"arrivo-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}.json")
        os.makedirs(os.path.dirname(f), exist_ok=True); open(f, 'wb').write(corpo)
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'importa.py'), f], capture_output=True, text=True)
        msg = (r.stdout + r.stderr).strip(); print(msg, flush=True)
        self.send_response(200); self._cors(); self.send_header('content-type', 'text/plain'); self.end_headers(); self.wfile.write(msg.encode())
    def log_message(self, *a): pass
print('in ascolto su 127.0.0.1:8765', flush=True)
HTTPServer(('127.0.0.1', 8765), H).serve_forever()
