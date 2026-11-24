-- Design v4 · «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, «Dati»). Linea «sviluppatore-b», passo 5.
-- Il testo libero del motivo «altro» si cancella 30 giorni dopo la chiusura della stanza; il codice del motivo resta,
-- senza testo, per il conteggio del riepilogo #8. Nessuna riga si cancella.
--   · La regola testo_solo_per_altro diventa «testo solo per altro» (prima: «altro sempre con testo»), così il testo
--     può sparire. Al momento dell'uscita il testo per «altro» resta obbligatorio: lo controllano lascia_stanza e il
--     Worker (uscitaValida).
--   · pulisci_testi_uscita() → quanti testi ha tolto. La chiama il Worker ogni ora (worker/uscite_pulizia.js, cron
--     già esistente), solo con la chiave del server.
-- Nessun dato si perde se non il testo che la spec chiede di cancellare.

alter table public.lasciate_stanza drop constraint testo_solo_per_altro;
alter table public.lasciate_stanza add constraint testo_solo_per_altro check (motivo = 'altro' or testo is null);

create function public.pulisci_testi_uscita() returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  tolti integer;
begin
  update public.lasciate_stanza l set testo = null
  from public.stanze s
  where s.id = l.stanza_id and l.testo is not null and s.chiude_il <= now() - interval '30 days';
  get diagnostics tolti = row_count;
  return tolti;
end $$;
revoke all on function public.pulisci_testi_uscita() from public, anon, authenticated;
grant execute on function public.pulisci_testi_uscita() to service_role;
