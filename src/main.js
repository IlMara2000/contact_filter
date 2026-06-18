import "./styles.css";

const DATA_URL = "/data/contact_excel_index.json";
const SAVED_RECORDS_KEY = "cyborg-filter-saved-records-v1";
const state = {
  loaded: false,
  payload: null,
  baseRecords: [],
  savedRecords: [],
  importedRecords: [],
  importedFiles: [],
  lastSavedCount: 0,
  people: [],
  results: [],
  activeMode: "name"
};

let xlsxLoader = null;

const app = document.getElementById("app");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeCf(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  if (digits.startsWith("39") && digits.length >= 12) digits = digits.slice(2);
  return digits;
}

function splitValues(value) {
  return String(value || "")
    .split(/\s*(?:\/|\||;|,|\n)\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasActiveQuery(query) {
  return Boolean(
    normalizeText(`${query.nome} ${query.cognome}`) ||
    normalizeCf(query.cf) ||
    normalizePhone(query.numero) ||
    String(query.mail || "").trim()
  );
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nome: parts[0] || "", cognome: "" };
  return {
    nome: parts.slice(0, -1).join(" "),
    cognome: parts.slice(-1).join(" ")
  };
}

function personKey(record) {
  const cf = splitValues(record.cf).map(normalizeCf).find(Boolean);
  if (cf) return `cf:${cf}`;
  const name = normalizeText(record.prop);
  if (name) return `name:${name}`;
  const mail = splitValues(record.email).map(v => v.toLowerCase()).find(Boolean);
  if (mail) return `mail:${mail}`;
  const phone = splitValues(record.telefono).map(normalizePhone).find(Boolean);
  return phone ? `phone:${phone}` : `row:${record.sheet || ""}:${record.row || Math.random()}`;
}

function buildPeople(records) {
  const map = new Map();
  for (const record of records || []) {
    if (!record?.prop && !record?.cf && !record?.telefono && !record?.email) continue;
    const key = personKey(record);
    if (!map.has(key)) {
      const display = splitName(record.prop || "");
      map.set(key, {
        key,
        nominativo: record.prop || "",
        nome: display.nome,
        cognome: display.cognome,
        cfs: new Set(),
        phones: new Set(),
        emails: new Set(),
        addresses: new Set(),
        evidence: []
      });
    }
    const person = map.get(key);
    if (!person.nominativo && record.prop) {
      const display = splitName(record.prop);
      person.nominativo = record.prop;
      person.nome = display.nome;
      person.cognome = display.cognome;
    }
    splitValues(record.cf).map(normalizeCf).filter(Boolean).forEach(value => person.cfs.add(value));
    splitValues(record.telefono).map(normalizePhone).filter(Boolean).forEach(value => person.phones.add(value));
    splitValues(record.email).map(value => value.toLowerCase()).filter(Boolean).forEach(value => person.emails.add(value));
    if (record.ind) person.addresses.add(String(record.ind).trim());
    person.evidence.push(record);
  }
  return Array.from(map.values()).map(person => ({
    ...person,
    cfs: Array.from(person.cfs),
    phones: Array.from(person.phones),
    emails: Array.from(person.emails),
    addresses: Array.from(person.addresses)
  }));
}

function refreshPeople() {
  state.people = buildPeople([...state.baseRecords, ...state.savedRecords, ...state.importedRecords]);
}

function updateStatus() {
  const status = document.getElementById("status");
  if (!status) return;
  const baseCount = state.baseRecords.length;
  const savedCount = state.savedRecords.length;
  const importedCount = state.importedRecords.length;
  const parts = [
    `Indice caricato: ${baseCount} righe`,
    `${state.people.length} profili`
  ];
  if (savedCount) {
    parts.push(`lista locale: ${savedCount} righe salvate`);
  }
  if (importedCount) {
    parts.push(`file aggiunti: ${importedCount} righe da ${state.importedFiles.length} file`);
  }
  status.textContent = `${parts.join(", ")}.`;
}

function sanitizeRecord(record) {
  return {
    sheet: String(record.sheet || "file salvato"),
    row: Number(record.row || 0) || "",
    prop: String(record.prop || ""),
    cf: String(record.cf || ""),
    telefono: String(record.telefono || ""),
    email: String(record.email || ""),
    ind: String(record.ind || "")
  };
}

function recordSignature(record) {
  const name = normalizeText(record.prop);
  const cf = splitValues(record.cf).map(normalizeCf).filter(Boolean).join("/");
  const phones = splitValues(record.telefono).map(normalizePhone).filter(Boolean).join("/");
  const emails = splitValues(record.email).map(value => String(value || "").toLowerCase()).filter(Boolean).join("/");
  const address = normalizeText(record.ind);
  return [cf, name, phones, emails, address].filter(Boolean).join("|");
}

function loadSavedRecords() {
  try {
    const raw = window.localStorage?.getItem(SAVED_RECORDS_KEY);
    const records = raw ? JSON.parse(raw) : [];
    return Array.isArray(records) ? records.map(sanitizeRecord).filter(recordSignature) : [];
  } catch {
    return [];
  }
}

function persistSavedRecords() {
  try {
    window.localStorage?.setItem(SAVED_RECORDS_KEY, JSON.stringify(state.savedRecords));
    return true;
  } catch {
    return false;
  }
}

function saveNewRecords(records) {
  const seen = new Set([...state.baseRecords, ...state.savedRecords].map(recordSignature).filter(Boolean));
  const additions = [];
  for (const record of records) {
    const clean = sanitizeRecord(record);
    const signature = recordSignature(clean);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    additions.push(clean);
  }
  if (!additions.length) return 0;
  const previous = state.savedRecords;
  state.savedRecords = [...state.savedRecords, ...additions];
  if (!persistSavedRecords()) {
    state.savedRecords = previous;
    return 0;
  }
  return additions.length;
}

function queryFromForm() {
  const query = {
    nome: document.getElementById("nome")?.value || "",
    cognome: document.getElementById("cognome")?.value || "",
    cf: document.getElementById("cf")?.value || "",
    numero: document.getElementById("numero")?.value || "",
    mail: document.getElementById("mail")?.value || ""
  };
  if (state.activeMode === "name") return { ...query, cf: "", numero: "", mail: "" };
  if (state.activeMode === "number") {
    return { nome: "", cognome: "", cf: "", numero: query.numero, mail: "" };
  }
  return query;
}

function nameMatches(person, query) {
  const tokens = normalizeText(`${query.nome} ${query.cognome}`).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const evidenceText = (person.evidence || [])
    .map(record => [record.prop, record.ind, record.sheet].filter(Boolean).join(" "))
    .join(" ");
  const target = normalizeText([
    person.nominativo,
    person.nome,
    person.cognome,
    ...(person.addresses || []),
    evidenceText
  ].join(" "));
  return tokens.every(token => target.includes(token));
}

function cfMatches(person, query) {
  const cf = normalizeCf(query.cf);
  if (!cf) return false;
  return person.cfs.some(value => value.includes(cf));
}

function contactMatches(person, query) {
  const phone = normalizePhone(query.numero);
  const mail = String(query.mail || "").trim().toLowerCase();
  const phoneOk = phone && phone.length >= 3 && person.phones.some(value =>
    value === phone ||
    (phone.length >= 4 && value.includes(phone)) ||
    (value.length >= 4 && phone.includes(value))
  );
  const mailOk = mail && person.emails.some(value => value.includes(mail));
  return Boolean(phoneOk || mailOk);
}

function searchPeople(query, people = state.people) {
  const phases = [];
  if (normalizeText(`${query.nome} ${query.cognome}`)) phases.push({ label: "Nome e Cognome", test: person => nameMatches(person, query) });
  if (normalizeCf(query.cf)) phases.push({ label: "Codice Fiscale", test: person => cfMatches(person, query) });
  if (normalizePhone(query.numero) || String(query.mail || "").trim()) phases.push({ label: "Numero / Mail", test: person => contactMatches(person, query) });

  if (!phases.length) return [];

  const found = new Map();
  for (const phase of phases) {
    for (const person of people) {
      if (!phase.test(person)) continue;
      if (!found.has(person.key)) found.set(person.key, { person, phases: new Set() });
      found.get(person.key).phases.add(phase.label);
    }
  }

  return Array.from(found.values())
    .map(item => ({ ...item.person, phases: Array.from(item.phases) }))
    .sort((a, b) => b.phases.length - a.phases.length || String(a.nominativo).localeCompare(String(b.nominativo)));
}

const FIELD_ALIASES = {
  prop: ["PROP", "NOMINATIVO", "NOME COGNOME", "NOME_COMPLETO", "INTESTATARIO", "PROPRIETARIO", "OWNER", "PERSONA"],
  nome: ["NOME", "NAME", "FIRST NAME", "FIRST_NAME"],
  cognome: ["COGNOME", "SURNAME", "LAST NAME", "LAST_NAME"],
  cf: ["CF", "CODICE FISCALE", "CODICEFISCALE", "CODICE_FISCALE", "FISCAL CODE", "TAX CODE"],
  telefono: ["TELEFONO", "TEL", "NUMERO", "NUMERO TROVATO", "CELL", "CELLULARE", "PHONE", "MOBILE", "FISSO"],
  email: ["EMAIL", "E-MAIL", "MAIL", "MAIL TROVATA"],
  ind: ["IND", "INDIRIZZO", "INDIRIZZO D'ORIGINE", "INDIRIZZO ORIGINE", "ADDRESS", "VIA"]
};

function normalizedKey(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function pickField(row, aliases) {
  if (!row || typeof row !== "object") return "";
  const entries = Object.entries(row);
  const aliasSet = new Set(aliases.map(normalizedKey));
  const exact = entries.find(([key]) => aliasSet.has(normalizedKey(key)));
  if (exact) return exact[1];
  const fuzzy = entries.find(([key]) => {
    const norm = normalizedKey(key);
    return aliases.some(alias => norm.includes(normalizedKey(alias)));
  });
  return fuzzy ? fuzzy[1] : "";
}

function extractEmails(text) {
  return unique(String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

function extractCfs(text) {
  return unique(String(text || "").toUpperCase().match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/g) || []);
}

function extractPhones(text) {
  const raw = String(text || "").match(/(?:\+39\s*)?(?:3\d[\d\s./-]{7,}|0\d[\d\s./-]{5,})/g) || [];
  return unique(raw.map(normalizePhone).filter(value => value.length >= 7));
}

function parseTextLine(line, index = 0, source = "file") {
  const raw = String(line || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cfs = extractCfs(raw);
  const emails = extractEmails(raw);
  const phones = extractPhones(raw);
  let prop = raw
    .replace(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/gi, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
  phones.forEach(phone => {
    const spaced = phone.split("").join("[\\s./-]*");
    prop = prop.replace(new RegExp(spaced, "g"), " ");
  });
  prop = prop
    .split(/\s+-\s+|\s+F\s+\d+|\s+FOGLIO\s+\d+/i)[0]
    .replace(/\b(?:TEL|TELEFONO|CELL|CELLULARE|MAIL|EMAIL|CF)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!prop && !cfs.length && !phones.length && !emails.length) return null;
  return {
    sheet: source,
    row: index + 1,
    prop,
    cf: cfs.join(" / "),
    telefono: phones.join(" / "),
    email: emails.join(" / "),
    ind: raw
  };
}

function normalizeImportedRecord(row, index = 0, source = "file") {
  if (typeof row === "string") return parseTextLine(row, index, source);
  if (!row || typeof row !== "object") return null;

  const rowText = Object.values(row).join(" ");
  const nome = String(pickField(row, FIELD_ALIASES.nome) || "").trim();
  const cognome = String(pickField(row, FIELD_ALIASES.cognome) || "").trim();
  const prop = String(pickField(row, FIELD_ALIASES.prop) || [cognome, nome].filter(Boolean).join(" ") || "").trim();
  const cf = String(pickField(row, FIELD_ALIASES.cf) || extractCfs(rowText).join(" / ")).trim();
  const telefono = String(pickField(row, FIELD_ALIASES.telefono) || extractPhones(rowText).join(" / ")).trim();
  const email = String(pickField(row, FIELD_ALIASES.email) || extractEmails(rowText).join(" / ")).trim();
  const ind = String(pickField(row, FIELD_ALIASES.ind) || "").trim();

  if (!prop && !cf && !telefono && !email) return parseTextLine(rowText, index, source);
  return {
    sheet: source,
    row: index + 1,
    prop,
    cf,
    telefono,
    email,
    ind: ind || rowText
  };
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const sample = lines.slice(0, 5).join("\n");
  const delimiter = [";", "\t", ","].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  const rows = lines.map(line => {
    const cols = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cols.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cols.push(current.trim());
    return cols;
  });
  const headers = rows[0].map(header => header.trim());
  return rows.slice(1).map(cols => {
    const row = {};
    headers.forEach((header, index) => {
      row[header || `COL_${index + 1}`] = cols[index] || "";
    });
    return row;
  });
}

function collectJsonRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["records", "rows", "data", "items", "people", "contatti"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.snapshot?.datasets && typeof value.snapshot.datasets === "object") {
    return Object.values(value.snapshot.datasets).flatMap(dataset => Array.isArray(dataset) ? dataset : []);
  }
  return Object.values(value).flatMap(item => Array.isArray(item) ? item : []);
}

function loadXlsxParser() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (!xlsxLoader) {
    xlsxLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/xlsx.full.min.js";
      script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("Parser XLSX non disponibile."));
      script.onerror = () => reject(new Error("Parser XLSX non caricabile."));
      document.head.appendChild(script);
    });
  }
  return xlsxLoader;
}

