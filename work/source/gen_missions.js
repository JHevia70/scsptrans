// gen_missions.js — Genera missions.tsv (para traducir) y missions_data.json (datos enriquecidos)
// Uso: node gen_missions.js
'use strict';

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const BASE            = path.dirname(__filename);
const BROKER_DIR      = path.join(BASE, 'dcb_mgiver/libs/foundry/records/missionbroker');
const CONTRACT_DIR    = path.join(BASE, 'dcb_mgiver/libs/foundry/records/contracts');
const BP_DIR          = path.join(BASE, 'dcb_mgiver/libs/foundry/records/crafting/blueprintrewards');
const BP_REC_DIR      = path.join(BASE, 'dcb_mgiver/libs/foundry/records/crafting/blueprints');
const REP_DIR         = path.join(BASE, 'dcb_mgiver/libs/foundry/records/reputation/rewards/missionrewards_reputation');
const COMPONENTS_INI  = path.join(BASE, 'components_generated.ini');
const GLOBAL_INI      = path.join(BASE, 'p4k_extract/Data/Localization/english/global.ini');
const OUT_TSV         = path.join(BASE, '..', 'missions.tsv');
const OUT_JSON        = path.join(BASE, '..', 'missions_data.json');

// ── Utilidades ────────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).isDirectory()) out.push(...walk(full));
      else if (f.endsWith('.json')) out.push(full);
    } catch {}
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function refToName(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = ref.match(/\/([^/]+)\.json$/);
  return m ? m[1].toLowerCase() : null;
}

// Recorrer objeto buscando un campo concreto, devuelve todos los valores encontrados
function collectField(obj, fieldName, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) { obj.forEach(v => collectField(v, fieldName, results)); return results; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === fieldName) results.push(v);
    else collectField(v, fieldName, results);
  }
  return results;
}

// ── Cargar global.ini ─────────────────────────────────────────────────────────

async function loadIni(file) {
  const map = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    map[line.substring(0, eq).trim()] = line.substring(eq + 1);
  }
  return map;
}

// ── Cargar nombres de blueprints: bp-file → entityClass name ─────────────────

function loadBlueprintNames() {
  const map = {};
  for (const f of walk(BP_REC_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const entityRef = d._RecordValue_?.blueprint?.processSpecificData?.entityClass;
    if (!entityRef) continue;
    map[path.basename(f, '.json').toLowerCase()] = refToName(entityRef);
  }
  return map;
}

// ── Cargar pools: poolFileName → [entityClass, ...] ──────────────────────────

function loadBlueprintPools(bpNameMap) {
  const pools = {};
  for (const f of walk(BP_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const rewards = d._RecordValue_?.blueprintRewards;
    if (!rewards?.length) continue;
    const key = path.basename(f, '.json').toLowerCase();
    pools[key] = [...new Set(
      rewards.map(r => bpNameMap[refToName(r.blueprintRecord)]).filter(Boolean)
    )];
  }
  return pools;
}

// ── Construir mapa titleKey → [poolFileName, ...] desde ContractGenerator ─────

function buildTitleToBpPools() {
  // titleKey (sin @) → Set de pool file names
  const map = {};

  for (const f of walk(CONTRACT_DIR)) {
    const d = readJson(f);
    if (!d) continue;

    // Recoger todos los blueprintPool refs del documento
    const poolRefs = collectField(d, 'blueprintPool');
    if (!poolRefs.length) continue;
    const poolNames = [...new Set(poolRefs.map(r => refToName(r)).filter(Boolean))];

    // Recoger todos los stringParamOverrides con valores @... para obtener títulos
    const stringOverrides = collectField(d, 'stringParamOverrides');
    const titleKeys = new Set();
    for (const arr of stringOverrides) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const v = item?.value;
        if (typeof v === 'string' && v.startsWith('@') && !v.includes('LOC_UNINITIALIZED')) {
          titleKeys.add(v.replace(/^@/, ''));
        }
      }
    }

    for (const titleKey of titleKeys) {
      if (!map[titleKey]) map[titleKey] = new Set();
      for (const p of poolNames) map[titleKey].add(p);
    }
  }

  return map;
}

