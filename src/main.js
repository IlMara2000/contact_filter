import "./styles.css";

const DATA_URL = "/data/contact_excel_index.json";
const state = {
  loaded: false,
  payload: null,
  people: [],
  results: []
};

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

function queryFromForm() {
  return {
    nome: document.getElementById("nome")?.value || "",
    cognome: document.getElementById("cognome")?.value || "",
    cf: document.getElementById("cf")?.value || "",
    numero: document.getElementById("numero")?.value || "",
    mail: document.getElementById("mail")?.value || ""
  };
}

function nameMatches(person, query) {
  const tokens = normalizeText(`${query.nome} ${query.cognome}`).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const target = normalizeText([person.nominativo, person.nome, person.cognome].join(" "));
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
  const phoneOk = phone && person.phones.some(value => value === phone);
  const mailOk = mail && person.emails.some(value => value.includes(mail));
  return Boolean(phoneOk || mailOk);
}

function searchPeople(query) {
  const phases = [];
  if (normalizeText(`${query.nome} ${query.cognome}`)) phases.push({ label: "Nome e Cognome", test: person => nameMatches(person, query) });
  if (normalizeCf(query.cf)) phases.push({ label: "Codice Fiscale", test: person => cfMatches(person, query) });
  if (normalizePhone(query.numero) || String(query.mail || "").trim()) phases.push({ label: "Numero / Mail", test: person => contactMatches(person, query) });

  if (!phases.length) return [];

  const found = new Map();
  for (const phase of phases) {
    for (const person of state.people) {
      if (!phase.test(person)) continue;
      if (!found.has(person.key)) found.set(person.key, { person, phases: new Set() });
      found.get(person.key).phases.add(phase.label);
    }
  }

  return Array.from(found.values())
    .map(item => ({ ...item.person, phases: Array.from(item.phases) }))
    .sort((a, b) => b.phases.length - a.phases.length || String(a.nominativo).localeCompare(String(b.nominativo)));
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
    target.innerHTML = `<div class="empty">Nessun risultato trovato con i tre canali impostati.</div>`;
    document.getElementById("downloadCsv").disabled = true;
    document.getElementById("count").textContent = "0";
    return;
  }

  document.getElementById("downloadCsv").disabled = false;
  document.getElementById("count").textContent = String(results.length);
  const rows = results.map(rowFromPerson);
  target.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>NOME</th>
          <th>COGNOME</th>
          <th>CF</th>
          <th>NUMERO TROVATO</th>
          <th>MAIL TROVATA</th>
          <th>INDIRIZZO D'ORIGINE</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHtml(row.nome)}</td>
            <td>${escapeHtml(row.cognome)}</td>
            <td>${escapeHtml(row.cf)}</td>
            <td>${escapeHtml(row.numero)}</td>
            <td>${escapeHtml(row.mail)}</td>
            <td>${escapeHtml(row.indirizzo)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function bindEvents() {
  document.getElementById("searchForm").addEventListener("submit", event => {
    event.preventDefault();
    renderResults(searchPeople(queryFromForm()));
  });
  document.getElementById("clear").addEventListener("click", () => {
    document.getElementById("searchForm").reset();
    renderResults([]);
  });
  document.getElementById("downloadCsv").addEventListener("click", downloadCsv);
}

function renderShell() {
  app.innerHTML = `
    <main class="shell">
      <section class="panel">
        <header class="topbar">
          <div>
            <h1>CYBORG Filter</h1>
            <p>Ricerca contatti su JSON indicizzato: Nome e Cognome, Codice Fiscale, Numero / Mail.</p>
          </div>
          <div class="metric"><span id="count">0</span><small>risultati</small></div>
        </header>
        <form id="searchForm" class="grid">
          <label>Nome<input id="nome" autocomplete="off" placeholder="Mario"></label>
          <label>Cognome<input id="cognome" autocomplete="off" placeholder="Rossi"></label>
          <label>Codice fiscale<input id="cf" autocomplete="off" placeholder="RSSMRA..."></label>
          <label>Numero<input id="numero" autocomplete="off" inputmode="tel" placeholder="333..."></label>
          <label>Mail<input id="mail" autocomplete="off" inputmode="email" placeholder="nome@mail.it"></label>
          <div class="actions">
            <button type="submit">Cerca</button>
            <button id="clear" type="button" class="secondary">Pulisci</button>
            <button id="downloadCsv" type="button" class="secondary" disabled>Download CSV</button>
          </div>
        </form>
        <div class="status" id="status">Caricamento indice...</div>
        <div id="results" class="results"><div class="empty">Inserisci almeno un dato e premi Cerca.</div></div>
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
  state.people = buildPeople(state.payload.records || []);
  state.loaded = true;
  document.getElementById("status").textContent = `Indice caricato: ${state.payload.records?.length || 0} righe, ${state.people.length} profili.`;
}

init().catch(error => {
  renderShell();
  document.getElementById("status").textContent = `Errore: ${error.message}`;
});
