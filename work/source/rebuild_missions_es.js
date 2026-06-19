// rebuild_missions_es.js — Reconstruye missions_es.json usando missions_data.json y traducciones actuales
// Uso: node rebuild_missions_es.js
'use strict';

const fs   = require('fs');
const path = require('path');

const BASE         = path.dirname(__filename);
const DATA_JSON    = path.join(BASE, '..', 'missions_data.json');
const ES_JSON      = path.join(BASE, '..', 'missions_es.json');
const CORR_INI     = path.join(BASE, '..', 'correcciones_missions.ini');

function loadCorrections(file) {
  const map = {};
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.substring(0, eq).trim();
    const v = line.substring(eq + 1).trim();
    if (k) map[k] = v;
  }
  return map;
}

const missionVarRe = /~[a-zA-Záéíóúñ]+\([^)]*\)/g;
function restoreMissionVars(esText, enText) {
  if (!enText || !esText) return esText;
  const enVars = [...enText.matchAll(missionVarRe)].map(m => m[0]);
  if (!enVars.length) return esText;
  let i = 0;
  return esText.replace(missionVarRe, () => enVars[i] !== undefined ? enVars[i++] : '');
}

function formatBpGroups(bpGroups) {
  if (!bpGroups || !bpGroups.length) return '';
  if (bpGroups.length === 1) {
    return '<EM4>Blueprints obtenibles:</EM4>\n' + bpGroups[0].map(b => '- ' + b).join('\n');
  }
  return '<EM4>Múltiples grupos de planos</EM4>\n' + bpGroups.map((g, i) =>
    '<EM4>Grupo ' + (i + 1) + '</EM4>\n' + g.map(b => '- ' + b).join('\n')
  ).join('\n\n');
}

const missionsData = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
const currentEs    = JSON.parse(fs.readFileSync(ES_JSON, 'utf8'));
const corrections  = loadCorrections(CORR_INI);

// global.ini almacena \n como texto literal "\\n" — convertir a saltos reales
function iniUnescape(s) { return s ? s.replace(/\\n/g, '\n') : s; }

// Mapa key → traducción actual
const translMap = {};
for (const m of currentEs) {
  // Strip old [BP] marker and old BP/Rep blocks from titleEs
  let titleEs = (m.titleEs || '').replace(/\s*<EM4>\[BP\]<\/EM4>$/, '').trim();
  // Strip old descEs BP/Rep blocks — match any header tag we've ever emitted
  let descEs = (m.descEs || '').replace(/\n\n<EM4>(Objetos Fabricables:|Múltiples grupos|Reputación [Oo]torgada[^:]*:|Blueprints obtenibles:)[\s\S]*$/, '').trim();
  if (m.titleKey) translMap[m.titleKey] = titleEs;
  if (m.descKey)  translMap[m.descKey]  = descEs;
}

let withBps = 0, withRep = 0;
const result = [];

for (const m of missionsData) {
  const titleTextEn = iniUnescape(m.titleText);
  const descTextEn  = iniUnescape(m.descText);

  let titleEs = corrections[m.titleKey] || translMap[m.titleKey] || titleTextEn;
  let descEs  = corrections[m.descKey]  || translMap[m.descKey]  || descTextEn;

  titleEs = restoreMissionVars(titleEs, titleTextEn);
  descEs  = restoreMissionVars(descEs,  descTextEn);

  const hasBps = m.bpGroups && m.bpGroups.length > 0;
  if (hasBps) {
    titleEs = titleEs + ' <EM4>[BP]</EM4>';
    withBps++;
  }
  const repMax = m.repMax || m.rep || 0;
  const repMin = m.repMin || repMax;
  if (repMax > 0) {
    const repText = (repMin > 0 && repMin !== repMax)
      ? '<EM4>Reputación otorgada (por dificultad):</EM4> ' + repMin.toLocaleString('es-ES') + ' / ' + repMax.toLocaleString('es-ES')
      : '<EM4>Reputación otorgada:</EM4> ' + repMax.toLocaleString('es-ES');
    descEs = (descEs ? descEs + '\n\n' : '') + repText;
    withRep++;
  }
  if (hasBps) {
    const bpBlock = formatBpGroups(m.bpGroups);
    descEs = (descEs ? descEs + '\n\n' : '') + bpBlock;
  }

  result.push({
    titleKey: m.titleKey,
    titleEs,
    titleEn:  titleTextEn,
    descKey:  m.descKey,
    descEs,
    descEn:   descTextEn,
    uec:      m.uec,
    repMin:   repMin,
    repMax:   repMax,
    bpGroups: m.bpGroups
  });
}

fs.writeFileSync(ES_JSON, JSON.stringify(result, null, 2), 'utf8');
console.log(`missions_es.json actualizado: ${result.length} misiones, ${withBps} con BPs, ${withRep} con reputación.`);

// Verificar BombRun
const bombRun = result.find(m => m.titleKey && m.titleKey.toLowerCase().includes('bombrun'));
if (bombRun) {
  console.log('\nBombRun:', bombRun.titleKey);
  console.log('  titleEs:', bombRun.titleEs);
  console.log('  descEs (últimas líneas):', bombRun.descEs.split('\n').slice(-10).join('\n'));
}
