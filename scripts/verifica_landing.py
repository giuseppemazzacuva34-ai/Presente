#!/usr/bin/env python3
"""Controlli automatici sulla landing page della lista d'attesa (cartella /landing).

Verifica che:
- ogni pagina HTML sia ben formata, in italiano e adatta al telefono;
- il modulo raccolga solo email, zona, invito facoltativo, maggiore età e consenso (più i campi tecnici di Netlify);
- nessuna risorsa venga caricata da siti esterni (privacy e velocità);
- tutti i link interni portino a un file esistente;
- l'informativa resti marcata BOZZA finché non è approvata;
- la pagina resti leggera.

Uso: python3 scripts/verifica_landing.py
"""
from html.parser import HTMLParser
from pathlib import Path
import sys

CARTELLA = Path(__file__).resolve().parent.parent / "landing"
PAGINE = ["index.html", "grazie.html", "privacy.html"]
CAMPI_AMMESSI = {"form-name", "campo-trappola", "email", "zona", "invito", "maggiorenne", "consenso"}
CAMPI_OBBLIGATORI = {"email", "zona", "maggiorenne", "consenso"}
PESO_MASSIMO = 60 * 1024  # byte, HTML + CSS della pagina principale
VUOTI = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
         "path", "rect", "circle"}

errori = []


class Lettore(HTMLParser):
    def __init__(self):
        super().__init__()
        self.pila, self.tag, self.campi, self.link, self.risorse = [], [], {}, [], []
        self.lingua = None
        self.moduli = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tag.append((tag, a))
        if tag == "html":
            self.lingua = a.get("lang")
        if tag == "form":
            self.moduli.append(a)
        if tag in ("input", "select", "textarea") and a.get("name"):
            self.campi[a["name"]] = a
        if tag == "a" and a.get("href"):
            self.link.append(a["href"])
        for chiave in ("src", "href"):
            if tag in ("script", "img", "link", "iframe", "source") and a.get(chiave):
                self.risorse.append(a[chiave])
        if tag not in VUOTI:
            self.pila.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VUOTI and self.pila and self.pila[-1] == tag:
            self.pila.pop()

    def handle_endtag(self, tag):
        if tag in VUOTI:
            return
        if not self.pila or self.pila[-1] != tag:
            errori.append(f"{self.file}: tag </{tag}> chiuso nel posto sbagliato (aperti: {self.pila[-3:]})")
            if tag in self.pila:
                while self.pila and self.pila.pop() != tag:
                    pass
            return
        self.pila.pop()


def esterno(url):
    return url.startswith(("http://", "https://", "//"))


def destinazione(href):
    percorso = href.split("#")[0].split("?")[0]
    if percorso in ("", "/"):
        return CARTELLA / "index.html"
    percorso = percorso.lstrip("/")
    for candidato in (percorso, percorso + ".html", percorso + "/index.html"):
        if (CARTELLA / candidato).is_file():
            return CARTELLA / candidato
    return None


for nome in PAGINE:
    file = CARTELLA / nome
    if not file.is_file():
        errori.append(f"manca il file landing/{nome}")
        continue
    testo = file.read_text(encoding="utf-8")
    p = Lettore()
    p.file = nome
    p.feed(testo)
    p.close()
    if p.pila:
        errori.append(f"{nome}: tag non chiusi {p.pila}")
    if p.lingua != "it":
        errori.append(f"{nome}: manca lang=\"it\"")
    if not any(t == "meta" and a.get("name") == "viewport" for t, a in p.tag):
        errori.append(f"{nome}: manca il meta viewport per il telefono")
    if not any(t == "title" for t, _ in p.tag):
        errori.append(f"{nome}: manca il titolo")
    if "<script" in testo.lower():
        errori.append(f"{nome}: la landing non deve usare script")
    for r in p.risorse:
        if esterno(r):
            errori.append(f"{nome}: risorsa caricata da un sito esterno: {r}")
    for href in p.link:
        if esterno(href) or href.startswith(("mailto:", "tel:")):
            continue
        if destinazione(href) is None:
            errori.append(f"{nome}: link interno rotto: {href}")
    if nome == "index.html":
        if len(p.moduli) != 1:
            errori.append("index.html: serve esattamente un modulo")
        else:
            m = p.moduli[0]
            if m.get("data-netlify") != "true" or m.get("name") != "lista-attesa":
                errori.append("index.html: il modulo deve avere name=\"lista-attesa\" e data-netlify=\"true\"")
            if m.get("method", "").upper() != "POST":
                errori.append("index.html: il modulo deve usare POST")
            if destinazione(m.get("action", "")) is None:
                errori.append("index.html: la pagina di conferma del modulo non esiste")
        extra = set(p.campi) - CAMPI_AMMESSI
        if extra:
            errori.append(f"index.html: il modulo raccoglie dati non previsti: {sorted(extra)}")
        for campo in CAMPI_OBBLIGATORI:
            if campo not in p.campi:
                errori.append(f"index.html: manca il campo {campo}")
            elif "required" not in p.campi[campo]:
                errori.append(f"index.html: il campo {campo} deve essere obbligatorio")
        peso = len(testo.encode()) + (CARTELLA / "stile.css").stat().st_size
        if peso > PESO_MASSIMO:
            errori.append(f"index.html: pagina troppo pesante ({peso} byte, massimo {PESO_MASSIMO})")
    if nome == "privacy.html" and "BOZZA" not in testo:
        errori.append("privacy.html: l'informativa deve restare marcata BOZZA finché non è approvata (decisione D5)")

if errori:
    print("Verifica della landing: PROBLEMI TROVATI")
    for e in errori:
        print(" -", e)
    sys.exit(1)
print(f"Verifica della landing: tutto a posto ({len(PAGINE)} pagine controllate).")
