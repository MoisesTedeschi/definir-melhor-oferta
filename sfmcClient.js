/**
 * sfmcClient.js
 *
 * Autenticação OAuth (client_credentials) com o Marketing Cloud e helpers
 * para consultar Data Extensions via REST API — equivalente ao Lookup()/
 * LookupRows() que usaríamos em AMPscript, mas chamado a partir do backend
 * da Custom Activity.
 *
 * Referência: mesmo fluxo de auth do triggered-send-setup.md (Installed
 * Package > API Integration > Server-to-Server).
 */

const axios = require('axios');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const authUrl = `https://${process.env.MC_SUBDOMAIN}.auth.marketingcloudapis.com/v2/token`;

  const { data } = await axios.post(authUrl, {
    grant_type: 'client_credentials',
    client_id: process.env.MC_CLIENT_ID,
    client_secret: process.env.MC_CLIENT_SECRET,
    account_id: process.env.MC_ACCOUNT_ID
  });

  cachedToken = data.access_token;
  // Renova com folga de 60s antes de expirar (token dura ~18min)
  tokenExpiresAt = now + (data.expires_in - 60) * 1000;

  return cachedToken;
}

/**
 * Busca 1 registro em uma Data Extension filtrando por um campo.
 * Equivalente a Lookup("DE", "Campo", "FiltroCampo", valor) em AMPscript.
 *
 * Usa a Data Extension REST API (rowset), filtrando client-side.
 * Para volumes grandes, prefira SOAP Retrieve com filtro nativo no lugar
 * deste helper — REST rowset não pagina filtro complexo com eficiência.
 */
async function lookupRow(externalKey, filterField, filterValue) {
  const rows = await lookupRows(externalKey, filterField, filterValue);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Busca N registros em uma Data Extension filtrando por um campo.
 * Equivalente a LookupRows() em AMPscript.
 */
async function lookupRows(externalKey, filterField, filterValue) {
  const token = await getAccessToken();

  const url = `https://${process.env.MC_SUBDOMAIN}.rest.marketingcloudapis.com/data/v1/customobjectdata/key/${externalKey}/rowset`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const items = (data.items || []).map(item => item.values || item);

  if (!filterField) return items;

  return items.filter(
    row => String(row[filterField]).toLowerCase() === String(filterValue).toLowerCase()
  );
}

/**
 * Insere um registro de log (usado para popular DE_Log_Oferta_Enviada
 * depois de cada envio, alimentando a supressão de 30 dias da Automation).
 */
async function insertRow(externalKey, values) {
  const token = await getAccessToken();

  const url = `https://${process.env.MC_SUBDOMAIN}.rest.marketingcloudapis.com/data/v1/async/dataextensions/key:${externalKey}/rows`;

  await axios.post(
    url,
    { items: [values] },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

module.exports = { lookupRow, lookupRows, insertRow, getAccessToken };