async function parseUploadedFile(file) {
  const name = file.name || "file";
  const ext = name.split(".").pop().toLowerCase();
  let rows = [];
  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await loadXlsxParser();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    rows = workbook.SheetNames.flatMap(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
        .map((row, index) => ({ ...row, __sheet: sheetName, __row: index + 2 }));
    });
  } else {
    const text = await file.text();
    if (ext === "json") {
      rows = collectJsonRows(JSON.parse(text));
    } else if (ext === "csv") {
      rows = parseCsv(text);
    } else {
      rows = text.split(/\r?\n/).filter(line => line.trim());
    }
  }

  const records = rows
    .map((row, index) => normalizeImportedRecord(row, row.__row || index, row.__sheet || name))
    .filter(Boolean);
  return { name, records };
}

function renderUploadStatus() {
  const target = document.getElementById("uploadStatus");
  const clear = document.getElementById("clearUploads");
  const searchButtons = [document.getElementById("searchUploads")].filter(Boolean);
  const hasImports = state.importedRecords.length > 0;
  const hasFileData = hasImports || state.savedRecords.length > 0;
  if (!target || !clear) return;
  clear.disabled = !hasImports;
  searchButtons.forEach(button => { button.disabled = !hasFileData; });
  if (!state.importedFiles.length) {
    target.innerHTML = `<span>Nessun file caricato.</span>`;
    return;
  }
  target.innerHTML = `
    <strong>${state.importedFiles.length} file caricati</strong>
    <span>${state.importedRecords.length} righe analizzabili aggiunte all'indice.</span>
    <span>${state.lastSavedCount} nuove righe salvate nella lista locale.</span>
    <small>${state.importedFiles.map(file => `${escapeHtml(file.name)} (${file.count})`).join(" · ")}</small>
  `;
}

