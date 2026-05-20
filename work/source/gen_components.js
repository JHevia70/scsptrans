// gen_components.js - Generate components_generated.ini from DCB TSV files + global.ini
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const BASE = path.dirname(__filename);

// Manufacturer class mapping (Code → class label)
// DCB sometimes stores abbreviated codes (AEG vs AEGS, BEH vs BEHR, etc.)
const MFR_CLASS = {
  // Mi (Military)
  AEGS: 'Mi', AEG: 'Mi',  // Aegis
  AMRS: 'Mi',              // Armistice
  WETK: 'Mi',              // WetaTek
  GODI: 'Mi',              // Godin
  GRNP: 'Mi',              // GreenPulse
  BANU: 'Mi',              // Banu
  VNC: 'Mi', VNCL: 'Mi',  // Vigilance Contracts
  // Ci (Civilian)
  BEHR: 'Ci', BEH: 'Ci',  // Behring
  ORIG: 'Ci',              // Origin
  RSI: 'Ci',               // Roberts Space Industries
  JSPN: 'Ci',              // Joker Sp'n
  LPLT: 'Ci',              // LightPulse
  WCPR: 'Ci',              // WildCat Petroleum Resources
  SASU: 'Ci',              // Sakura Sun
  TARS: 'Ci',              // Taranis
  ARCC: 'Ci',              // Archangel
  FSIN: 'Ci',              // Fusion Industries
  MITE: 'Ci',              // Musashi
  WLOP: 'Ci', WILO: 'Ci', // WiloTech
  SECO: 'Ci',              // SecureMe (?) — shields
  // In (Industrial)
  JUST: 'In', JUS: 'In',  // Juno Starwerk
  BASL: 'In',              // BaseLine
  CHCO: 'In',              // Chimera Composites
  SADA: 'In',              // Sadar
  // Co (Competition)
  ACOM: 'Co',              // A&C Orion
  YORM: 'Co',              // Yorman
  NAVE: 'Co',              // Naven Electronics
  ACAS: 'Co',              // ACAS
  BRRA: 'Co',              // Brara
  // St (Stealth)
  ASAS: 'St',              // Assembled
  BLTR: 'St',              // Bolt-R
  RACO: 'St',              // Racing Company
  TYDT: 'St',              // Tyler Design & Tech
};

// Grade mapping: DCB integer → letter (1=A, 2=B, 3=C, 4=D, 5=E)
const GRADE_LETTER = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };

// TSV file paths
const TSV = {
  type:  path.join(BASE, 'comp_type.tsv'),
  size:  path.join(BASE, 'comp_size.tsv'),
  grade: path.join(BASE, 'comp_grade.tsv'),
  mfr:   path.join(BASE, 'comp_mfr.tsv'),
};

const GLOBAL_INI = path.join(BASE, 'p4k_extract/Data/Localization/english/global.ini');
const OUT_FILE   = path.join(BASE, 'components_generated.ini');

