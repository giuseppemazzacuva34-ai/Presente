# Genera landing/media/presente-30-carte.pdf (D64, punto 3) dalle 30 carte approvate con D58 (scripts/carte_domande.txt).
# Uso: python3 scripts/genera_carte.py landing/media/presente-30-carte.pdf  (serve Playwright con Chromium)
import sys, html, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
repo = Path(__file__).resolve().parent.parent
domande = [l.split(". ",1)[1] for l in (repo/"scripts/carte_domande.txt").read_text().splitlines() if l.strip()]
assert len(domande) == 30
font = (repo/"landing/fonts").as_uri()
carte = [f'<div class="carta"><span class="n">{i:02d}</span><p>{html.escape(d)}</p><span class="marchio">presente</span></div>' for i,d in enumerate(domande,1)]
pagina = f"""<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
@font-face {{ font-family: S; src: url("{font}/InstrumentSerif-Regular.woff"); }}
@font-face {{ font-family: S; font-style: italic; src: url("{font}/InstrumentSerif-Italic.woff"); }}
@font-face {{ font-family: A; src: url("{font}/InstrumentSans.woff"); font-weight: 400 700; }}
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font-family: A, sans-serif; color: #0e0d10; }}
.copertina {{ height: 297mm; background: #0e0d10; color: #f2ede4; padding: 28mm 22mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }}
.copertina h1 {{ font-family: S; font-weight: 400; font-size: 54pt; line-height: 1.02; margin: 0; }}
.copertina h1 em {{ color: #e8432b; }}
.copertina p {{ font-size: 12pt; line-height: 1.5; max-width: 140mm; color: #d8d2c8; }}
.logo {{ font-family: S; font-size: 26pt; }}
.logo b {{ color: #e8432b; font-weight: 400; }}
.foglio {{ height: 297mm; padding: 12mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 8mm; page-break-after: always; background: #f2ede4; }}
.foglio:last-child {{ page-break-after: auto; }}
.carta {{ border: 0.4mm dashed #a8a29a; border-radius: 4mm; background: #fffdf8; padding: 9mm 8mm; position: relative; display: flex; align-items: center; }}
.carta p {{ font-family: S; font-size: 21pt; line-height: 1.15; margin: 0; }}
.n {{ position: absolute; top: 6mm; left: 8mm; font-size: 9pt; letter-spacing: .12em; color: #e8432b; font-weight: 600; }}
.marchio {{ position: absolute; bottom: 5mm; right: 8mm; font-family: S; font-size: 11pt; color: #a8a29a; }}
</style></head><body>
<section class="copertina"><div class="logo">presente<b>!</b></div>
<div><h1>30 carte per il <em>primo appuntamento.</em></h1>
<p>Domande leggere per rompere il ghiaccio, a voce o dal vivo. Ritagliale, mischiale, pescane una a testa. Niente domande sul lavoro, sull'aspetto o su dove abiti: solo cose che fanno venire voglia di raccontarsi.</p></div>
<p>Un regalo per chi è in lista d'attesa · presenteincontri.app</p></section>
""" + "".join('<section class="foglio">' + "".join(carte[i*6:(i+1)*6]) + "</section>" for i in range(5)) + "</body></html>"
(Path(tempfile.gettempdir())/"carte.html").write_text(pagina)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto((Path(tempfile.gettempdir())/"carte.html").as_uri()); pg.wait_for_timeout(500)
    pg.pdf(path=sys.argv[1], format="A4", print_background=True)
    b.close()