async function handleFileUpload(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const status = document.getElementById("uploadStatus");
  const button = document.getElementById("fileInputLabel");
  if (status) status.innerHTML = `<span>Analisi file in corso...</span>`;
  if (button) button.setAttribute("aria-busy", "true");
  try {
    const parsed = await Promise.all(files.map(parseUploadedFile));
    state.importedRecords = parsed.flatMap(item => item.records);
    state.importedFiles = parsed.map(item => ({ name: item.name, count: item.records.length }));
    state.lastSavedCount = saveNewRecords(state.importedRecords);
    refreshPeople();
    renderUploadStatus();
    updateStatus();
    const query = queryFromForm();
    if (hasActiveQuery(query)) renderResults(searchPeople(query));
  } catch (error) {
    if (status) status.innerHTML = `<span class="error">Errore file: ${escapeHtml(error.message)}</span>`;
  } finally {
    if (button) button.removeAttribute("aria-busy");
    input.value = "";
  }
}

function clearUploads() {
  state.importedRecords = [];
  state.importedFiles = [];
  state.lastSavedCount = 0;
  refreshPeople();
  renderUploadStatus();
  updateStatus();
  const query = queryFromForm();
  renderResults(hasActiveQuery(query) ? searchPeople(query) : []);
}

function runCurrentSearch() {
  renderResults(searchPeople(queryFromForm()));
}

