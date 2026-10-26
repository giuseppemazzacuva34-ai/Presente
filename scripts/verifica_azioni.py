#!/usr/bin/env python3
"""Controlla che ogni azione usata nei workflow di GitHub sia fissata a un codice esatto (SHA di 40 caratteri).

Un'etichetta come @v4 può essere spostata da chi pubblica l'azione: se il suo account venisse violato,
il nostro workflow eseguirebbe codice nuovo senza che nessuno lo veda. Con lo SHA eseguiamo sempre
esattamente il codice controllato. Dependabot aggiorna gli SHA da solo.

Uso: python3 scripts/verifica_azioni.py
"""
from pathlib import Path
import re
import sys

CARTELLA = Path(__file__).resolve().parent.parent / ".github" / "workflows"
USO = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)")
errori = []
for file in sorted(CARTELLA.glob("*.y*ml")):
    for numero, riga in enumerate(file.read_text().splitlines(), 1):
        trovato = USO.match(riga)
        if not trovato:
            continue
        azione = trovato.group(1)
        if azione.startswith("./"):
            continue
        if not re.search(r"@[0-9a-f]{40}$", azione):
            errori.append(f"{file.name}:{numero}: {azione} non è fissata a uno SHA")
    if not re.search(r"^permissions:", file.read_text(), re.M):
        errori.append(f"{file.name}: manca 'permissions:' (permessi minimi)")

if errori:
    print("\n".join(errori))
    sys.exit(1)
print("OK: tutte le azioni sono fissate a uno SHA e i permessi sono dichiarati.")
