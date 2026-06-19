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
    // Convertir secuencias \n del global.ini a saltos de línea reales
    map[line.substring(0, eq).trim()] = line.substring(eq + 1).replace(/\\n/g, '\n');
  }
  return map;
}

// ── Cargar nombres de blueprints: bp-file → entityClass name ─────────────────
// También precarga entityLocName: entityClass → clave de localización del entity record
// para items cuya clave no sigue el patrón item_name_*

const entityLocNames = {};  // entityClass_lower → ini key (sin @)

function loadBlueprintNames() {
  const map = {};
  for (const f of walk(BP_REC_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const entityRef = d._RecordValue_?.blueprint?.processSpecificData?.entityClass;
    if (!entityRef) continue;
    const entityName = refToName(entityRef);
    if (!entityName) continue;
    map[path.basename(f, '.json').toLowerCase()] = entityName;
    // Resolver ruta del entity record relativa al blueprint
    const relPath = entityRef.replace(/^file:\/\/\.\//, '');
    const entityFile = path.resolve(path.dirname(f), relPath);
    const ed = readJson(entityFile);
    if (!ed) continue;
    const locName = collectField(ed._RecordValue_, 'Localization')[0]?.Name;
    if (locName && typeof locName === 'string' && locName.startsWith('@') && !locName.includes('LOC_')) {
      entityLocNames[entityName.toLowerCase()] = locName.replace(/^@/, '');
    }
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
// Recorre generators[].contracts[] para asociar pools solo al sub-contrato al que pertenecen

function extractKeyFromOverrides(paramOverrides, param) {
  const arr = paramOverrides?.stringParamOverrides;
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    if (item?.param !== param) continue;
    const v = item?.value;
    if (typeof v === 'string' && v.startsWith('@') && !v.includes('LOC_UNINITIALIZED'))
      return v.replace(/^@/, '');
  }
  return null;
}

// Devuelve { byTitle, byDesc }
// byTitle: titleKey → Set<poolName>  (todos los pools del título, cuando la desc coincide con la inferida)
// byDesc:  descKey  → Set<poolName>  (pools específicos de una desc cuando el título se reutiliza con descs distintas)
function buildTitleToBpPools() {
  const byTitle = {};
  const byDesc  = {};

  // Primera pasada: contar cuántos descKeys distintos usa cada titleKey
  const titleDescCount = {};
  for (const f of walk(CONTRACT_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const generators = d._RecordValue_?.generators;
    if (!Array.isArray(generators)) continue;
    for (const gen of generators) {
      for (const contract of (gen.contracts || [])) {
        const titleKey = extractKeyFromOverrides(contract.paramOverrides, 'Title');
        if (!titleKey) continue;
        const poolRefs = collectField(contract, 'blueprintPool');
        if (!poolRefs.length) continue;
        const descKey = extractKeyFromOverrides(contract.paramOverrides, 'Description');
        if (!titleDescCount[titleKey]) titleDescCount[titleKey] = new Set();
        if (descKey) titleDescCount[titleKey].add(descKey);
      }
    }
  }

  // Segunda pasada: asignar pools según si el título tiene una sola desc o múltiples
  for (const f of walk(CONTRACT_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const generators = d._RecordValue_?.generators;
    if (!Array.isArray(generators)) continue;
    for (const gen of generators) {
      for (const contract of (gen.contracts || [])) {
        const titleKey = extractKeyFromOverrides(contract.paramOverrides, 'Title');
        if (!titleKey) continue;
        const poolRefs = collectField(contract, 'blueprintPool');
        const poolNames = [...new Set(poolRefs.map(r => refToName(r)).filter(Boolean))];
        if (!poolNames.length) continue;
        const descKey = extractKeyFromOverrides(contract.paramOverrides, 'Description');
        const multipleDescs = (titleDescCount[titleKey]?.size || 0) > 1;

        if (multipleDescs && descKey) {
          // Título reutilizado con descs distintas → pools van a byDesc
          if (!byDesc[descKey]) byDesc[descKey] = new Set();
          for (const p of poolNames) byDesc[descKey].add(p);
        } else {
          // Un solo título+desc → pools van a byTitle
          if (!byTitle[titleKey]) byTitle[titleKey] = new Set();
          for (const p of poolNames) byTitle[titleKey].add(p);
        }
      }
    }
  }
  return { byTitle, byDesc };
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

// Construye mapas titleKey y descKey → {min, max} desde ContractResult_LegacyReputation en los generadores
// Indexa por descKey cuando está disponible, y también por titleKey como fallback
function loadContractRepMap(repAmounts) {
  const byTitle = {};  // titleKey → {min, max}
  const byDesc  = {};  // descKey  → {min, max}

  function updateRange(map, key, amount) {
    if (!map[key]) map[key] = { min: amount, max: amount };
    else { map[key].min = Math.min(map[key].min, amount); map[key].max = Math.max(map[key].max, amount); }
  }

  for (const f of walk(CONTRACT_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const generators = d._RecordValue_?.generators;
    if (!Array.isArray(generators)) continue;
    for (const gen of generators) {
      for (const contract of (gen.contracts || [])) {
        const titleKey = extractKeyFromOverrides(contract.paramOverrides, 'Title');
        if (!titleKey) continue;
        const descKey = extractKeyFromOverrides(contract.paramOverrides, 'Description');
        const results = contract.contractResults?.contractResults || [];
        for (const r of results) {
          if (r._Type_ !== 'ContractResult_LegacyReputation') continue;
          const rewardFile = refToName(r.contractResultReputationAmounts?.reward);
          const amount = rewardFile ? (repAmounts[rewardFile] ?? 0) : 0;
          if (amount > 0) {
            if (descKey) updateRange(byDesc, descKey, amount);
            else          updateRange(byTitle, titleKey, amount);
          }
          break;
        }
      }
    }
  }
  return { byTitle, byDesc };
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

function resolveItemName(entityClass, nameMap, componentsMap, ini) {
  const ecl = entityClass.toLowerCase();
  const noSCItem = ecl.endsWith('_scitem') ? ecl.slice(0, -7) : ecl;
  // Prioridad: componentsMap > nameMap (item_name_*) > entityLocNames (Localization.Name del entity) > entityClass
  if (componentsMap[ecl]) return componentsMap[ecl];
  if (componentsMap[noSCItem]) return componentsMap[noSCItem];
  if (nameMap[ecl]) return nameMap[ecl];
  if (nameMap[noSCItem]) return nameMap[noSCItem];
  const locKey = entityLocNames[ecl] || entityLocNames[noSCItem];
  if (locKey && ini) return ini[locKey] || entityClass;
  return entityClass;
}

// ── Cargar misiones desde MissionBrokerEntry ──────────────────────────────────

// Intenta derivar la clave de descripción desde la clave de título buscando en el ini
function inferDescKey(titleKey, ini) {
  const variants = [
    titleKey.replace(/_[Tt]itle_/g,  '_Desc_'),
    titleKey.replace(/_[Tt]itle_/g,  '_desc_'),
    titleKey.replace(/_[Nn]ame_/g,   '_Desc_'),
    titleKey.replace(/_[Nn]ame_/g,   '_desc_'),
    titleKey.replace(/_[Tt]itle$/,   '_Desc'),
    titleKey.replace(/_[Tt]itle$/,   '_desc'),
    titleKey.replace(/_[Tt]itle$/,   '_Description'),
    titleKey.replace(/_[Tt]itle$/,   '_description'),
    titleKey.replace(/_[Nn]ame$/,    '_Desc'),
    titleKey.replace(/_[Nn]ame$/,    '_desc'),
  ];
  for (const v of variants) {
    if (v !== titleKey && ini[v] !== undefined) return v;
    // algunas claves tienen sufijo ,P (plural) en global.ini
    if (v !== titleKey && ini[v + ',P'] !== undefined) return v + ',P';
  }
  return null;
}

function mergeRepRange(existing, incoming) {
  if (!incoming) return;
  existing.repMin = existing.repMin ? Math.min(existing.repMin, incoming.min) : incoming.min;
  existing.repMax = existing.repMax ? Math.max(existing.repMax, incoming.max) : incoming.max;
}

function loadMissionsIntoMap(missions, { byTitle, byDesc }, bpPools, repAmounts, contractRepMap, ini, nameMap, componentsMap) {
  for (const f of walk(BROKER_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const v = d._RecordValue_;
    if (!v || v.notForRelease) continue;

    const titleKey = v.title ? v.title.replace(/^@/, '') : null;
    const descKeyRaw = v.description ? v.description.replace(/^@/, '') : null;
    let descKey = (descKeyRaw && descKeyRaw !== titleKey) ? descKeyRaw : null;
    if (!descKey) descKey = inferDescKey(titleKey, ini);
    if (!titleKey || titleKey === 'LOC_UNINITIALIZED') continue;

    const titleText = ini[titleKey] || '';
    if (!titleText) continue;

    const descText = descKey ? (ini[descKey] || '') : '';
    const uec = v.missionReward?.reward || 0;
    const brokerRep = extractRep(v, repAmounts);
    // Preferir rango de contractRepMap (indexado por descKey > titleKey), fallback a broker single value
    const contractRange = (descKey && contractRepMap.byDesc[descKey])
                        || contractRepMap.byTitle[titleKey]
                        || (brokerRep > 0 ? { min: brokerRep, max: brokerRep } : null);

    // Pools: priorizar byDesc (específico por descripción), luego byTitle (genérico)
    const poolSet = (descKey && byDesc[descKey]) ? byDesc[descKey]
                  : (byTitle[titleKey] || new Set());
    const poolNames = [...poolSet];
    // bpGroups: array de grupos, cada grupo es un pool distinto (sin items duplicados entre grupos)
    const seen = new Set();
    const bpGroups = poolNames
      .map(p => (bpPools[p] || [])
        .map(e => resolveItemName(e, nameMap, componentsMap, ini))
        .filter(name => { if (seen.has(name)) return false; seen.add(name); return true; })
      )
      .filter(g => g.length > 0);

    // Clave compuesta: cada combinación (titleKey, descKey) es una entrada independiente
    // para que applyMissions cubra todas las descripciones de un mismo título
    const mapKey = titleKey + '|' + (descKey || '');
    if (!missions.has(mapKey)) {
      const m = { titleKey, titleText, descKey: descKey || '', descText, uec, repMin: 0, repMax: 0, bpGroups };
      mergeRepRange(m, contractRange);
      missions.set(mapKey, m);
    } else {
      const ex = missions.get(mapKey);
      for (const g of bpGroups) {
        const key0 = g[0];
        if (!ex.bpGroups.some(eg => eg[0] === key0)) ex.bpGroups.push(g);
      }
      if (uec > ex.uec) ex.uec = uec;
      mergeRepRange(ex, contractRange);
    }
  }

}

// ── Añadir misiones de ContractGenerator sin MissionBrokerEntry ───────────────
// Hay misiones cuyo título solo aparece en stringParamOverrides de contratos y
// no en ningún broker entry. Las añadimos si tienen BPs y texto en global.ini.

function addContractOnlyMissions(missionsMap, { byTitle, byDesc }, bpPools, contractRepMap, ini, nameMap, componentsMap) {
  let added = 0;

  // Paso 1: misiones con BPs (byTitle/byDesc)
  const allEntries = [
    ...Object.entries(byTitle).map(([k, s]) => ({ titleKey: k, poolSet: s })),
    ...Object.entries(byDesc).map(([dk, s]) => ({ titleKey: null, poolSet: s })),
  ];
  // hasTitleKey: comprueba si ya existe alguna entrada con ese titleKey (clave compuesta)
  const hasTitleKey = (tk) => {
    for (const k of missionsMap.keys()) if (k === tk || k.startsWith(tk + '|')) return true;
    return false;
  };

  for (const { titleKey: tk, poolSet } of allEntries) {
    if (!tk) continue; // byDesc sin titleKey — el broker entry ya lo manejó
    if (hasTitleKey(tk)) continue;
    const titleText = ini[tk] || '';
    if (!titleText) continue;
    const seen = new Set();
    const bpGroups = [...poolSet]
      .map(p => (bpPools[p] || [])
        .map(e => resolveItemName(e, nameMap, componentsMap, ini))
        .filter(name => { if (seen.has(name)) return false; seen.add(name); return true; })
      )
      .filter(g => g.length > 0);
    if (!bpGroups.length) continue;
    const descKey = inferDescKey(tk, ini) || '';
    const descText = descKey ? (ini[descKey] || '') : '';
    const contractRange = (descKey && contractRepMap.byDesc[descKey]) || contractRepMap.byTitle[tk] || null;
    const m = { titleKey: tk, titleText, descKey, descText, uec: 0, repMin: 0, repMax: 0, bpGroups };
    mergeRepRange(m, contractRange);
    missionsMap.set(tk + '|' + descKey, m);
    added++;
  }

  // Paso 2: misiones sin BPs que solo existen en contract generators (sin broker entry)
  for (const f of walk(CONTRACT_DIR)) {
    const d = readJson(f);
    if (!d) continue;
    const generators = d._RecordValue_?.generators;
    if (!Array.isArray(generators)) continue;
    for (const gen of generators) {
      for (const contract of (gen.contracts || [])) {
        const titleKey = extractKeyFromOverrides(contract.paramOverrides, 'Title');
        if (!titleKey || hasTitleKey(titleKey)) continue;
        const titleText = ini[titleKey] || '';
        if (!titleText) continue;
        const descKey = extractKeyFromOverrides(contract.paramOverrides, 'Description') || inferDescKey(titleKey, ini) || '';
        const descText = descKey ? (ini[descKey] || '') : '';
        const contractRange = (descKey && contractRepMap.byDesc[descKey]) || contractRepMap.byTitle[titleKey] || null;
        const m = { titleKey, titleText, descKey, descText, uec: 0, repMin: 0, repMax: 0, bpGroups: [] };
        mergeRepRange(m, contractRange);
        missionsMap.set(titleKey + '|' + descKey, m);
        added++;
      }
    }
  }

  return added;
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
  console.log('  títulos con BPs:', Object.keys(titleToBpPools.byTitle).length, '(título) +', Object.keys(titleToBpPools.byDesc).length, '(desc)');

  console.log('Cargando valores de reputación...');
  const repAmounts = loadReputationAmounts();
  console.log('  reward files:', Object.keys(repAmounts).length);
  const contractRepMap = loadContractRepMap(repAmounts);
  console.log('  entradas rep por desc:', Object.keys(contractRepMap.byDesc).length, '| por título:', Object.keys(contractRepMap.byTitle).length);

  const nameMap      = buildNameMap(ini);
  const componentsMap = loadComponentsMap();
  console.log('  components_generated.ini:', Object.keys(componentsMap).length, 'entradas');

  console.log('Cargando misiones...');
  const missionsMap = new Map();
  loadMissionsIntoMap(missionsMap, titleToBpPools, bpPools, repAmounts, contractRepMap, ini, nameMap, componentsMap);
  const contractAdded = addContractOnlyMissions(missionsMap, titleToBpPools, bpPools, contractRepMap, ini, nameMap, componentsMap);
  // Rellenar rep=0 de broker entries con contractRepMap
  for (const m of missionsMap.values()) {
    if (!m.repMin && !m.repMax) {
      const contractRange = (m.descKey && contractRepMap.byDesc[m.descKey]) || contractRepMap.byTitle[m.titleKey];
      mergeRepRange(m, contractRange || null);
    }
  }
  console.log(`  misiones de broker: ${missionsMap.size - contractAdded}, añadidas de contratos: ${contractAdded}`);
  const missions = [...missionsMap.values()].sort((a, b) => a.titleKey.localeCompare(b.titleKey));
  console.log('  misiones únicas:', missions.length);

  const withBps = missions.filter(m => m.bpGroups && m.bpGroups.length > 0).length;
  const withUec = missions.filter(m => m.uec > 0).length;
  const withRep = missions.filter(m => m.repMax > 0).length;
  const withRange = missions.filter(m => m.repMin > 0 && m.repMin !== m.repMax).length;
  console.log(`  con BPs: ${withBps}, con aUEC: ${withUec}, con reputación: ${withRep} (${withRange} con rango min/max)`);

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
  missions.filter(m => m.bpGroups && m.bpGroups.length > 0).slice(0, 5).forEach(m => {
    console.log(' ', m.titleKey, '→', m.bpGroups.map((g, i) => `[${i+1}] ${g.join(', ')}`).join(' | '));
  });
}

main().catch(console.error);