function runUploadedFileSearch() {
  const records = state.importedRecords.length
    ? state.importedRecords
    : state.savedRecords;
  if (!records.length) return;
  renderResults(buildPeople(records).map(person => ({ ...person, phases: ["File caricato"] })));
}

function setActiveMode(mode) {
  state.activeMode = mode;
  document.querySelectorAll("[data-mode]").forEach(button => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  const searchPanel = document.getElementById("searchForm");
  const filePanel = document.getElementById("filePanel");
  if (searchPanel) searchPanel.hidden = mode === "file";
  if (filePanel) filePanel.hidden = mode !== "file";

  document.querySelectorAll("[data-field]").forEach(field => {
    const modes = String(field.dataset.field || "").split(/\s+/);
    field.hidden = !modes.includes(mode);
  });

  const panelTitle = document.getElementById("panelTitle");
  const searchButton = document.getElementById("runModeSearch");
  const titles = {
    name: "Ricerca per nome",
    number: "Ricerca per numero",
    generic: "Ricerca generica"
  };
  if (panelTitle) panelTitle.textContent = titles[mode] || "";
  if (searchButton) {
    searchButton.textContent = mode === "name"
      ? "CERCA NOMINATIVO"
      : mode === "number"
        ? "CERCA NUMERO"
        : "AVVIA RICERCA";
  }
  renderResults([]);
}

function rowFromPerson(person) {
  return {
    nome: person.nome || "",
    cognome: person.cognome || "",
    cf: person.cfs.join(" / "),
    numero: person.phones.join(" / "),
    mail: person.emails.join(" / "),
    indirizzo: person.addresses.join(" / ")
  };
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const rows = state.results.map(rowFromPerson);
  const header = ["NOME", "COGNOME", "CF", "NUMERO TROVATO", "MAIL TROVATA", "INDIRIZZO D'ORIGINE"];
  const csv = [header, ...rows.map(row => [row.nome, row.cognome, row.cf, row.numero, row.mail, row.indirizzo])]
    .map(cols => cols.map(csvEscape).join(";"))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cyborg_filter_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderResults(results) {
  const target = document.getElementById("results");
  state.results = results;
  if (!target) return;
  if (!results.length) {
    target.innerHTML = `<div class="empty">Nessun risultato da mostrare.</div>`;
    document.getElementById("downloadCsv").disabled = true;
    document.getElementById("count").textContent = "0";
    return;
  }

  document.getElementById("downloadCsv").disabled = false;
  document.getElementById("count").textContent = String(results.length);
  const maxVisible = 250;
  const rows = results.slice(0, maxVisible).map(rowFromPerson);
  const truncated = results.length > maxVisible;
  target.innerHTML = `
    <div class="result-head" aria-hidden="true">
      <span>NOME</span><span>COGNOME</span><span>CF</span><span>NUMERO</span><span>MAIL</span><span>INDIRIZZO</span>
    </div>
    <div class="result-list">
      ${rows.map(row => `
        <article class="result-row">
          <span data-label="Nome">${escapeHtml(row.nome)}</span>
          <span data-label="Cognome">${escapeHtml(row.cognome)}</span>
          <span data-label="CF">${escapeHtml(row.cf)}</span>
          <span data-label="Numero">${escapeHtml(row.numero)}</span>
          <span data-label="Mail">${escapeHtml(row.mail)}</span>
          <span data-label="Indirizzo">${escapeHtml(row.indirizzo)}</span>
        </article>
      `).join("")}
    </div>
    ${truncated ? `<div class="result-limit">Mostrati i primi ${maxVisible} risultati. Il CSV contiene tutti i ${results.length} risultati.</div>` : ""}
  `;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function bindEvents() {
  document.getElementById("searchForm").addEventListener("submit", event => {
    event.preventDefault();
    runCurrentSearch();
  });
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.addEventListener("click", () => setActiveMode(button.dataset.mode));
  });
  document.getElementById("clear").addEventListener("click", () => {
    document.getElementById("searchForm").reset();
    renderResults([]);
  });
  document.getElementById("downloadCsv").addEventListener("click", downloadCsv);
  document.getElementById("fileInput").addEventListener("change", handleFileUpload);
  document.getElementById("searchUploads").addEventListener("click", runUploadedFileSearch);
  document.getElementById("clearUploads").addEventListener("click", clearUploads);
}

function renderShell() {
  app.innerHTML = `
    <main class="shell">
      <section class="app-frame">
        <header class="app-header">
          <h1>CYBORG FILTER</h1>
          <p>Ricerca contatti rapida e verificata</p>
        </header>

        <nav class="mode-stack" aria-label="Modalita di ricerca">
          <button type="button" class="mode-button active" data-mode="name" aria-pressed="true">CERCA PER NOME</button>
          <button type="button" class="mode-button" data-mode="number" aria-pressed="false">CERCA PER NUMERO</button>
          <button type="button" class="mode-button" data-mode="generic" aria-pressed="false">RICERCA GENERICA</button>
          <button type="button" class="mode-button file-mode" data-mode="file" aria-pressed="false">INSERISCI FILE</button>
        </nav>

        <section class="workspace">
          <form id="searchForm" class="search-panel">
            <div class="panel-heading">
              <h2 id="panelTitle">Ricerca per nome</h2>
            </div>
            <div class="field-grid">
              <label data-field="name generic">Nome<input id="nome" autocomplete="off" placeholder="Mario"></label>
              <label data-field="name generic">Cognome<input id="cognome" autocomplete="off" placeholder="Rossi"></label>
              <label data-field="generic" hidden>Codice fiscale<input id="cf" autocomplete="off" placeholder="RSSMRA..."></label>
              <label data-field="number generic" hidden>Numero<input id="numero" autocomplete="off" inputmode="tel" placeholder="333..."></label>
              <label data-field="generic" hidden>Mail<input id="mail" autocomplete="off" inputmode="email" placeholder="nome@mail.it"></label>
            </div>
            <div class="search-actions">
              <button id="runModeSearch" type="submit" class="primary-action">CERCA NOMINATIVO</button>
              <button id="clear" type="button" class="secondary">PULISCI</button>
            </div>
          </form>

          <section id="filePanel" class="file-panel" hidden>
            <div class="panel-heading">
              <h2>Inserisci file</h2>
            </div>
            <div class="file-primary-actions">
              <label id="fileInputLabel" class="file-button" for="fileInput">UPLOAD</label>
              <input id="fileInput" type="file" multiple accept=".xlsx,.xls,.csv,.json,.txt,text/csv,application/json,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
              <button id="clearUploads" type="button" class="delete-button" disabled>DELETE</button>
            </div>
            <div id="uploadStatus" class="upload-status"><span>Nessun file caricato.</span></div>
            <div class="file-search-actions">
              <button id="searchUploads" type="button">CERCA</button>
            </div>
          </section>

          <div class="result-toolbar">
            <div>
              <strong><span id="count">0</span> risultati</strong>
              <div class="status" id="status">Caricamento indice...</div>
            </div>
            <button id="downloadCsv" type="button" class="secondary" disabled>DOWNLOAD CSV</button>
          </div>

          <div id="results" class="results"><div class="empty">Inserisci un dato e avvia la ricerca.</div></div>
        </section>
      </section>
    </main>
  `;
}

async function init() {
  renderShell();
  bindEvents();
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error("Indice contatti non leggibile.");
  state.payload = await response.json();
  state.baseRecords = state.payload.records || [];
  state.savedRecords = loadSavedRecords();
  refreshPeople();
  state.loaded = true;
  renderUploadStatus();
  updateStatus();
}

init().catch(error => {
  renderShell();
  document.getElementById("status").textContent = `Errore: ${error.message}`;
});
