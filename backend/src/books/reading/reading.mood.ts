import type { ReadingMood } from './reading.types.js';

const MOOD_LEXICON: Record<ReadingMood, string[]> = {
  espera: [
    'espera',
    'esperar',
    'esperaba',
    'horizonte',
    'silencio',
    'llanura',
    'torre',
    'contemplaba',
    'quietud',
    'calma',
    'viento',
    'muro',
    'fortaleza',
    'uniforme',
    'tiempo',
  ],
  polvo: [
    'polvo',
    'años',
    'año',
    'costumbre',
    'piedra',
    'almenas',
    'ruina',
    'arena',
    'memoria',
    'bronce',
    'hierro',
    'taller',
    'tarde',
    'seco',
    'camino',
    'antiguo',
    'madera',
  ],
  alerta: [
    'noche',
    'noches',
    'moverse',
    'centinela',
    'centinelas',
    'sombra',
    'peligro',
    'alerta',
    'miedo',
    'fuego',
    'sangre',
    'guerra',
    'enemigo',
    'golpe',
    'alarma',
    'oscuro',
    'ruido',
    'grito',
  ],
  niebla: [
    'niebla',
    'marzo',
    'relevo',
    'relevos',
    'lejano',
    'país',
    'invierno',
    'frío',
    'lluvia',
    'agua',
    'gris',
    'bruma',
    'sueño',
    'olvido',
    'humedad',
    'gota',
    'cañón',
  ],
};

const STOPWORDS = new Set([
  'para',
  'como',
  'pero',
  'más',
  'este',
  'esta',
  'estos',
  'estas',
  'todo',
  'toda',
  'todos',
  'todas',
  'otro',
  'otra',
  'otros',
  'otras',
  'entre',
  'desde',
  'hasta',
  'hacia',
  'sobre',
  'donde',
  'cuando',
  'porque',
  'aunque',
  'había',
  'fueron',
  'tiene',
  'tienen',
  'hacer',
  'puede',
  'pueden',
  'mismo',
  'misma',
  'alguno',
  'alguna',
]);

function normalizeToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^a-záéíóúüñ0-9]+|[^a-záéíóúüñ0-9]+$/gi, '');
}

export function classifyMoodAndCues(
  text: string,
  fallbackIndex: number,
): { mood: ReadingMood; cues: string[] } {
  const words = text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((w) => w.length >= 3);

  const matchedByMood: Record<ReadingMood, string[]> = {
    espera: [],
    polvo: [],
    alerta: [],
    niebla: [],
  };

  for (const w of words) {
    for (const mood of ['espera', 'polvo', 'alerta', 'niebla'] as const) {
      if (MOOD_LEXICON[mood].includes(w) && !matchedByMood[mood].includes(w)) {
        matchedByMood[mood].push(w);
      }
    }
  }

  let bestMood: ReadingMood = (['espera', 'polvo', 'alerta', 'niebla'] as const)[
    fallbackIndex % 4
  ];
  let bestCount = 0;

  for (const mood of ['espera', 'polvo', 'alerta', 'niebla'] as const) {
    if (matchedByMood[mood].length > bestCount) {
      bestCount = matchedByMood[mood].length;
      bestMood = mood;
    }
  }

  let cues = matchedByMood[bestMood].slice(0, 3);
  if (cues.length === 0) {
    const salient: string[] = [];
    for (const w of words) {
      if (w.length >= 5 && !STOPWORDS.has(w) && !salient.includes(w)) {
        salient.push(w);
        if (salient.length >= 2) break;
      }
    }
    cues = salient.length > 0 ? salient : [bestMood];
  }

  return { mood: bestMood, cues };
}
