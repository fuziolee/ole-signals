// OLE Signals — tangga level 24 peringkat Point Blank + acuan saldo.
// Acuan adalah tangga TETAP berlabuh di $10.000: ref(L) = $10.000 x 1,05^(L-1).
// TIDAK pernah dihitung ulang dari saldo aktual trader (bukan ratchet).

export const LEVEL_NAMES_EN = [
  'Trainee', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant',
  'Sergeant First Class', 'Master Sergeant', 'Second Lieutenant',
  'First Lieutenant', 'Captain', 'Major', 'Lieutenant Colonel', 'Colonel',
  'Brigadier', 'Major General', 'Lieutenant General', 'General',
  'Commander', 'Hero', 'Hero Brigadier General', 'Hero Major General',
  'Hero Lieutenant General', 'Hero General', 'Supreme Hero',
];

export const LEVEL_NAMES_ID = [
  'Trainee', 'Prajurit', 'Kopral', 'Sersan', 'Sersan Staf',
  'Sersan Satu', 'Sersan Mayor', 'Letnan Dua',
  'Letnan Satu', 'Kapten', 'Mayor', 'Letnan Kolonel', 'Kolonel',
  'Brigadir', 'Mayor Jenderal', 'Letnan Jenderal', 'Jenderal',
  'Komandan', 'Hero', 'Hero Brigadier General', 'Hero Major General',
  'Hero Lieutenant General', 'Hero General', 'Supreme Hero',
];

export const PAY_GATE_LEVEL = 5; // Level 5+ = Verified + gerbang langganan
export const START_BALANCE_USD = 10000;

function toRoman(n) {
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) { out += s; n -= v; }
  }
  return out || 'I';
}

// Nama level untuk level berapa pun (L25+ = Supreme Hero I, II, ...).
export function levelName(level, lang = 'id') {
  const n = Math.max(1, Math.floor(level || 1));
  if (n <= 24) {
    return (lang === 'en' ? LEVEL_NAMES_EN : LEVEL_NAMES_ID)[n - 1];
  }
  return `Supreme Hero ${toRoman(n - 24)}`;
}

// Acuan saldo tangga tetap untuk level L.
export function levelRef(level) {
  const n = Math.max(1, Math.floor(level || 1));
  return 10000 * Math.pow(1.05, n - 1);
}

// Ambang naik ke level berikutnya (saldo) dari level saat ini.
export function nextLevelRef(level) {
  return levelRef(level + 1);
}

// Ambang turun (saldo) dari level saat ini.
export function downLevelRef(level) {
  return levelRef(level) * 0.95;
}
