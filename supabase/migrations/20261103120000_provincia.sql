-- Fase 2 · issue #2 · specifica v1.3 del CPO (3/11, D84 A): al passo 5 la PROVINCIA sostituisce la città.
-- Primo passo: solo database. Il menu dell'app e la precompilazione dalla lista d'attesa arrivano nei passi dopo.
-- Regole che valgono anche se il telefono prova a forzarle (le controlla il server, non l'app):
--   · la provincia è una delle 107 della tabella o «EE» (Vivo all'estero); la regione la scrive il server;
--   · senza provincia non si va oltre il passo 5;
--   · una volta scelta si cambia al massimo una volta ogni 7 giorni e il cambio vale dal lunedì dopo
--     (la stanza in corso usa provincia_precedente);
--   · gli altri vedono il nome della provincia («Monza e Brianza») o «Dall'estero», mai la sigla né la regione.

-- Tabella fissa, generata da worker/province.js (stessi valori del sito; un test controlla che coincidano).
create table public.province (
  sigla text primary key check (sigla ~ '^[A-Z]{2}$'),
  nome text not null,
  regione text
);
insert into public.province (sigla, nome, regione) values
  ('AG', 'Agrigento', 'Sicilia'),
  ('AL', 'Alessandria', 'Piemonte'),
  ('AN', 'Ancona', 'Marche'),
  ('AO', 'Aosta', 'Valle d''Aosta'),
  ('AP', 'Ascoli Piceno', 'Marche'),
  ('AQ', 'L''Aquila', 'Abruzzo'),
  ('AR', 'Arezzo', 'Toscana'),
  ('AT', 'Asti', 'Piemonte'),
  ('AV', 'Avellino', 'Campania'),
  ('BA', 'Bari', 'Puglia'),
  ('BG', 'Bergamo', 'Lombardia'),
  ('BI', 'Biella', 'Piemonte'),
  ('BL', 'Belluno', 'Veneto'),
  ('BN', 'Benevento', 'Campania'),
  ('BO', 'Bologna', 'Emilia-Romagna'),
  ('BR', 'Brindisi', 'Puglia'),
  ('BS', 'Brescia', 'Lombardia'),
  ('BT', 'Barletta-Andria-Trani', 'Puglia'),
  ('BZ', 'Bolzano', 'Trentino-Alto Adige'),
  ('CA', 'Cagliari', 'Sardegna'),
  ('CB', 'Campobasso', 'Molise'),
  ('CE', 'Caserta', 'Campania'),
  ('CH', 'Chieti', 'Abruzzo'),
  ('CL', 'Caltanissetta', 'Sicilia'),
  ('CN', 'Cuneo', 'Piemonte'),
  ('CO', 'Como', 'Lombardia'),
  ('CR', 'Cremona', 'Lombardia'),
  ('CS', 'Cosenza', 'Calabria'),
  ('CT', 'Catania', 'Sicilia'),
  ('CZ', 'Catanzaro', 'Calabria'),
  ('EN', 'Enna', 'Sicilia'),
  ('FC', 'Forlì-Cesena', 'Emilia-Romagna'),
  ('FE', 'Ferrara', 'Emilia-Romagna'),
  ('FG', 'Foggia', 'Puglia'),
  ('FI', 'Firenze', 'Toscana'),
  ('FM', 'Fermo', 'Marche'),
  ('FR', 'Frosinone', 'Lazio'),
  ('GE', 'Genova', 'Liguria'),
  ('GO', 'Gorizia', 'Friuli-Venezia Giulia'),
  ('GR', 'Grosseto', 'Toscana'),
  ('IM', 'Imperia', 'Liguria'),
  ('IS', 'Isernia', 'Molise'),
  ('KR', 'Crotone', 'Calabria'),
  ('LC', 'Lecco', 'Lombardia'),
  ('LE', 'Lecce', 'Puglia'),
  ('LI', 'Livorno', 'Toscana'),
  ('LO', 'Lodi', 'Lombardia'),
  ('LT', 'Latina', 'Lazio'),
  ('LU', 'Lucca', 'Toscana'),
  ('MB', 'Monza e Brianza', 'Lombardia'),
  ('MC', 'Macerata', 'Marche'),
  ('ME', 'Messina', 'Sicilia'),
  ('MI', 'Milano', 'Lombardia'),
  ('MN', 'Mantova', 'Lombardia'),
  ('MO', 'Modena', 'Emilia-Romagna'),
  ('MS', 'Massa-Carrara', 'Toscana'),
  ('MT', 'Matera', 'Basilicata'),
  ('NA', 'Napoli', 'Campania'),
  ('NO', 'Novara', 'Piemonte'),
  ('NU', 'Nuoro', 'Sardegna'),
  ('OR', 'Oristano', 'Sardegna'),
  ('PA', 'Palermo', 'Sicilia'),
  ('PC', 'Piacenza', 'Emilia-Romagna'),
  ('PD', 'Padova', 'Veneto'),
  ('PE', 'Pescara', 'Abruzzo'),
  ('PG', 'Perugia', 'Umbria'),
  ('PI', 'Pisa', 'Toscana'),
  ('PN', 'Pordenone', 'Friuli-Venezia Giulia'),
  ('PO', 'Prato', 'Toscana'),
  ('PR', 'Parma', 'Emilia-Romagna'),
  ('PT', 'Pistoia', 'Toscana'),
  ('PU', 'Pesaro e Urbino', 'Marche'),
  ('PV', 'Pavia', 'Lombardia'),
  ('PZ', 'Potenza', 'Basilicata'),
  ('RA', 'Ravenna', 'Emilia-Romagna'),
  ('RC', 'Reggio Calabria', 'Calabria'),
  ('RE', 'Reggio Emilia', 'Emilia-Romagna'),
  ('RG', 'Ragusa', 'Sicilia'),
  ('RI', 'Rieti', 'Lazio'),
  ('RM', 'Roma', 'Lazio'),
  ('RN', 'Rimini', 'Emilia-Romagna'),
  ('RO', 'Rovigo', 'Veneto'),
  ('SA', 'Salerno', 'Campania'),
  ('SI', 'Siena', 'Toscana'),
  ('SO', 'Sondrio', 'Lombardia'),
  ('SP', 'La Spezia', 'Liguria'),
  ('SR', 'Siracusa', 'Sicilia'),
  ('SS', 'Sassari', 'Sardegna'),
  ('SU', 'Sud Sardegna', 'Sardegna'),
  ('SV', 'Savona', 'Liguria'),
  ('TA', 'Taranto', 'Puglia'),
  ('TE', 'Teramo', 'Abruzzo'),
  ('TN', 'Trento', 'Trentino-Alto Adige'),
  ('TO', 'Torino', 'Piemonte'),
  ('TP', 'Trapani', 'Sicilia'),
  ('TR', 'Terni', 'Umbria'),
  ('TS', 'Trieste', 'Friuli-Venezia Giulia'),
  ('TV', 'Treviso', 'Veneto'),
  ('UD', 'Udine', 'Friuli-Venezia Giulia'),
  ('VA', 'Varese', 'Lombardia'),
  ('VB', 'Verbano-Cusio-Ossola', 'Piemonte'),
  ('VC', 'Vercelli', 'Piemonte'),
  ('VE', 'Venezia', 'Veneto'),
  ('VI', 'Vicenza', 'Veneto'),
  ('VR', 'Verona', 'Veneto'),
  ('VT', 'Viterbo', 'Lazio'),
  ('VV', 'Vibo Valentia', 'Calabria'),
  ('EE', 'Vivo all''estero', null);
alter table public.province enable row level security;
revoke all on public.province from anon, authenticated;

alter table public.profili
  add column provincia text references public.province (sigla),
  add column regione text,
  add column provincia_origine text check (provincia_origine in ('lista', 'scelta')),
  add column provincia_cambiata_il timestamptz,
  add column provincia_precedente text references public.province (sigla),
  add column provincia_in_vigore_dal timestamptz;

-- security definer: legge la tabella delle province, che il telefono non può leggere direttamente.
create function public.controlla_provincia() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  vecchia text := case when tg_op = 'UPDATE' then old.provincia end;
  prossimo timestamptz;
begin
  if new.provincia is distinct from vecchia then
    if new.provincia is null then
      raise exception 'La provincia non si può togliere.' using errcode = 'check_violation';
    end if;
    if vecchia is not null and old.provincia_cambiata_il > now() - interval '7 days' then
      prossimo := old.provincia_cambiata_il + interval '7 days';
      raise exception 'Puoi cambiarla di nuovo dal %.', to_char(prossimo at time zone 'Europe/Rome', 'DD/MM')
        using errcode = 'check_violation';
    end if;
    -- La regione viene sempre dalla tabella, qualunque cosa mandi il telefono (criterio di accettazione).
    select p.regione into new.regione from public.province p where p.sigla = new.provincia;
    new.provincia_cambiata_il := now();
    new.provincia_precedente := vecchia;
    -- Prima scelta: vale subito. Cambio: vale dalla prossima apertura del lunedì, come il questionario.
    new.provincia_in_vigore_dal := case when vecchia is null then now() else public.prossima_apertura(now()) end;
    new.provincia_origine := coalesce(new.provincia_origine, 'scelta');
    -- «città» resta per le funzioni già scritte (#3): diventa il nome della provincia; per l'estero resta vuota.
    new.citta := case when new.provincia = 'EE' then null else (select p.nome from public.province p where p.sigla = new.provincia) end;
  elsif tg_op = 'UPDATE' then
    -- Campi calcolati dal server: il telefono non li cambia.
    new.regione := old.regione;
    new.provincia_origine := old.provincia_origine;
    new.provincia_cambiata_il := old.provincia_cambiata_il;
    new.provincia_precedente := old.provincia_precedente;
    new.provincia_in_vigore_dal := old.provincia_in_vigore_dal;
    if old.provincia is not null then new.citta := old.citta; end if;
  else
    new.regione := null; new.provincia_origine := null; new.provincia_cambiata_il := null;
    new.provincia_precedente := null; new.provincia_in_vigore_dal := null;
  end if;
  -- Senza provincia non si passa al passo 6 (anche chiamando direttamente il database).
  if new.provincia is null and new.passo > 5 and (tg_op = 'INSERT' or new.passo > old.passo) then
    raise exception 'Prima scegli la tua provincia.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.controlla_provincia() from public, anon, authenticated;
create trigger profili_controlla_provincia before insert or update on public.profili
  for each row execute function public.controlla_provincia();

-- Compagni di stanza: al posto della città, il nome della provincia o «Dall'estero». Mai sigla né regione.
create or replace function public.compagni_di_stanza()
  returns table (utente_id uuid, nome text, eta integer, citta text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, extract(year from age(current_date, p.data_nascita))::integer,
         case when p.provincia = 'EE' then 'Dall''estero' else coalesce(pr.nome, p.citta) end
  from public.membri_stanza io
  join public.stanze s on s.id = io.stanza_id and now() >= s.apre_il and now() < s.chiude_il
  join public.membri_stanza altri on altri.stanza_id = io.stanza_id and altri.utente_id <> io.utente_id
  join public.profili p on p.id = altri.utente_id
  left join public.province pr on pr.sigla = p.provincia
  where io.utente_id = auth.uid()
$$;
revoke all on function public.compagni_di_stanza() from public, anon;
grant execute on function public.compagni_di_stanza() to authenticated;
