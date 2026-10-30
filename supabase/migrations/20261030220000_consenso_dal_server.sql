-- Requisito 3 del CISO (T15, 29/10) prima di ACCESSO_APP=si: la data del consenso a «cerco» la scrive il server,
-- non il telefono. Così nessuno può retrodatare o inventare un consenso mandando una data a mano.
-- - Quando «cerco» viene scelto o cambiato: consenso_cerco_il = adesso (ora del database).
-- - Quando «cerco» non cambia: resta la data già registrata, qualunque valore arrivi dal telefono.
-- - Quando «cerco» torna vuoto (consenso ritirato): anche la data si svuota.
create function public.consenso_cerco_dal_server() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.cerco is null then
    new.consenso_cerco_il := null;
  elsif tg_op = 'INSERT' or new.cerco is distinct from old.cerco then
    new.consenso_cerco_il := now();
  else
    new.consenso_cerco_il := old.consenso_cerco_il;
  end if;
  return new;
end $$;

create trigger filtri_consenso_dal_server
  before insert or update on public.filtri
  for each row execute function public.consenso_cerco_dal_server();
