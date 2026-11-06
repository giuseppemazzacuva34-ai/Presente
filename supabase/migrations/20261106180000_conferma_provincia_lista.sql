-- Issue #2 v1.3: provincia precompilata dalla lista d'attesa e confermata senza cambi → origine «lista».
-- La chiama SOLO il Worker (worker/provincia_lista.js) con la chiave service_role, dopo aver ricontrollato nella lista
-- che la sigla sia quella dell'email confermata. Il telefono non la può chiamare (nessun permesso ad anon/authenticated).
-- Scrive solo la prima provincia (provincia ancora vuota): i cambi successivi passano dal profilo, con origine «scelta».
-- Le regole della provincia (regione dalla tabella, un cambio ogni 7 giorni) restano quelle di controlla_provincia().
create or replace function public.conferma_provincia_lista(utente uuid, sigla text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  fatto boolean;
begin
  perform set_config('presente.origine', 'lista', true);
  update public.profili set provincia = sigla where id = utente and provincia is null;
  fatto := found;
  perform set_config('presente.origine', '', true);
  return fatto;
end $$;
revoke all on function public.conferma_provincia_lista(uuid, text) from public, anon, authenticated;
grant execute on function public.conferma_provincia_lista(uuid, text) to service_role;
