-- Issue #7, spec v1.2 del CPO (20/11), punto 2 · linea «sviluppatore-b», passo 15b.
-- La scheda del pannello mostra la frase della chiave solo dentro una porta tra chi segnala e chi è segnalato
-- (segnalazione fatta dopo l'apertura della porta) e solo per i motivi che possono riguardare la frase: contatti prima
-- della porta, insulti, contenuti sessuali, minacce/pericolo, soldi o vendite. In tutti gli altri casi resta vuota.
-- Solo «create or replace» della stessa funzione (stessa firma e stessi permessi): nient'altro cambia.

create or replace function public.scheda_segnalazione(p_moderatore uuid, p_segnalazione uuid)
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
      'nome_contro', (select nome from public.profili where id = s.contro),
      -- Spec #7 v1.2, punto 2: la frase che la persona segnalata ha lasciato con la chiave, solo se la segnalazione
      -- è collegata a una porta tra i due (fatta dopo la sua apertura, la più recente) e il motivo riguarda la frase.
      'frase_chiave', (
        select case when p.a = s.contro then p.frase_di_a else p.frase_di_b end
        from public.porte p
        where s.contro is not null
          and s.motivo in ('contatti_prima_porta', 'insulti', 'contenuti_sessuali', 'minacce_pericolo', 'soldi')
          and p.a = least(s.da, s.contro) and p.b = greatest(s.da, s.contro) and p.aperta_il <= s.creata_il
        order by p.aperta_il desc limit 1)),
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
