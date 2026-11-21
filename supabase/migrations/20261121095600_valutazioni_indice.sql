-- Fase 2 · issue #6 (D20 A) · passo 3d della linea «sviluppatore-b»: indice sulla chiave esterna «persona» delle
-- valutazioni, così la cancellazione dell'account (on delete cascade) non scorre tutta la tabella
-- (supabase-postgres-best-practices › schema-foreign-key-indexes). Solo un indice in più, nessun dato toccato.
create index valutazioni_persona on public.valutazioni (persona);
