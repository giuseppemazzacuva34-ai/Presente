-- Fase 2 · issue #6 · spec v1.1 del CPO (20/11), punto 1 · decisione D143 B di Giuseppe (20/11). Linea «sviluppatore-b», passo 2t.
-- Nel test interno i 30 locali di Milano del tab «Locali pilota» (business plan, fonte Google Maps del 24/10, orari
-- indicativi) si mostrano solo a chi è in provincia di Milano, con la scritta «da verificare»; fuori Milano restano solo
-- i locali «visitato» della propria provincia (al massimo 3: oggi nessuno) e il luogo scritto dalla coppia.
-- - I 30 locali entrano «da visitare». «Fascia» = la colonna del tab (quando sono aperti). Tipi ricondotti all'elenco
--   della tabella: Speakeasy, «Cocktail e wine bar», «Cocktail bar e bistrot» → cocktail bar; Caffetteria → caffè;
--   «Bar e caffè» → bar.
-- - locali_per_persona(persona): i locali che quella persona può scegliere, solo i campi per la schermata. Solo server.
-- - proponi_incontro: stessa firma e stesse regole; in più un locale è accettato solo se è tra quelli di chi propone
--   (prima si controllava solo la forma).
-- Nessun dato personale. Solo aggiunte e una funzione riscritta con la stessa firma.
insert into public.locali (nome, indirizzo, provincia, tipo, fascia, stato)
select v.nome, v.indirizzo, 'MI', v.tipo, v.fascia, 'da_visitare' from (values
  ('41 Wine Bar & More', 'Via Volturno 41', 'wine bar', 'Mattina e sera'),
  ('Cru Isola', 'Via Ugo Bassi 24', 'wine bar', 'Sera'),
  ('Il Vinaccio', 'Via Garigliano 5', 'wine bar', 'Sera'),
  ('Barrique Enoteca e Degustazione', 'Via Pietro Borsieri 41', 'enoteca', 'Sera'),
  ('Tusa Isola Cocktail Bar', 'Via Pietro Borsieri 32', 'cocktail bar', 'Sera'),
  ('Luma Cocktail Bar', 'Via Pietro Borsieri 39', 'cocktail bar', 'Sera'),
  ('White Rabbit Speakeasy', 'Via Garigliano 4', 'cocktail bar', 'Sera'),
  ('Jo Caffè Bistrot', 'Piazza Tito Minniti 1', 'bistrot', 'Pranzo e sera'),
  ('MOMO Milano', 'Piazza Tito Minniti 5', 'bistrot', 'Tutto il giorno'),
  ('Caffetteria Morelli', 'Via Pietro Borsieri 29', 'caffè', 'Giorno, fino alle 19:30; domenica chiuso'),
  ('Isola cafè', 'Via Luigi Porro Lambertenghi 19', 'bar', 'Tutto il giorno'),
  ('Il Vinaccio', 'Via Soperga 65', 'wine bar', 'Sera'),
  ('Il Socialista Cantina e Dispensa', 'Via Pietro Crespi 11-13', 'wine bar', 'Sera'),
  ('Terzo Millennio', 'Via Montepulciano 11', 'wine bar', 'Sera'),
  ('IURIO', 'Via delle Leghe 5', 'cocktail bar', 'Sera; domenica chiuso'),
  ('Enoteca Lu Mieru', 'Via Giulio e Corrado Venini 52', 'enoteca', 'Sera'),
  ('NoLoSo', 'Via Luigi Varanini 5', 'bar', 'Sera'),
  ('NODO BAR', 'Via Marco Aurelio 8', 'bar', 'Giorno e sera; domenica chiuso'),
  ('WIJI BAR', 'Piazza Morbegno 2', 'cocktail bar', 'Sera; martedì chiuso'),
  ('It takes a drink', 'Via Martiri Oscuri', 'caffè', 'Giorno e sera'),
  ('Vice - Cocktail Wine Bar', 'Corso di Porta Romana 123', 'cocktail bar', 'Sera'),
  ('Il Cavallante', 'Via Lodovico Muratori 3', 'wine bar', 'Sera'),
  ('GolaSecca PortaRomana', 'Corso Lodi 29', 'wine bar', 'Sera'),
  ('Vino', 'Via Pier Lombardo 9', 'wine bar', 'Sera'),
  ('Les Rouges Cucina & Cocktails', 'Via Gerolamo Tiraboschi 15', 'cocktail bar', 'Sera'),
  ('The Spirit', 'Via Piacenza 15', 'cocktail bar', 'Sera'),
  ('KOI', 'Via Pier Lombardo 23', 'cocktail bar', 'Sera'),
  ('Bella Milano', 'Via Lazzaro Papi 19', 'bar', 'Tutto il giorno; domenica chiuso'),
  ('Dü Bistrot', 'Via Serviliano Lattuada 17', 'bistrot', 'Pranzo e sera; lunedì chiuso'),
  ('My Home Café', 'Corso di Porta Romana 128', 'caffè', 'Giorno, fino alle 18; domenica chiuso')
) as v (nome, indirizzo, tipo, fascia);

