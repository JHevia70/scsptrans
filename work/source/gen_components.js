// gen_components.js - Generate components_generated.ini from DCB TSV files + global.ini
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const BASE = path.dirname(__filename);

// Manufacturer class mapping (Code → class label)
// DCB sometimes stores abbreviated codes (AEG vs AEGS, BEH vs BEHR, etc.)
const MFR_CLASS = {
  // Mil
  AEGS: 'Mil', AEG: 'Mil',  // Aegis
  AMRS: 'Mil',               // Armistice
  WETK: 'Mil',               // WetaTek
  GODI: 'Mil',               // Godin
  GRNP: 'Mil',               // GreenPulse
  BANU: 'Mil',               // Banu
  VNC: 'Mil', VNCL: 'Mil',  // Vigilance Contracts
  // Civ
  BEHR: 'Civ', BEH: 'Civ',  // Behring
  ORIG: 'Civ',               // Origin
  RSI: 'Civ',                // Roberts Space Industries
  JSPN: 'Civ',               // Joker Sp'n
  LPLT: 'Civ',               // LightPulse
  WCPR: 'Civ',               // WildCat Petroleum Resources
  SASU: 'Civ',               // Sakura Sun
  TARS: 'Civ',               // Taranis
  ARCC: 'Civ',               // Archangel
  FSIN: 'Civ',               // Fusion Industries
  MITE: 'Civ',               // Musashi
  WLOP: 'Civ', WILO: 'Civ', // WiloTech
  SECO: 'Civ',               // SecureMe (?) — shields
  // Ind
  JUST: 'Ind', JUS: 'Ind',  // Juno Starwerk
  BASL: 'Ind',               // BaseLine
  CHCO: 'Ind',               // Chimera Composites
  SADA: 'Ind',               // Sadar
  // Cmp
  ACOM: 'Cmp',               // A&C Orion
  YORM: 'Cmp',               // Yorman
  NAVE: 'Cmp',               // Naven Electronics
  ACAS: 'Cmp',               // ACAS
  BRRA: 'Cmp',               // Brara
  // Sth
  ASAS: 'Sth',               // Assembled
  BLTR: 'Sth',               // Bolt-R
  RACO: 'Sth',               // Racing Company
  TYDT: 'Sth',               // Tyler Design & Tech
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
      // 10 chars: 'item_name_' → suffix starts at index 10
      const suffix = k.substring(10).toUpperCase();
      nameMap[suffix] = v;
    } else if (kLower.startsWith('item_name')) {
      // 9 chars: 'item_name' → suffix starts at index 9
      const suffix = k.substring(9).toUpperCase();
      nameMap[suffix] = v;
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

    const mfrCode  = extractCode(mfrJson);
    if (!mfrCode) continue;

    const mfrClass = MFR_CLASS[mfrCode];
    if (!mfrClass) {
      console.warn(`Unknown mfr code: ${mfrCode} for ${entity}`);
      continue;
    }

    const gradeLetter = GRADE_LETTER[gradeVal];
    if (!gradeLetter) continue;

    // Build the ini key: item_Name + entity (uppercase match against nameMap)
    // Try exact match first, then strip _SCITEM suffix (most keys in global.ini omit it)
    const entityUpper = entity.toUpperCase();
    let displayName = nameMap[entityUpper];
    if (!displayName && entityUpper.endsWith('_SCITEM')) {
      displayName = nameMap[entityUpper.slice(0, -7)];
    }

    if (!displayName) {
      missing++;
      missingList.push(entity);
      continue;
    }

    // Prefix format: Class/Size/Grade DisplayName
    const prefix = `${mfrClass}/${sizeVal}/${gradeLetter}`;
    // Determine which global.ini key format this entry uses
    // (item_NameCOOL_XXX vs item_Name_COOL_XXX)
    const entityNoSCItem = entity.endsWith('_SCItem') ? entity.slice(0, -7) : entity;
    const entityNoSCItemUpper = entityNoSCItem.toUpperCase();
    // Check which key format exists in nameMap
    let iniKey;
    if (nameMap[entityUpper] !== undefined) {
      iniKey = `item_Name${entity}`;
    } else if (nameMap[entityNoSCItemUpper] !== undefined) {
      iniKey = `item_Name${entityNoSCItem}`;
    } else {
      iniKey = `item_Name${entityNoSCItem}`;
    }
    entries.push(`${iniKey}=${prefix} ${displayName}`);
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