async function readTsv(file) {
  const map = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const key = line.substring(0, tab).trim();
    const val = line.substring(tab + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

async function readGlobalIni(file) {
  // nameMap: suffix (after 'item_Name' or 'item_Name_') → display name
  const nameMap = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.substring(0, eq).trim();
    const v = line.substring(eq + 1).trim();
    if (!v) continue;
    const kLower = k.toLowerCase();
    if (kLower.startsWith('item_name_')) {
      // 'item_name_' = 10 chars, key format has underscore separator
      const suffix = k.substring(10).toUpperCase();
      nameMap[suffix] = { value: v, underscore: true };
    } else if (kLower.startsWith('item_name')) {
      // 'item_name' = 9 chars, key format has no underscore separator
      const suffix = k.substring(9).toUpperCase();
      nameMap[suffix] = { value: v, underscore: false };
    }
  }
  return nameMap;
}

function extractCode(mfrJson) {
  const m = mfrJson.match(/"Code"\s*:\s*"([A-Z0-9]+)"/);
  return m ? m[1] : null;
}

// Strip 'EntityClassDefinition.' prefix from record name
function entityName(recordKey) {
  const prefix = 'EntityClassDefinition.';
  return recordKey.startsWith(prefix) ? recordKey.substring(prefix.length) : recordKey;
}

// Extract manufacturer code from entity name pattern: TYPE_MFR_SXX_Name
// e.g. COOL_WCPR_S03_Elsen → WCPR
function mfrFromName(entity) {
  const m = entity.match(/^[A-Z]+_([A-Z0-9]+)_S\d+_/);
  return m ? m[1] : null;
}

// Extract size from entity name pattern: TYPE_MFR_SXX_Name
// Returns the parsed integer, or null if pattern not found
function sizeFromName(entity) {
  const m = entity.match(/_S(\d+)_/);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  console.log('Reading TSV files...');
  const [typeMap, sizeMap, gradeMap, mfrMap] = await Promise.all([
    readTsv(TSV.type),
    readTsv(TSV.size),
    readTsv(TSV.grade),
    readTsv(TSV.mfr),
  ]);

  console.log(`type: ${Object.keys(typeMap).length}, size: ${Object.keys(sizeMap).length}, ` +
              `grade: ${Object.keys(gradeMap).length}, mfr: ${Object.keys(mfrMap).length}`);

  console.log('Reading global.ini...');
  const nameMap = await readGlobalIni(GLOBAL_INI);
  console.log(`nameMap entries: ${Object.keys(nameMap).length}`);

  // Use typeMap as the master set of entities
  const entries = [];
  let missing = 0;
  const missingList = [];

  for (const recordKey of Object.keys(typeMap)) {
    const entity = entityName(recordKey);
    const typeVal = typeMap[recordKey];

    // Skip templates and UNDEFINED types
    if (typeVal === 'UNDEFINED' || entity.includes('Template') || entity.includes('TEST')) continue;

    const sizeVal  = sizeMap[recordKey];
    const gradeVal = gradeMap[recordKey];
    const mfrJson  = mfrMap[recordKey];

    if (!sizeVal || !gradeVal || !mfrJson) continue;

    let mfrCode  = extractCode(mfrJson);
    if (!mfrCode) continue;

    // Fallback: if DCB manufacturer code has no class mapping, try deriving from entity name
    // This fixes cases like COOL_WCPR_S03_Elsen where DCB stores wrong manufacturer (AEG)
    let mfrClass = MFR_CLASS[mfrCode];
    if (!mfrClass) {
      const nameMfr = mfrFromName(entity);
      if (nameMfr && MFR_CLASS[nameMfr]) {
        mfrCode  = nameMfr;
        mfrClass = MFR_CLASS[nameMfr];
      } else {
        console.warn(`Unknown mfr code: ${mfrCode} for ${entity}`);
        continue;
      }
    } else {
      // If DCB manufacturer doesn't match entity name, prefer name-derived manufacturer
      // e.g. COOL_WCPR_S03_Elsen has Code=AEG but name clearly says WCPR
      const nameMfr = mfrFromName(entity);
      if (nameMfr && nameMfr !== mfrCode && MFR_CLASS[nameMfr]) {
        console.warn(`Mfr mismatch for ${entity}: DCB=${mfrCode} name=${nameMfr} → using ${nameMfr}`);
        mfrCode  = nameMfr;
        mfrClass = MFR_CLASS[nameMfr];
      }
    }

    const gradeLetter = GRADE_LETTER[gradeVal];
    if (!gradeLetter) continue;

    // Fallback: if DCB size=1 but entity name says S0X with X>1, use name-derived size
    // e.g. QED_WETK_S03_Reynie has DCB itemSize=1 but should be 3
    let resolvedSize = sizeVal;
    if (sizeVal === '1') {
      const nameSize = sizeFromName(entity);
      if (nameSize && nameSize > 1) {
        console.warn(`Size mismatch for ${entity}: DCB=1 name=${nameSize} → using ${nameSize}`);
        resolvedSize = String(nameSize);
      }
    }

    // Look up display name in nameMap (try exact, then without _SCItem suffix)
    const entityUpper = entity.toUpperCase();
    const entityNoSCItem = entity.endsWith('_SCItem') ? entity.slice(0, -7) : entity;
    const entityNoSCItemUpper = entityNoSCItem.toUpperCase();

    let entry = nameMap[entityUpper] || nameMap[entityNoSCItemUpper];

    if (!entry) {
      missing++;
      missingList.push(entity);
      continue;
    }

    // Reconstruct the exact ini key preserving the underscore separator used in global.ini
    // entry.underscore=true → item_Name_XXX, false → item_NameXXX
    const prefix = `${mfrClass}/${resolvedSize}/${gradeLetter}`;
    const baseSuffix = nameMap[entityUpper] ? entity : entityNoSCItem;
    const iniKey = entry.underscore ? `item_Name_${baseSuffix}` : `item_Name${baseSuffix}`;
    entries.push(`${iniKey}=${prefix} ${entry.value}`);
  }

  // Sort entries
  entries.sort();

  console.log(`Generated: ${entries.length} entries`);
  console.log(`Missing name lookup: ${missing}`);
  if (missingList.length > 0) {
    console.log('First 20 missing:');
    missingList.slice(0, 20).forEach(e => console.log('  ' + e));
  }

  fs.writeFileSync(OUT_FILE, entries.join('\n') + '\n', 'utf8');
  console.log(`Written: ${OUT_FILE}`);
}

main().catch(console.error);
