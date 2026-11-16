-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D32 A, D51 A) · passo 13a della linea «sviluppatore-b».
-- Il pannello di chi decide («Cosa vede chi decide»), parte del database:
--   · moderatori: chi può leggere e decidere le segnalazioni (in beta solo Giuseppe, D51 A). La riga la aggiunge a
--     mano chi gestisce il database (editor SQL di Supabase): l'app e il Worker non la scrivono mai.
--   · coda_moderazione(): le segnalazioni aperte, prima la priorità più alta e poi la scadenza, senza il racconto.
--   · scheda_segnalazione(): la segnalazione con il racconto e i fatti (chiamate tra i due, porte e svelamento,
--     storico di 6 mesi della persona segnalata). Ogni apertura resta nel registro (apri_segnalazione del passo 12a).
-- Mai i dati privati elencati nella spec (quaderno personale, risposte di compatibilità, giudizi dopo la chiamata,
-- immagini): le funzioni leggono solo le tabelle nominate qui sotto. Tutto SOLO per il server (ruolo di servizio).
-- Solo aggiunte: una tabella e tre funzioni nuove.

create table public.moderatori (
  persona uuid primary key,
  aggiunto_il timestamptz not null default now()
);
alter table public.moderatori enable row level security;
revoke all on public.moderatori from public, anon, authenticated, service_role;
grant select on public.moderatori to service_role;
-- Nessuna regola per authenticated: il telefono non sa chi è moderatore.

create function public.e_moderatore(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_persona is not null and exists (select 1 from public.moderatori where persona = p_persona)
$$;
revoke all on function public.e_moderatore(uuid) from public, anon, authenticated;
grant execute on function public.e_moderatore(uuid) to service_role;

-- Elenco delle aperte. «ore» = priorità (1, 24 o 72), «aperta» = qualcuno l'ha già aperta.
create function public.coda_moderazione(p_moderatore uuid)
  returns table (id uuid, motivo text, origine text, ore integer, creata_il timestamptz, scade_il timestamptz, aperta boolean,
                 nome_da text, nome_contro text, sospeso boolean, archiviate_di_chi_segnala integer)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, s.motivo, s.origine,
         round(extract(epoch from s.scade_il - s.creata_il) / 3600)::integer as ore,
         s.creata_il, s.scade_il, s.aperta_il is not null,
         pd.nome, pc.nome,
         s.contro is not null and exists (select 1 from public.sospensioni z where z.persona = s.contro and z.tolta_il is null),
         (select count(*)::integer from public.segnalazioni a where a.da = s.da and a.esito = 'archiviata')
  from public.segnalazioni s
  left join public.profili pd on pd.id = s.da
  left join public.profili pc on pc.id = s.contro
  where s.esito is null
  order by s.scade_il - s.creata_il, s.scade_il
  limit 200;
end $$;
revoke all on function public.coda_moderazione(uuid) from public, anon, authenticated;
grant execute on function public.coda_moderazione(uuid) to service_role;

-- La scheda di una segnalazione: { segnalazione, chiamate, porte, storico }. L'apertura va nel registro.
create function public.scheda_segnalazione(p_moderatore uuid, p_segnalazione uuid)
  returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.segnalazioni%rowtype;
  da6 timestamptz := now() - interval '6 months';
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.segnalazioni where id = p_segnalazione;
  if not found then raise exception 'Segnalazione inesistente.' using errcode = 'no_data_found'; end if;
  perform public.apri_segnalazione(p_moderatore, s.id);
  return jsonb_build_object(
    'segnalazione', jsonb_build_object(
      'id', s.id, 'motivo', s.motivo, 'origine', s.origine, 'testo', s.testo, 'creata_il', s.creata_il,
      'scade_il', s.scade_il, 'esito', s.esito, 'da', s.da, 'contro', s.contro,
      'nome_da', (select nome from public.profili where id = s.da),
      'nome_contro', (select nome from public.profili where id = s.contro)),
    -- Chiamate tra i due negli ultimi 6 mesi: quando, chi ha chiamato, durata in secondi, come è finita.
    'chiamate', coalesce((
      select jsonb_agg(jsonb_build_object('inizio', c.inizio, 'chiamava', case when c.chi = s.da then 'da' else 'contro' end,
                                          'durata', c.durata, 'esito', c.esito) order by c.inizio desc)
      from public.chiamate c
      where s.contro is not null and c.inizio >= da6
        and ((c.chi = s.da and c.con = s.contro) or (c.chi = s.contro and c.con = s.da))), '[]'::jsonb),
    -- Porte tra i due e il loro svelamento: solo orari ed esiti.
    'porte', coalesce((
      select jsonb_agg(jsonb_build_object('aperta_il', p.aperta_il, 'svelamento_iniziato_il', v.iniziato_il,
                                          'svelamento_finito_il', v.finito_il, 'esito', v.esito, 'esito_il', v.esito_il)
                       order by p.aperta_il desc)
      from public.porte p left join public.svelamenti v on v.porta_id = p.id
      where s.contro is not null and p.a = least(s.da, s.contro) and p.b = greatest(s.da, s.contro)), '[]'::jsonb),
    -- Storico della persona segnalata negli ultimi 6 mesi: segnalazioni ricevute e sanzioni.
    'storico', jsonb_build_object(
      'segnalazioni', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'motivo', x.motivo, 'creata_il', x.creata_il, 'esito', x.esito)
                         order by x.creata_il desc)
        from public.segnalazioni x where s.contro is not null and x.contro = s.contro and x.creata_il >= da6), '[]'::jsonb),
      'sanzioni', coalesce((
        select jsonb_agg(jsonb_build_object('livello', z.livello, 'regola', z.regola, 'decisa_il', z.decisa_il, 'fine_il', z.fine_il)
                         order by z.decisa_il desc)
        from public.sanzioni z where s.contro is not null and z.persona = s.contro and z.decisa_il >= da6), '[]'::jsonb)));
end $$;
revoke all on function public.scheda_segnalazione(uuid, uuid) from public, anon, authenticated;
grant execute on function public.scheda_segnalazione(uuid, uuid) to service_role;
