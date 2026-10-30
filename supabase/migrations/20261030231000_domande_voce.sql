-- Issue #2, passo 8 (tre risposte a voce): quali 3 domande ha scelto la persona, nell'ordine in cui le ha scelte.
-- Indici dell'elenco DOMANDE_VOCE di landing/app/moduli/domande.js (8 domande, da 0 a 7). La risposta alla prima
-- domanda scelta è il file voci/<id>/risposta-1, alla seconda risposta-2, alla terza risposta-3.
-- Serve per riprendere l'iscrizione dal punto lasciato e, con la #3, per far sentire agli altri della stanza
-- domanda e risposta insieme. Nessun dato nuovo sulla persona: solo numeri di domande.
create function public.senza_doppioni(valori smallint[]) returns boolean
  language sql immutable set search_path = '' as $$
  select cardinality(valori) = (select count(distinct x) from unnest(valori) x)
$$;

alter table public.profili
  add column domande_voce smallint[] check (
    domande_voce is null or (
      cardinality(domande_voce) <= 3
      and domande_voce <@ array[0, 1, 2, 3, 4, 5, 6, 7]::smallint[]
      and public.senza_doppioni(domande_voce)
    )
  );
