#!/usr/bin/env python3
"""Sitemap e IndexNow (richiesta del Coordinatore e del SEO, 1/11: «più visite al sito»).

Tre comandi:
  python3 scripts/sitemap.py aggiorna   → scrive in landing/sitemap.xml il <lastmod> giusto per ogni indirizzo
                                          (la data dell'ultima modifica del file della pagina nel repository).
  python3 scripts/sitemap.py controlla  → fallisce se una pagina è cambiata dopo il suo <lastmod> (lo usa «Verifica»
                                          nelle pull request: basta lanciare «aggiorna» e rifare il commit).
  python3 scripts/sitemap.py indexnow PRIMA DOPO
                                        → dopo una pubblicazione su main avvisa Bing e gli altri motori IndexNow
                                          degli indirizzi della sitemap con <lastmod> nuovo o cambiato fra i due commit.
                                          Se nel commit PRIMA il file della chiave non c'era, li manda tutti.

IndexNow: nessun dato personale (solo indirizzi pubblici del sito), nessun costo, nessun account.
La chiave è pubblica per definizione (sta in landing/<chiave>.txt), non è un segreto.
Mai /grazie, /privacy o /app/: non sono nella sitemap e il comando lo ricontrolla.
Nel log solo il codice di risposta (200 o 202 = ok).
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

RADICE = Path(__file__).resolve().parent.parent
LANDING = RADICE / "landing"
SITEMAP = LANDING / "sitemap.xml"
HOST = "presenteincontri.app"
SITO = f"https://{HOST}/"
CHIAVE = re.compile(r"^[0-9a-f]{32}$")
VIETATI = ("/grazie", "/privacy", "/app")
VOCE = re.compile(r"<url><loc>([^<]+)</loc><lastmod>(\d{4}-\d{2}-\d{2})</lastmod></url>")


def voci(testo):
    """Elenco (indirizzo, lastmod) nell'ordine della sitemap."""
    return VOCE.findall(testo)


def file_pagina(indirizzo):
    if not indirizzo.startswith(SITO):
        raise SystemExit(f"indirizzo fuori dal dominio nella sitemap: {indirizzo}")
    percorso = indirizzo[len(SITO):]
    return LANDING / ((percorso or "index") + ".html")


def data_git(file):
    data = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(file)], cwd=RADICE,
                          capture_output=True, text=True, check=True).stdout.strip()
    return data or time.strftime("%Y-%m-%d")  # file nuovo non ancora nel repository: oggi


def chiave():
    trovate = [p for p in LANDING.glob("*.txt") if CHIAVE.match(p.stem)]
    if len(trovate) != 1:
        raise SystemExit(f"serve esattamente un file della chiave IndexNow in landing/ (trovati {len(trovate)})")
    file = trovate[0]
    if file.read_text(encoding="utf-8").strip() != file.stem:
        raise SystemExit(f"{file.name}: deve contenere solo la chiave")
    return file.stem


def aggiorna():
    testo = SITEMAP.read_text(encoding="utf-8")
    nuovo = testo
    for indirizzo, vecchia in voci(testo):
        giusta = data_git(file_pagina(indirizzo))
        if giusta != vecchia:
            nuovo = nuovo.replace(f"<loc>{indirizzo}</loc><lastmod>{vecchia}</lastmod>",
                                  f"<loc>{indirizzo}</loc><lastmod>{giusta}</lastmod>")
    if nuovo != testo:
        SITEMAP.write_text(nuovo, encoding="utf-8")
        print("sitemap.xml aggiornata")
    else:
        print("sitemap.xml già aggiornata")


def controlla():
    errori = []
    testo = SITEMAP.read_text(encoding="utf-8")
    elenco = voci(testo)
    if len(elenco) != testo.count("<url>"):
        errori.append("sitemap.xml: ogni <url> deve stare su una riga con <loc> e <lastmod>")
    for indirizzo, lastmod in elenco:
        file = file_pagina(indirizzo)
        if any(indirizzo[len(SITO) - 1:].startswith(v) for v in VIETATI):
            errori.append(f"{indirizzo}: non va nella sitemap")
        elif not file.is_file():
            errori.append(f"{indirizzo}: manca il file {file.relative_to(RADICE)}")
        elif data_git(file) > lastmod:
            errori.append(f"{indirizzo}: pagina cambiata il {data_git(file)} ma <lastmod> è {lastmod}")
    try:
        chiave()
    except SystemExit as e:
        errori.append(str(e))
    if errori:
        print("Sitemap: PROBLEMI TROVATI (lancia «python3 scripts/sitemap.py aggiorna» e rifai il commit)")
        for e in errori:
            print(" -", e)
        sys.exit(1)
    print(f"Sitemap: tutto a posto ({len(elenco)} indirizzi, lastmod aggiornati).")


def mostra(commit, percorso):
    r = subprocess.run(["git", "show", f"{commit}:{percorso}"], cwd=RADICE, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def da_avvisare(prima, dopo):
    k = chiave()
    attuali = voci(mostra(dopo, "landing/sitemap.xml") or "")
    vecchia = mostra(prima, "landing/sitemap.xml") if prima and not set(prima) <= {"0"} else None
    if vecchia is None or mostra(prima, f"landing/{k}.txt") is None:
        scelti = [i for i, _ in attuali]  # prima volta: tutti
    else:
        prima_d = dict(voci(vecchia))
        scelti = [i for i, d in attuali if prima_d.get(i) != d]
    return k, [i for i in scelti if i.startswith(SITO) and not any(i[len(SITO) - 1:].startswith(v) for v in VIETATI)]


def online(url, atteso, tentativi=20, pausa=15):
    """Aspetta che Cloudflare abbia pubblicato la versione nuova (fino a 5 minuti)."""
    for _ in range(tentativi):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "presente-indexnow"}), timeout=15) as r:
                if r.read().decode("utf-8").strip() == atteso.strip():
                    return True
        except Exception:
            pass
        time.sleep(pausa)
    return False


def indexnow(prima, dopo):
    k, indirizzi = da_avvisare(prima, dopo)
    if not indirizzi:
        print("IndexNow: nessun indirizzo cambiato, niente da inviare")
        return
    if not online(f"{SITO}{k}.txt", k) or not online(f"{SITO}sitemap.xml", mostra(dopo, "landing/sitemap.xml")):
        print("IndexNow: la pubblicazione non è ancora online dopo 5 minuti, invio rimandato alla prossima")
        sys.exit(1)
    corpo = json.dumps({"host": HOST, "key": k, "keyLocation": f"{SITO}{k}.txt", "urlList": indirizzi}).encode()
    richiesta = urllib.request.Request("https://api.indexnow.org/indexnow", data=corpo, method="POST",
                                       headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(richiesta, timeout=30) as r:
            codice = r.status
    except urllib.error.HTTPError as e:
        codice = e.code
    print(f"IndexNow: {len(indirizzi)} indirizzi inviati, risposta {codice}")
    if codice not in (200, 202):
        sys.exit(1)


if __name__ == "__main__":
    comando = sys.argv[1] if len(sys.argv) > 1 else ""
    if comando == "aggiorna":
        aggiorna()
    elif comando == "controlla":
        controlla()
    elif comando == "indexnow" and len(sys.argv) == 4:
        indexnow(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(2)