create function public.locali_per_persona(p_persona uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with chi as (select provincia from public.profili where id = p_persona),
  scelti as (
    -- D143 B: a Milano anche i locali da visitare, con «da verificare».
    select l.id, l.nome, l.indirizzo, l.tipo, l.fascia, l.stato <> 'visitato' as da_verificare
      from public.locali l, chi
      where chi.provincia = 'MI' and l.provincia = 'MI' and l.stato in ('visitato', 'da_visitare')
    union all
    (select l.id, l.nome, l.indirizzo, l.tipo, l.fascia, false
      from public.locali l, chi
      where chi.provincia is distinct from 'MI' and l.provincia = chi.provincia and l.stato = 'visitato'
      order by l.nome limit 3)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'indirizzo', indirizzo, 'tipo', tipo,
    'fascia', fascia, 'da_verificare', da_verificare) order by da_verificare, nome, indirizzo), '[]'::jsonb) from scelti
$$;
revoke all on function public.locali_per_persona(uuid) from public, anon, authenticated;
grant execute on function public.locali_per_persona(uuid) to service_role;

create or replace function public.proponi_incontro(p_porta uuid, p_persona uuid, p_orario timestamptz, p_locale text, p_luogo text)
  returns text language plpgsql set search_path = '' as $$
declare
  v_prima_ora constant integer := 10;
  v_ultima_ora constant integer := 23;
  v_passo constant integer := 30;
  v_controproposte constant integer := 3;
  v_porta public.porte;
  v_i public.incontri;
  v_oggi date;
  v_locale_roma timestamp;
  v_minuti integer;
  v_locale text := nullif(btrim(p_locale), '');
  v_luogo text := nullif(btrim(p_luogo), '');
  v_contro boolean := false;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if public.apri_incontro(p_porta) is null then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'scaduto' then
    return 'incontro_scaduto';
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato = 'confermato' then
    return 'gia_confermato';
  elsif v_i.stato = 'proposto' then
    if v_i.proposto_da = p_persona then
      return 'attendi_risposta';
    end if;
    if v_i.controproposte >= v_controproposte then
      return 'controproposte_finite';
    end if;
    v_contro := true;
  end if;

  -- Orario: da domani alle 10:00, tra 10:00 e 23:00 di Roma, sul passo di 30 minuti senza secondi, entro la scadenza.
  if p_orario is null then
    return 'orario_non_valido';
  end if;
  v_oggi := (now() at time zone 'Europe/Rome')::date;
  if p_orario < ((v_oggi + 1) + make_interval(hours => v_prima_ora)) at time zone 'Europe/Rome' then
    return 'prima_di_domani';
  end if;
  v_locale_roma := p_orario at time zone 'Europe/Rome';
  v_minuti := extract(hour from v_locale_roma)::integer * 60 + extract(minute from v_locale_roma)::integer;
  if v_minuti < v_prima_ora * 60 or v_minuti > v_ultima_ora * 60 then
    return 'fuori_orario';
  end if;
  if mod(v_minuti, v_passo) <> 0 or extract(second from v_locale_roma) <> 0 then
    return 'non_sul_passo';
  end if;
  if p_orario > v_i.scadenza then
    return 'dopo_la_scadenza';
  end if;
  -- Dove: uno solo tra locale consigliato e luogo scritto, al massimo 80 caratteri.
  if (v_locale is null) = (v_luogo is null) or char_length(coalesce(v_locale, v_luogo)) > 80 then
    return 'luogo_non_valido';
  end if;
  -- Passo 2t (D143 B): un locale consigliato solo se è tra quelli che chi propone può vedere.
  if v_locale is not null and not exists (select 1 from jsonb_array_elements(public.locali_per_persona(p_persona)) x
      where x->>'id' = v_locale) then
    return 'luogo_non_valido';
  end if;

  update public.incontri set stato = 'proposto', orario = p_orario, locale = v_locale, luogo_libero = v_luogo,
    proposto_da = p_persona, proposto_il = now(), controproposte = controproposte + (case when v_contro then 1 else 0 end)
    where porta_id = p_porta;
  return case when v_contro then 'controproposto' else 'proposto' end;
end $$;
