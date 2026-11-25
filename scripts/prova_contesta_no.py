# Prova nel browser di «Contesta» un «No» (#6 spec v1.3 punto 2, linea B) con Chromium, Supabase FINTO in memoria e
# Worker finto. Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_contesta_no.py <cartella per le schermate>
# Controlla: «Contesta» accanto al «no» contestabile, «In revisione» per quello già contestato; foglio con etichetta
# visibile e fuoco nel campo; testo corto rifiutato senza rete; «Manda» manda solo azione, domanda e testo; poi
# «Contestazione inviata…» e «In revisione»; tutto da tastiera; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
PROFILO = {"id": ID, "passo": 10, "nome": "Giulia", "provincia": "MI", "mi_presento_come": "donna",
           "data_nascita": "1994-05-09", "regole_accettate_il": "2026-11-01T10:00:00Z"}
TESTO = "Le foto erano mie, tutte recenti."

async def main():
    mandate = []
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/profili": return await ok([PROFILO])
        if p == "/rest/v1/filtri": return await ok([{"cerco": "tutti", "eta_min": 25, "eta_max": 45, "raggio": "italia"}])
        return await ok([])
    async def worker(route):
        r = route.request
        u = urlparse(r.url)
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if u.path == "/app/api/incontro" and u.query == "riepilogo=1":
            return await ok({"ok": True, "riepilogo": {"valutati": 2, "bollini": None, "no_ricevuti": ["presentato", "foto_sue"]}})
        if u.path == "/app/api/incontro" and u.query == "contestazioni=1":
            return await ok({"ok": True, "contestazioni": {"presentato": {"contestabile": False, "stato": "in_attesa"},
                                                           "foto_sue": {"contestabile": True, "stato": None}}})
        if u.path == "/app/api/incontro" and r.method == "POST":
            mandate.append(json.loads(r.post_data)); return await ok({"ok": True, "esito": "inviata"})
        if u.path == "/app/api/incontro" and u.query == "elenco=1": return await ok({"ok": True, "incontri": []})
        if u.path in ("/app/api/provincia-lista", "/app/api/zona"): return await ok({})
        return await ok({"ok": False, "motivo": "spento"}, 404)
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        await ctx.route(re.compile(r".*/app/api/.*"), worker)
        errori = []
        pg = await ctx.new_page()
        pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type == "error" and "404" not in m.text else None)
        pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
        clic = lambda testo: pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        blocco = pg.locator("[aria-label='Dopo i tuoi incontri']")
        await blocco.wait_for(timeout=15000)
        await pg.wait_for_selector("text=In revisione")
        riga_foto = blocco.locator("li").filter(has_text="Le foto erano davvero sue?")
        riga_pres = blocco.locator("li").filter(has_text="Si è presentata/o?")
        assert await riga_pres.locator("button", has_text="Contesta").count() == 0
        assert "In revisione" in await riga_pres.inner_text()
        bott = riga_foto.locator("button", has_text=re.compile("^Contesta$"))
        await bott.focus(); await pg.keyboard.press("Enter")
        campo = pg.locator("#contesta-foto_sue")
        await campo.wait_for()
        assert await pg.evaluate("document.activeElement.id") == "contesta-foto_sue"
        assert await pg.locator("label[for=contesta-foto_sue]").inner_text() == "Cosa non torna?"
        assert await pg.locator("label[for=contesta-foto_sue]").is_visible()
        await pg.keyboard.type("corto")
        await clic("Manda")
        await pg.wait_for_selector("text=Scrivi almeno 10 caratteri")
        assert mandate == [], mandate
        await campo.fill(TESTO)
        await blocco.screenshot(path=f"{S}/contesta-foglio.png")
        await clic("Manda")
        await pg.wait_for_selector("text=Contestazione inviata. Ti scriviamo qui quando è decisa.")
        assert mandate == [{"azione": "contesta", "domanda": "foto_sue", "testo": TESTO}], mandate
        assert await riga_foto.locator("button", has_text="Contesta").count() == 0
        assert "In revisione" in await riga_foto.inner_text()
        await blocco.screenshot(path=f"{S}/contesta-inviata.png")
        await b.close()
    assert not errori, errori
    print("contesta no: ok, console pulita")

asyncio.run(main())
