-- Svelamento, passo 6c (issue #65, spec v1 del CPO, passi 5 e 6 e «Casi limite»; linea «sviluppatore»).
--   · entra_svelamento(porta, persona): chi ha confermato l'avviso nella sala d'attesa entra. Si entra solo nel
--     «momento» (due caparre e tutti e due pronti entro 5 minuti, oppure dentro la mezz'ora fissata) o se l'altra
--     persona è entrata da meno di 10 minuti (attesa massima della spec). Quando ci sono tutti e due lo svelamento
--     inizia: iniziato_il, un tentativo in più, tipo (foto se almeno uno ha scelto le foto, sennò video).
--     Risposte: in_attesa, iniziato_video, iniziato_foto, non_arrivato (aspettavi da 10 minuti: «Proponi un altro
--     momento»), non_ancora, manca_caparra, non_nella_porta, porta_chiusa, porta_scaduta, gia_iniziato.
--     Chi è dentro e richiede riceve lo stesso esito: così sa quando l'altra persona è arrivata, senza nuovi dati.
-- Si salvano solo i due orari d'ingresso (orari dello svelamento, spec «Regole»): nessun audio, video o immagine.
-- Il timer dei 10 secondi (parte quando arrivano i due video), la caduta con «Riprova» e la fine arrivano nei passi
-- successivi. Solo il server (ruolo di servizio), mai il telefono.
-- Valori uguali a api/svelamento.js (attesaMinuti 10): test/entra_svelamento_database.test.mjs li confronta.

alter table public.svelamenti
  add column entrato_a_il timestamptz,
  add column entrato_b_il timestamptz;

create function public.entra_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
  v_porta public.porte;
  v_s public.svelamenti;
  v_mio timestamptz;
  v_suo timestamptz;
  v_tipo text;
begin
  -- Svelamento già iniziato con me dentro: chi aspettava scopre che l'altra persona è arrivata.
  select s.* into v_s from public.svelamenti s join public.porte p on p.id = s.porta_id
    where s.porta_id = p_porta and p_persona in (p.a, p.b);
  if found and v_s.iniziato_il is not null and v_s.esito is null and v_s.finito_il is null
     and (select case when p.a = p_persona then v_s.entrato_a_il else v_s.entrato_b_il end
          from public.porte p where p.id = p_porta) >= v_s.iniziato_il - interval '10 minutes' then
    return 'iniziato_' || v_s.tipo;
  end if;

  v_errore := public.porta_aperta_per(p_porta, p_persona);
  if v_errore is not null then
    return v_errore;
  end if;
  select * into v_porta from public.porte where id = p_porta;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if v_s.caparra_a_il is null or v_s.caparra_b_il is null then
    return 'manca_caparra';
  end if;
  if p_persona = v_porta.a then
    v_mio := v_s.entrato_a_il; v_suo := v_s.entrato_b_il;
  else
    v_mio := v_s.entrato_b_il; v_suo := v_s.entrato_a_il;
  end if;
  -- Sono già dentro da meno di 10 minuti e l'altra persona no: aspetto, e i 10 minuti non ripartono.
  if v_mio is not null and now() - v_mio < interval '10 minutes'
     and (v_suo is null or now() - v_suo >= interval '10 minutes') then
    return 'in_attesa';
  end if;
  -- Si entra solo nel momento o con l'altra persona che aspetta da meno di 10 minuti.
  if not public.momento_svelamento(v_s) and (v_suo is null or now() - v_suo >= interval '10 minutes') then
    return case when v_mio is not null then 'non_arrivato' else 'non_ancora' end;
  end if;
  if p_persona = v_porta.a then
    update public.svelamenti set entrato_a_il = now() where porta_id = p_porta;
  else
    update public.svelamenti set entrato_b_il = now() where porta_id = p_porta;
  end if;
  if v_suo is null or now() - v_suo >= interval '10 minutes' then
    return 'in_attesa';
  end if;
  -- Ci sono tutti e due: lo svelamento inizia. «Preferisco le foto» di uno vale per entrambi.
  v_tipo := case when 'foto' in (v_s.scelta_a, v_s.scelta_b) then 'foto' else 'video' end;
  update public.svelamenti set iniziato_il = now(), tentativi = tentativi + 1, tipo = v_tipo where porta_id = p_porta;
  return 'iniziato_' || v_tipo;
end $$;

revoke all on function public.entra_svelamento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.entra_svelamento(uuid, uuid) to service_role;
