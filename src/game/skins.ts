import type { RunStats } from './types';

export type CatSkinId =
  | 'marmalade'
  | 'tuxedo'
  | 'calico'
  | 'mint-choco'
  | 'disco'
  | 'baguette'
  | 'royal'
  | 'cosmic';

export type CatPattern = 'stripes' | 'tuxedo' | 'spots' | 'stars' | 'baguette';

export type CatAccessory =
  | 'none'
  | 'bowtie'
  | 'headphones'
  | 'beret'
  | 'sunglasses'
  | 'butter'
  | 'crown'
  | 'wizard';

export interface CatSkinDefinition {
  id: CatSkinId;
  name: string;
  tagline: string;
  unlockRuleText: string;
  coatColor: string;
  bellyColor: string;
  markingColor: string;
  earInnerColor: string;
  outlineColor: string;
  pattern: CatPattern;
  accessory: CatAccessory;
}

export interface PlayerProgress {
  selectedSkin: CatSkinId;
  unlockedSkins: CatSkinId[];
  bestScore: number;
  clearedTrackIds: string[];
  defeatedBossIds: string[];
}

export const CAT_SKINS: CatSkinDefinition[] = [
  {
    id: 'marmalade',
    name: 'Classic Marmalade',
    tagline: 'Toasted ginger loaf with classic tabby stripes.',
    unlockRuleText: 'Starter skin (always unlocked)',
    coatColor: '#F2994A',
    bellyColor: '#FFF3E0',
    markingColor: '#C86A28',
    earInnerColor: '#FDA4AF',
    outlineColor: '#23192D',
    pattern: 'stripes',
    accessory: 'none',
  },
  {
    id: 'tuxedo',
    name: 'Midnight Tuxedo',
    tagline: 'Dapper black-and-white coat with a crimson bow tie.',
    unlockRuleText: 'Score 1,000+ points in a single run',
    coatColor: '#262B3D',
    bellyColor: '#F8FAFC',
    markingColor: '#475569',
    earInnerColor: '#F472B6',
    outlineColor: '#0F172A',
    pattern: 'tuxedo',
    accessory: 'bowtie',
  },
  {
    id: 'calico',
    name: 'Calico Groove',
    tagline: 'Tri-color patches rocking studio monitor headphones.',
    unlockRuleText: 'Reach a 10+ Beat Combo in any run',
    coatColor: '#FDF6E9',
    bellyColor: '#FFFFFF',
    markingColor: '#EA580C',
    earInnerColor: '#FDA4AF',
    outlineColor: '#2E1F18',
    pattern: 'spots',
    accessory: 'headphones',
  },
  {
    id: 'mint-choco',
    name: 'Mint Choco Loaf',
    tagline: 'Cool peppermint coat, cocoa chips, and a café beret.',
    unlockRuleText: 'Clear "Midnight Loaf" or score 2,000+',
    coatColor: '#5EEAD4',
    bellyColor: '#ECFEFF',
    markingColor: '#451A03',
    earInnerColor: '#F9A8D4',
    outlineColor: '#134E4A',
    pattern: 'spots',
    accessory: 'beret',
  },
  {
    id: 'disco',
    name: 'Disco Synth Cat',
    tagline: 'Electric plum sheen with starry spots and shutter shades.',
    unlockRuleText: 'Clear "Alley Strut" or finish an imported MP3',
    coatColor: '#D946EF',
    bellyColor: '#FEF08A',
    markingColor: '#FDE047',
    earInnerColor: '#FBCFE8',
    outlineColor: '#3B0764',
    pattern: 'stars',
    accessory: 'sunglasses',
  },
  {
    id: 'baguette',
    name: 'Toasted Baguette',
    tagline: 'Fresh-baked golden crust topped with a melting pat of butter.',
    unlockRuleText: 'Clear any song with 85%+ Beat Accuracy',
    coatColor: '#D97706',
    bellyColor: '#FEF3C7',
    markingColor: '#FFFBEB',
    earInnerColor: '#FDBA74',
    outlineColor: '#451A03',
    pattern: 'baguette',
    accessory: 'butter',
  },
  {
    id: 'royal',
    name: 'Royal Tempo King',
    tagline: 'Velvet indigo coat crowned for rhythm champions.',
    unlockRuleText: 'Defeat any Boss in Boss Battle mode',
    coatColor: '#6D28D9',
    bellyColor: '#FEF08A',
    markingColor: '#A78BFA',
    earInnerColor: '#F472B6',
    outlineColor: '#1E1B4B',
    pattern: 'tuxedo',
    accessory: 'crown',
  },
  {
    id: 'cosmic',
    name: 'Cosmic Maestro',
    tagline: 'Stardust-speckled coat with a celestial wizard hat.',
    unlockRuleText: 'Score 4,500+ points or defeat Maestro Pipe-Organ',
    coatColor: '#1E1B4B',
    bellyColor: '#67E8F9',
    markingColor: '#FDE047',
    earInnerColor: '#C084FC',
    outlineColor: '#090D1F',
    pattern: 'stars',
    accessory: 'wizard',
  },
];

