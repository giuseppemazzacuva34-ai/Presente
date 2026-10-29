# Prova completa dell'iscrizione in anteprima con Chromium (microfono finto), dall'inizio a «Il tuo profilo è pronto».
# Uso: node scripts/server_locale.mjs . &  poi  python3 scripts/prova_app.py <cartella per le schermate> <foto jpg di prova>
# Salva una schermata per ogni passo. Non usa dati reali.
import asyncio, sys, os, re
from playwright.async_api import async_playwright
S = sys.argv[1]
FOTO = sys.argv[2]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, permissions=["microphone"])
        pg = await ctx.new_page()
        errori = []
        pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
        n = [0]
        async def foto(nome):
            n[0] += 1; await pg.screenshot(path=f"{S}/schermo-{n[0]:02d}-{nome}.png", full_page=True)
        async def clic(testo):
            await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
        await pg.goto("http://localhost:8787/app/"); await pg.wait_for_timeout(500)
        await foto("benvenuto"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await foto("email"); await clic("Mandami il link")
        await pg.fill("#nascita", "2012-05-01"); await foto("minorenne")
        await clic("Torna all'inizio"); await clic("Entra"); await pg.fill("#email", "prova@example.com"); await clic("Mandami il link")
        await pg.fill("#nascita", "1994-05-01"); await clic("Continua")
        await pg.check("#accetto"); await foto("regole"); await clic("Continua")
        await pg.fill("#nome", "Giulia"); await pg.locator("#nome").blur()
        await pg.select_option("#citta", "Milano"); await clic("Donna"); await foto("chi-sei"); await clic("Continua")
        await clic("Uomini"); await pg.check("#consenso-cerco"); await clic("Una storia seria"); await clic("Forse"); await clic("Indifferente")
        await foto("chi-cerchi"); await clic("Continua")
        await clic("● Registra"); await pg.wait_for_timeout(2500); await foto("voce-registra"); await pg.wait_for_timeout(4000); await clic("Ferma")
        await pg.wait_for_selector(".registratore audio"); await foto("voce-fatta"); await clic("Continua")
        for d in ["Una cosa che ti fa ridere sempre", "Il posto dove ti senti a casa", "La tua domenica perfetta"]:
            await clic(d)
        for i in range(3):
            await pg.locator("button", has_text="Registra").first.click(); await pg.wait_for_timeout(6200)
            await clic("Ferma"); await pg.wait_for_timeout(400)
        await foto("risposte-voce"); await clic("Continua")
        # questionario: prima opzione (o le prime necessarie), importanza "Molto"
        for q in range(1, 16):
            bottoni = pg.locator(f'.scelte [data-nome="q{q}"]')
            if q in (1, 13): await bottoni.nth(0).click(); await bottoni.nth(1).click()
            elif q == 15: await bottoni.nth(2).click()
            else: await bottoni.nth(0).click()
            imp = pg.locator('.quanto-conta .scelta')
            if await imp.count(): await imp.nth(2).click()
            if q in (1, 3, 15): await foto(f"questionario-{q}")
            await pg.get_by_role("button", name="Fine questionario" if q == 15 else "Avanti").click()
        for i in range(3):
            await pg.set_input_files(f"#foto-{i}", FOTO); await pg.wait_for_timeout(500)
        await foto("foto"); await clic("Continua")
        await foto("fatto")
        print("titolo finale:", await pg.locator("h1").inner_text())
        print("console:", errori or "pulita")
        if errori: sys.exit(1)
        await b.close()
asyncio.run(main())
