# Prova nel browser di «Arrivo in ritardo» (#6 spec v1, casi limite, linea B) con Chromium, Supabase FINTO in memoria e
# Worker finto. Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_ritardo_incontro.py <cartella per le schermate>
# Controlla: dalla home «Apri» l'incontro confermato; «Arrivo in ritardo» apre la scelta +15 / +30 senza rete; «+15
# minuti» manda solo azione, porta e minuti; poi «Hai avvisato…» e niente più pulsante; tutto da tastiera; console pulita.
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
PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
from datetime import datetime, timedelta, timezone
ORA = (datetime.now(timezone.utc) + timedelta(minutes=10)).replace(microsecond=0)
iso = lambda d: d.isoformat().replace("+00:00", "Z")
STATO = {"stato": "confermato", "scadenza": iso(ORA + timedelta(days=5)), "orario": iso(ORA), "locale": None,
         "luogo": "Bar della piazza", "proposta_mia": False, "proposta_scade": None, "controproposte_rimaste": 3,
         "azioni": ["sono_qui", "disdici", "ritardo"], "ritardo_minuti": 0, "ritardo_mio": False, "esito": None,
         "checkin_mio": False, "checkin_altro": False, "checkin_da": iso(ORA - timedelta(minutes=30)),
         "checkin_fino": iso(ORA + timedelta(minutes=30)), "segnale": None, "disdetta": None, "locali": [], "locale_scelto": None}

async def main():
    mandate = []
    stato = dict(STATO)
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
        ok = lambda corpo, s=200: route.fulfill(status=s, body=json.dumps(corpo), content_type="application/json")
        if u.path == "/app/api/incontro" and u.query == "elenco=1":
            return await ok({"ok": True, "incontri": [{"porta": PORTA, "nome": "Ciro", "stato": "confermato",
                                                       "scadenza": stato["scadenza"], "orario": stato["orario"], "esito": None}]})
        if u.path == "/app/api/incontro" and u.query == "riepilogo=1":
            return await ok({"ok": True, "riepilogo": {"valutati": 0, "bollini": None, "no_ricevuti": []}})
        if u.path == "/app/api/incontro" and u.query == "contestazioni=1": return await ok({"ok": True, "contestazioni": {}})
        if u.path == "/app/api/incontro" and r.method == "POST":
            mandate.append(json.loads(r.post_data))
            stato.update({"azioni": ["sono_qui", "disdici"], "ritardo_minuti": 15, "ritardo_mio": True})
            return await ok({"ok": True, "esito": "ritardo"})
        if u.path == "/app/api/incontro" and u.query == f"porta={PORTA}": return await ok({"ok": True, "incontro": stato})
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
        apri = pg.locator("button", has_text=re.compile("^Apri$")).first
        await apri.wait_for(timeout=15000)
        await apri.focus(); await pg.keyboard.press("Enter")
        sezione = pg.locator("section.incontro")
        await sezione.wait_for()
        bott = sezione.locator("button", has_text=re.compile("^Arrivo in ritardo$"))
        await bott.wait_for()
        await bott.focus(); await pg.keyboard.press("Enter")
        await pg.wait_for_selector("text=Di quanto arrivi in ritardo? Puoi dirlo una volta sola.")
        assert mandate == [], mandate
        assert await sezione.locator("button", has_text=re.compile("^Arrivo in ritardo$")).count() == 0
        await sezione.screenshot(path=f"{S}/ritardo-scelta.png")
        piu15 = sezione.locator("button", has_text=re.compile(r"^\+15 minuti$"))
        await piu15.focus(); await pg.keyboard.press("Enter")
        await pg.wait_for_selector("text=Hai avvisato che arrivi con 15 minuti di ritardo.")
        assert mandate == [{"azione": "ritardo", "minuti": 15, "porta": PORTA}], mandate
        assert await sezione.locator("button", has_text=re.compile("^Arrivo in ritardo$")).count() == 0
        await sezione.screenshot(path=f"{S}/ritardo-avvisato.png")
        await b.close()
    assert not errori, errori
    print("arrivo in ritardo: ok, console pulita")

asyncio.run(main())
