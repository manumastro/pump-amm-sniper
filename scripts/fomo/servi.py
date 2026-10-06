# Ponte fra Playwright (avvia_scarico.js, chiudi_scarico.js) e i dati locali, solo su 127.0.0.1:
#   GET  /noti.json      id -> ora dell'ultimo swap salvato (cosi' la pagina scarica solo il nuovo)
#   GET  /extra.json     id da scaricare oltre alle classifiche (dati/fomo/extra.json, facoltativo)
#   GET  /scarico_pagina.js  la funzione che gira nella pagina
#   GET  /segui_lista.json, /segui_pagina.js   chi seguire da vicino (dati/fomo/segui/lista.json)
#   GET  /dettagli_lista.json, POST /dettagli   curve, posizioni e commenti dei migliori (dati/fomo/dettagli/)
#   POST /token          il token d'accesso fresco per fomo-mcp (~/.config/fomo-mcp/token)
#   POST /segui          swap nuovi dei seguiti, in dati/fomo/segui/<giorno>.jsonl (prezzi dopo, con foto_catena.js)
#   POST /scarico        la pagina manda lo scarico; finisce in dati/fomo/grezzi/ e viene importato
# Uso: python3 scripts/fomo/servi.py   (resta acceso durante lo scarico; Ctrl-C per chiudere)
import json, os, subprocess, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(__file__))
from comune import DATI, utenti, utente
ORIGINE = 'https://fomo.family'
CASSA = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112'}
def foto(s):
    # solo cio' che serve per misurare dopo il token dalla catena (foto_catena.js): lato, token, rete, ora
    compra = s['i'] in CASSA; tok = s['o'] if compra else s['i']; net = s['onet'] if compra else s['inet']
    if not tok or tok in CASSA: return None
    return dict(lato='acquisto' if compra else 'vendita', tok=tok, net=net, ora=datetime.now(timezone.utc).isoformat())
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
        if self.path == '/segui_pagina.js':
            b = open(os.path.join(os.path.dirname(__file__), 'segui_pagina.js'), 'rb').read()
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b); return
        if self.path == '/segui_lista.json':
            f = os.path.join(DATI, 'segui', 'lista.json'); b = open(f, 'rb').read() if os.path.exists(f) else b'[]'
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b); return
        if self.path in ('/extra.json', '/riempi.json', '/dettagli_lista.json'):
            f = os.path.join(DATI, self.path[1:]); b = open(f, 'rb').read() if os.path.exists(f) else b'[]'
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b); return
        if self.path != '/noti.json': self.send_response(404); self._cors(); self.end_headers(); return
        noti = {}
        for u in utenti():
            sw = utente(u).get('swaps') or []
            if sw: noti[u] = sw[-1]['t']
        b = json.dumps(noti).encode()
        self.send_response(200); self._cors(); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        if self.path == '/token':
            # token d'accesso di fomo per fomo-mcp: solo nel file, mai stampato
            n = int(self.headers['content-length']); t = json.loads(self.rfile.read(n)).get('token', '')
            if t.count('.') == 2:
                d = os.path.expanduser('~/.config/fomo-mcp'); os.makedirs(d, mode=0o700, exist_ok=True)
                f = os.path.join(d, 'token'); fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                os.write(fd, t.encode()); os.close(fd); print('token fomo-mcp aggiornato', flush=True)
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b'ok'); return
        if self.path == '/dettagli':
            n = int(self.headers['content-length']); d = json.loads(self.rfile.read(n))
            f = os.path.join(DATI, 'dettagli', f"{d['id']}.json"); os.makedirs(os.path.dirname(f), exist_ok=True)
            json.dump(d, open(f, 'w')); print(f"dettagli: {d['id']}", flush=True)
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b'ok'); return
        if self.path == '/segui':
            n = int(self.headers['content-length']); nuovi = json.loads(self.rfile.read(n))
            righe = [dict(r, foto=foto(r['s'])) for r in nuovi]
            f = os.path.join(DATI, 'segui', f"{datetime.now(timezone.utc):%Y-%m-%d}.jsonl"); os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'a') as fh:
                for r in righe: fh.write(json.dumps(r) + '\n')
            print(f"segui: {len(righe)} swap nuovi", flush=True)
            self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b'ok'); return
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