export function getSkinById(id: CatSkinId): CatSkinDefinition {
  return CAT_SKINS.find((s) => s.id === id) ?? CAT_SKINS[0];
}

export function evaluateSkinUnlocks(
  currentUnlocked: CatSkinId[],
  stats: RunStats,
  trackId: string,
  bossId: string | null,
): { allUnlocked: CatSkinId[]; newlyUnlocked: CatSkinId[] } {
  const unlockedSet = new Set<CatSkinId>(currentUnlocked);
  unlockedSet.add('marmalade');

  if (!stats.scoreCounted) {
    return {
      allUnlocked: Array.from(unlockedSet),
      newlyUnlocked: [],
    };
  }

  const newlyUnlocked: CatSkinId[] = [];
  const tryUnlock = (id: CatSkinId, condition: boolean) => {
    if (condition && !unlockedSet.has(id)) {
      unlockedSet.add(id);
      newlyUnlocked.push(id);
    }
  };

  tryUnlock('tuxedo', stats.score >= 1000);
  tryUnlock('calico', stats.maxCombo >= 10);
  tryUnlock(
    'mint-choco',
    (stats.victory && trackId === 'midnight-loaf') || stats.score >= 2000,
  );
  tryUnlock(
    'disco',
    stats.victory && (trackId === 'alley-strut' || trackId.startsWith('mp3-')),
  );
  tryUnlock('baguette', stats.victory && stats.accuracyPct >= 85);
  tryUnlock('royal', stats.victory && stats.victoryReason === 'boss-defeated');
  tryUnlock(
    'cosmic',
    stats.score >= 4500 ||
      (stats.victory && stats.victoryReason === 'boss-defeated' && bossId === 'maestro'),
  );

  return {
    allUnlocked: Array.from(unlockedSet),
    newlyUnlocked,
  };
}

const STORAGE_KEY = 'sausage-cat-beat-progress-v1';

export function loadPlayerProgress(): PlayerProgress {
  const fallback: PlayerProgress = {
    selectedSkin: 'marmalade',
    unlockedSkins: ['marmalade'],
    bestScore: 0,
    clearedTrackIds: [],
    defeatedBossIds: [],
  };

  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PlayerProgress>;
    const unlocked: CatSkinId[] = Array.isArray(parsed.unlockedSkins)
      ? (parsed.unlockedSkins.filter((id) => CAT_SKINS.some((s) => s.id === id)) as CatSkinId[])
      : (['marmalade'] as CatSkinId[]);
    if (!unlocked.includes('marmalade')) unlocked.unshift('marmalade');
    const selected =
      parsed.selectedSkin && unlocked.includes(parsed.selectedSkin)
        ? parsed.selectedSkin
        : 'marmalade';

    return {
      selectedSkin: selected,
      unlockedSkins: unlocked,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      clearedTrackIds: Array.isArray(parsed.clearedTrackIds) ? parsed.clearedTrackIds : [],
      defeatedBossIds: Array.isArray(parsed.defeatedBossIds) ? parsed.defeatedBossIds : [],
    };
  } catch {
    return fallback;
  }
}

export function savePlayerProgress(progress: PlayerProgress): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / private mode failures
  }
}
