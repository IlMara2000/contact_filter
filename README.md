# CYBORG Filter Webapp

Webapp separata dal popup dell'estensione. Usa il JSON indicizzato in `public/data/contact_excel_index.json` e mantiene il file sorgente in `public/data/Anagrafica_Consolidata_Deduplicata.xlsx`.

## Comandi

```bash
npm install
npm run dev
npm run build
```

Per Vercel basta collegare questa cartella come progetto: il deploy serve i dati statici e la ricerca gira lato browser.
