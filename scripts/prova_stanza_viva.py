# Prova nel browser della stanza viva e di «Fissa una chiamata» (#380, schermate 19-20) con Chromium, Supabase FINTO
# in memoria e Worker finto. Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_stanza_viva.py <cartella per le schermate>
# Controlla: cerchio diviso con «Uomini · N» / «Donne · N»; stato scritto sotto il nome; CHIAMA per chi è online e
# chiamabile, FISSA per chi non è in linea o fuori fascia; avviso di una proposta ricevuta; schermata 20 con giorni e
# ore dal server, «chiamate N di 3» sulla riga, messaggio facoltativo, «Proponi» che manda solo con, quando e messaggio; console pulita.
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
MARCO, DARIO, LUCA, SARA = ("a0000000-0000-4000-8000-00000000000" + str(n) for n in range(1, 5))
COMPAGNI = [{"utente_id": MARCO, "nome": "Marco", "eta": 35, "citta": "Milano"},
            {"utente_id": DARIO, "nome": "Dario", "eta": 34, "citta": "Monza"},
            {"utente_id": LUCA, "nome": "Luca", "eta": 33, "citta": "Milano"},
            {"utente_id": SARA, "nome": "Sara", "eta": 31, "citta": "Milano"}]
STATI = [{"id": MARCO, "stato": "online", "testo": "online", "con": None, "gruppo": "uomini"},
         {"id": DARIO, "stato": "in_chiamata", "testo": "in chiamata", "con": SARA, "gruppo": "uomini"},
         {"id": LUCA, "stato": "non_in_linea", "testo": "non in linea · da 2 h", "con": None, "gruppo": "uomini"},
         {"id": SARA, "stato": "in_chiamata", "testo": "in chiamata", "con": DARIO, "gruppo": "donne"}]
APP_ID = "b0000000-0000-4000-8000-000000000001"

def adesso_piu(ore):
    import datetime
    t = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=ore)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")

async def main():
    mandate = []
    ore = [adesso_piu(2), adesso_piu(3), adesso_piu(26)]
    appuntamenti = [{"id": APP_ID, "altra": MARCO, "propostoDaMe": False, "stato": "proposto", "quando": adesso_piu(4),
                     "messaggio": "Ti va di sentirci stasera?", "fase": "in_attesa", "puoControproporre": True, "annullatoDallAltra": False}]
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/profili": return await ok([PROFILO])
        if p == "/rest/v1/filtri": return await ok([{"cerco": "tutti", "eta_min": 25, "eta_max": 45, "raggio": "italia"}])
        if p == "/rest/v1/rpc/compagni_di_stanza": return await ok(COMPAGNI)
        if p == "/rest/v1/stanze": return await ok([{"tipo": "citta", "citta": "Milano", "apre_il": adesso_piu(-30)}])
        return await ok([])
    async def worker(route):
        r = route.request
        u = urlparse(r.url)
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if u.path == "/app/api/stanza/presenza":
            return await ok({"ok": True, "inStanza": True} if r.method == "POST" else {"ok": True, "persone": STATI})
        if u.path == "/app/api/stanza/appuntamenti":
            if r.method == "POST":
                mandate.append(json.loads(r.post_data)); return await ok({"ok": True})
            if u.query == f"con={LUCA}": return await ok({"ok": True, "ore": ore})
            return await ok({"ok": True, "appuntamenti": appuntamenti})
        if u.path == "/app/api/chiamata/pulsanti":
            return await ok({"ok": True, "pulsanti": [{"id": SARA, "testo": "È in un'altra chiamata"}, {"id": DARIO, "testo": "È in un'altra chiamata"}],
                                     "chiamate": [{"id": MARCO, "n": 2}, {"id": SARA, "n": 3}]})
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
        await pg.wait_for_selector(".cerchio-stanza", timeout=15000)
        await pg.wait_for_selector("text=Uomini · 3")
        await pg.wait_for_selector("text=Donne · 1")
        # Testata v4 (#349, schermata 19): «La tua stanza · Milano» a sinistra, «Giorno N di 7» a destra.
        assert (await pg.locator("#tua-stanza-titolo").text_content()) == "La tua stanza · Milano"
        assert re.fullmatch(r"Giorno [1-7] di 7", await pg.locator(".giorno-stanza").text_content())
        testo = await pg.locator(".tua-stanza").inner_text()
        assert "in chiamata con Sara" in testo, testo
        assert "non in linea · da 2 h" in testo, testo
        assert "Marco ti propone una chiamata" in testo, testo
        await pg.locator(".tua-stanza").screenshot(path=f"{S}/19-stanza-viva.png")
        # Luca non è in linea → FISSA; Marco è online → CHIAMA.
        riga_luca = pg.locator("li.compagno").filter(has_text="Luca")
        assert await riga_luca.locator("button", has_text=re.compile("^Fissa$")).count() == 1
        riga_marco = pg.locator("li.compagno").filter(has_text="Marco")
        assert await riga_marco.locator("button", has_text=re.compile("^Chiama$")).count() == 1
        assert "chiamate 2 di 3" in await riga_marco.inner_text()  # «chiamate N di 3» (#380 passo 6a)
        assert "chiamate 0 di 3" in await riga_luca.inner_text()
        await riga_luca.locator("button", has_text=re.compile("^Fissa$")).click()
        await pg.wait_for_selector("h1:has-text('Fissa una chiamata')")
        await pg.wait_for_selector(".fissa-chiamata [role=group] .scelta")
        ora = pg.locator("[aria-labelledby=fissa-ora] .scelta").first
        await ora.click()
        await pg.fill("#fissa-messaggio", "  Ti va di sentirci stasera?  ")
        await pg.screenshot(path=f"{S}/20-fissa-una-chiamata.png", full_page=True)
        await clic("Proponi")
        await pg.wait_for_selector("text=Proposta mandata a Luca.")
        assert mandate == [{"azione": "proponi", "con": LUCA, "quando": ore[0], "messaggio": "Ti va di sentirci stasera?"}], mandate
        await b.close()
    assert not errori, errori
    print("stanza viva: ok, console pulita")

asyncio.run(main())
