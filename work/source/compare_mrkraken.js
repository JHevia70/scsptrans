// compare_mrkraken.js — Compara components_generated.ini con los ficheros de MrKraken
// Uso: node compare_mrkraken.js
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const BASE           = path.dirname(__filename);
const COMPONENTS_INI = path.join(BASE, 'components_generated.ini');
const OUT_TSV        = path.join(BASE, 'compare_mrkraken.tsv');

const MRKRAKEN_URLS = [
  'https://raw.githubusercontent.com/MrKraken/StarStrings/master/components.ini',
  'https://raw.githubusercontent.com/MrKraken/StarStrings/master/mining.ini',
  'https://raw.githubusercontent.com/MrKraken/StarStrings/master/ordnance.ini',
];

// ── Utilidades ────────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Parsea un ini (texto) en un mapa clave_lower → {key, value}
function parseIni(text) {
  const map = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.substring(0, eq).trim();
    const val = line.substring(eq + 1).trim();
    if (key) map[key.toLowerCase()] = { key, value: val };
  }
  return map;
}

// Extrae el sufijo de nombre (quita item_name_ o item_name)
function suffix(keyLower) {
  if (keyLower.startsWith('item_name_')) return keyLower.substring(10);
  if (keyLower.startsWith('item_name'))  return keyLower.substring(9);
  return null;
}

// Normaliza el prefijo de clase al formato 2 letras: Mil/Civ/Ind/Cmp/Sth → Mi/Ci/In/Co/St
const PREFIX_NORM = { 'Mil': 'Mi', 'Civ': 'Ci', 'Ind': 'In', 'Cmp': 'Co', 'Sth': 'St' };
function normalizeValue(val) {
  return val.replace(/^(Mil|Civ|Ind|Cmp|Sth)\//, m => (PREFIX_NORM[m.slice(0, -1)] || m.slice(0, -1)) + '/');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Cargar nuestro components_generated.ini
  console.log('Cargando components_generated.ini...');
  const oursMap = parseIni(fs.readFileSync(COMPONENTS_INI, 'utf8'));
  console.log('  entradas:', Object.keys(oursMap).length);

  // Construir mapa sufijo → {key, value} para lookup rápido
  const oursBySuffix = {};
  for (const [kl, entry] of Object.entries(oursMap)) {
    const s = suffix(kl);
    if (s) oursBySuffix[s] = entry;
  }

  // Cargar ficheros MrKraken
  console.log('Descargando ficheros MrKraken...');
  const mkMap = {};
  for (const url of MRKRAKEN_URLS) {
    const text = await fetchUrl(url);
    Object.assign(mkMap, parseIni(text));
    console.log('  ' + url.split('/').pop() + ':', Object.keys(parseIni(text)).length, 'entradas');
  }
  console.log('  total MrKraken:', Object.keys(mkMap).length);

  const mkBySuffix = {};
  for (const [kl, entry] of Object.entries(mkMap)) {
    const s = suffix(kl);
    if (s) mkBySuffix[s] = entry;
  }

  // ── Cruce ─────────────────────────────────────────────────────────────────
  const allSuffixes = new Set([...Object.keys(oursBySuffix), ...Object.keys(mkBySuffix)]);

  let same = 0, sameNorm = 0, diff = 0, onlyOurs = 0, onlyMk = 0;
  const rows = [['sufijo', 'clave_ours', 'nombre_ours', 'clave_mk', 'nombre_mk', 'estado']];

  for (const s of [...allSuffixes].sort()) {
    const ours = oursBySuffix[s];
    const mk   = mkBySuffix[s];

    if (ours && mk) {
      if (ours.value === mk.value) {
        same++;
        // No incluir en TSV los que coinciden exactamente
      } else if (normalizeValue(ours.value) === normalizeValue(mk.value)) {
        sameNorm++;
        // Solo difieren en prefijo largo vs corto (Mil→Mi etc.), no incluir en TSV
      } else {
        diff++;
        rows.push([s, ours.key, ours.value, mk.key, mk.value, 'DIFERENTE']);
      }
    } else if (ours && !mk) {
      onlyOurs++;
      rows.push([s, ours.key, ours.value, '', '', 'SOLO_NUESTRO']);
    } else {
      onlyMk++;
      rows.push([s, '', '', mk.key, mk.value, 'SOLO_MRKRAKEN']);
    }
  }

  console.log('\nResultado:');
  console.log('  Coinciden exactamente:    ', same);
  console.log('  Solo prefijo diferente:   ', sameNorm, '(Mil/Civ/etc. vs Mi/Ci/etc.)');
  console.log('  Contenido diferente:      ', diff);
  console.log('  (solo estos se muestran abajo y en el TSV)');
  console.log('  Solo en los nuestros: ', onlyOurs);
  console.log('  Solo en MrKraken:     ', onlyMk);
  console.log('  Total en TSV:         ', rows.length - 1, '(sin los que coinciden)');

  // Detalle de los diferentes
  if (diff > 0) {
    console.log('\nNombres diferentes:');
    rows.filter(r => r[5] === 'DIFERENTE').forEach(r =>
      console.log('  ' + r[0].padEnd(40), 'OURS:', r[2].padEnd(30), 'MK:', r[4])
    );
  }

  // Escribir TSV
  const tsv = rows.map(r => r.join('\t')).join('\n');
  fs.writeFileSync(OUT_TSV, tsv, 'utf8');
  console.log('\nTSV:', OUT_TSV);
}

main().catch(console.error);