// ── Cargar mapa filename → reputationAmount ───────────────────────────────────

function loadReputationAmounts() {
  const map = {};
  for (const f of walk(REP_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const amount = d._RecordValue_?.reputationAmount;
    if (amount != null) map[path.basename(f, '.json').toLowerCase()] = amount;
  }
  return map;
}

// Extrae la reputación al completar con éxito (missionResultReputationRewards[0]).
// Prefiere el scope affinity; si no, usa el mayor valor positivo del resultado 0.
function extractRep(v, repAmounts) {
  const results = v.missionResultReputationRewards;
  if (!results?.length) return 0;
  const onSuccess = results[0]?.reputationAmounts;
  if (!onSuccess?.length) return 0;

  // Buscar entry con scope affinity
  const affinityEntry = onSuccess.find(e =>
    typeof e.reputationScope === 'string' && e.reputationScope.includes('affinity')
  );
  const target = affinityEntry || onSuccess[0];
  const rewardFile = refToName(target?.reward);
  if (!rewardFile) return 0;
  return repAmounts[rewardFile] ?? 0;
}

// ── Cargar components_generated.ini: sufijo_lower → nombre con prefijo ────────
// Permite que los BPs de nave muestren el nombre enriquecido (e.g. "Mi/1/A VK-00")

function loadComponentsMap() {
  const map = {};
  if (!fs.existsSync(COMPONENTS_INI)) return map;
  for (const line of fs.readFileSync(COMPONENTS_INI, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.substring(0, eq).trim();
    const val = line.substring(eq + 1).trim();
    if (!key || !val) continue;
    const kl = key.toLowerCase();
    if (kl.startsWith('item_name_')) map[kl.substring(10)] = val;
    else if (kl.startsWith('item_name')) map[kl.substring(9)]  = val;
  }
  return map;
}

// ── Construir nameMap case-insensitive desde global.ini ───────────────────────
// Clave: sufijo en minúsculas → {value, key original}
// Esto permite resolver entityClass independientemente de si es upper/mixed/lower

function buildNameMap(ini) {
  const map = {};  // sufijo_lower → nombre
  for (const [k, v] of Object.entries(ini)) {
    const kl = k.toLowerCase();
    if (kl.startsWith('item_name_')) {
      const suffix = kl.substring(10);  // quitar 'item_name_'
      if (!map[suffix]) map[suffix] = v;
    } else if (kl.startsWith('item_name')) {
      const suffix = kl.substring(9);   // quitar 'item_name'
      if (!map[suffix]) map[suffix] = v;
    }
  }
  return map;
}

// ── Resolver nombre de item ───────────────────────────────────────────────────
// Prioridad: componentsMap (nombre con prefijo Mi/Ci/…) > nameMap (global.ini) > entityClass

function resolveItemName(entityClass, nameMap, componentsMap) {
  const ecl = entityClass.toLowerCase();
  const noSCItem = ecl.endsWith('_scitem') ? ecl.slice(0, -7) : ecl;
  return componentsMap[ecl] || componentsMap[noSCItem]
      || nameMap[ecl]       || nameMap[noSCItem]
      || entityClass;
}

// ── Cargar misiones desde MissionBrokerEntry ──────────────────────────────────

function loadMissions(titleToBpPools, bpPools, repAmounts, ini, nameMap, componentsMap) {
  const missions = new Map(); // titleKey → entrada

  for (const f of walk(BROKER_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const v = d._RecordValue_;
    if (!v || v.notForRelease) continue;

    const titleKey = v.title ? v.title.replace(/^@/, '') : null;
    const descKey  = v.description ? v.description.replace(/^@/, '') : null;
    if (!titleKey || titleKey === 'LOC_UNINITIALIZED') continue;

    const titleText = ini[titleKey] || '';
    if (!titleText) continue;

    const descText = descKey ? (ini[descKey] || '') : '';
    const uec = v.missionReward?.reward || 0;
    const rep = extractRep(v, repAmounts);

    // BPs: buscar en el mapa titleKey → pools
    const poolNames = titleToBpPools[titleKey] || new Set();
    if (descKey && titleToBpPools[descKey]) {
      for (const p of titleToBpPools[descKey]) poolNames.add(p);
    }
    const bps = [...new Set(
      [...poolNames].flatMap(p => (bpPools[p] || []).map(e => resolveItemName(e, nameMap, componentsMap)))
    )];

    if (!missions.has(titleKey)) {
      missions.set(titleKey, { titleKey, titleText, descKey: descKey || '', descText, uec, rep, bps });
    } else {
      const ex = missions.get(titleKey);
      for (const bp of bps) if (!ex.bps.includes(bp)) ex.bps.push(bp);
      if (uec > ex.uec) ex.uec = uec;
      if (rep > ex.rep) ex.rep = rep;
    }
  }

  return [...missions.values()].sort((a, b) => a.titleKey.localeCompare(b.titleKey));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Cargando global.ini...');
  const ini = await loadIni(GLOBAL_INI);
  console.log('  keys:', Object.keys(ini).length);

  console.log('Cargando blueprints...');
  const bpNameMap = loadBlueprintNames();
  console.log('  blueprints individuales:', Object.keys(bpNameMap).length);

  console.log('Cargando pools de BPs...');
  const bpPools = loadBlueprintPools(bpNameMap);
  console.log('  pools:', Object.keys(bpPools).length);

  console.log('Construyendo mapa título → pools...');
  const titleToBpPools = buildTitleToBpPools();
  console.log('  títulos con BPs:', Object.keys(titleToBpPools).length);

  console.log('Cargando valores de reputación...');
  const repAmounts = loadReputationAmounts();
  console.log('  reward files:', Object.keys(repAmounts).length);

  const nameMap      = buildNameMap(ini);
  const componentsMap = loadComponentsMap();
  console.log('  components_generated.ini:', Object.keys(componentsMap).length, 'entradas');

  console.log('Cargando misiones...');
  const missions = loadMissions(titleToBpPools, bpPools, repAmounts, ini, nameMap, componentsMap);
  console.log('  misiones únicas:', missions.length);

  const withBps = missions.filter(m => m.bps.length > 0).length;
  const withUec = missions.filter(m => m.uec > 0).length;
  const withRep = missions.filter(m => m.rep > 0).length;
  console.log(`  con BPs: ${withBps}, con aUEC: ${withUec}, con reputación: ${withRep}`);

  // JSON con datos completos
  fs.writeFileSync(OUT_JSON, JSON.stringify(missions, null, 2), 'utf8');
  console.log('JSON:', OUT_JSON);

  // TSV para traducir: solo título y descripción (+ claves), excluir dinámicas (~mission)
  const translatable = missions.filter(m => !m.titleText.startsWith('~mission('));
  console.log(`  traducibles (sin ~mission): ${translatable.length}`);

  const lines = ['key_titulo\ttitulo_en\tkey_descripcion\tdescripcion_en'];
  for (const m of translatable) {
    const title = m.titleText.replace(/\n/g, '\\n').replace(/\t/g, ' ');
    const desc  = m.descText.replace(/\n/g, '\\n').replace(/\t/g, ' ');
    lines.push(`${m.titleKey}\t${title}\t${m.descKey}\t${desc}`);
  }
  fs.writeFileSync(OUT_TSV, lines.join('\n'), 'utf8');
  console.log('TSV:', OUT_TSV);

  // Muestra algunos con BPs
  console.log('\nEjemplos con BPs:');
  missions.filter(m => m.bps.length > 0).slice(0, 5).forEach(m => {
    console.log(' ', m.titleKey, '→', m.bps.join(', '));
  });
}

main().catch(console.error);
