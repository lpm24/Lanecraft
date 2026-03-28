/**
 * Tutorial state machine — guides first-time players through a 2v2 match
 * and then highlights key menu features on the title screen.
 *
 * Persists progress to localStorage so it survives reloads.
 * Uses a per-frame cache to avoid repeated localStorage reads and
 * race conditions from mid-frame mutations.
 */

const STORAGE_KEY = 'lanecraft.tutorialStep';

export type TutorialStep =
  | 'click_builder' | 'place_builder'
  | 'click_melee' | 'place_melee'
  | 'click_tower' | 'place_tower'
  | 'show_research' | 'show_nuke'
  | 'match_done'
  | 'menu_profile' | 'menu_solo' | 'menu_find' | 'menu_custom'
  | 'menu_join' | 'menu_gallery' | 'menu_duel'
  | 'complete';

const STEP_ORDER: TutorialStep[] = [
  'click_builder', 'place_builder',
  'click_melee', 'place_melee',
  'click_tower', 'place_tower',
  'show_research', 'show_nuke',
  'match_done',
  'menu_profile', 'menu_solo', 'menu_find', 'menu_custom',
  'menu_join', 'menu_gallery', 'menu_duel',
  'complete',
];

const MATCH_STEPS: Set<TutorialStep> = new Set([
  'click_builder', 'place_builder',
  'click_melee', 'place_melee',
  'click_tower', 'place_tower',
  'show_research', 'show_nuke',
  'match_done',
]);

const MENU_STEPS: Set<TutorialStep> = new Set([
  'menu_profile', 'menu_solo', 'menu_find', 'menu_custom',
  'menu_join', 'menu_gallery', 'menu_duel',
]);

// ── Per-frame cache ──
// Prevents mid-frame state changes from causing inconsistent behavior.
// Call refreshTutorialCache() once per frame (in render loops).
let cachedStep: TutorialStep | null = null;

function readStepFromStorage(): TutorialStep {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && STEP_ORDER.includes(raw as TutorialStep)) return raw as TutorialStep;
  return 'click_builder'; // default = fresh user
}

/** Call once per frame to snapshot the current step from localStorage.
 *  All other reads within that frame use the cached value. */
export function refreshTutorialCache(): void {
  cachedStep = readStepFromStorage();
}

export function getTutorialStep(): TutorialStep {
  if (cachedStep !== null) return cachedStep;
  // First access before any refresh — read from storage
  cachedStep = readStepFromStorage();
  return cachedStep;
}

function writeStep(step: TutorialStep): void {
  localStorage.setItem(STORAGE_KEY, step);
  cachedStep = step; // Update cache so same-frame reads see the new value
}

export function advanceTutorial(): void {
  const current = getTutorialStep();
  const idx = STEP_ORDER.indexOf(current);
  if (idx < 0 || idx >= STEP_ORDER.length - 1) {
    writeStep('complete');
    return;
  }
  writeStep(STEP_ORDER[idx + 1]);
}

export function skipTutorial(): void {
  writeStep('complete');
}

export function isTutorialActive(): boolean {
  return getTutorialStep() !== 'complete';
}

export function isMatchTutorial(): boolean {
  return MATCH_STEPS.has(getTutorialStep());
}

export function isMenuTutorial(): boolean {
  return MENU_STEPS.has(getTutorialStep());
}

/** Jump match tutorial to menu phase (e.g. on match end / quit). */
export function finishMatchTutorial(): void {
  const step = getTutorialStep();
  if (MATCH_STEPS.has(step)) {
    writeStep('menu_profile');
  }
}

// ── Popup text for each step ──

export interface TutorialPopupInfo {
  title: string;
  body: string;
  /** Which tray column to highlight (0=miner, 1=melee, 2=ranged, 3=caster, 4=tower, 5=ability). -1 = none. */
  trayCol: number;
  /** Highlight grid slots (hut grid, build grid, or alley). */
  highlightGrid: 'hut' | 'build' | 'alley' | 'none';
  /** Point arrow at settings button? */
  arrowToSettings: boolean;
  /** Highlight a floating button above the tray. */
  floatingButton?: 'nuke' | 'research';
}

const POPUP_INFO: Record<TutorialStep, TutorialPopupInfo | null> = {
  click_builder: {
    title: 'Build a Miner Hut',
    body: 'Miners collect resources for your army.\nClick the Miner button below!',
    trayCol: 0,
    highlightGrid: 'none',
    arrowToSettings: false,
  },
  place_builder: {
    title: 'Place Your Hut',
    body: 'Now click an open slot near your base\nto place it.',
    trayCol: -1,
    highlightGrid: 'hut',
    arrowToSettings: false,
  },
  click_melee: {
    title: 'Train Soldiers',
    body: 'Barracks spawn melee fighters.\nClick the Melee button!',
    trayCol: 1,
    highlightGrid: 'none',
    arrowToSettings: false,
  },
  place_melee: {
    title: 'Place Your Barracks',
    body: 'Click an open slot to build it.',
    trayCol: -1,
    highlightGrid: 'build',
    arrowToSettings: false,
  },
  click_tower: {
    title: 'Build a Tower',
    body: 'Your first tower is free!\nClick the Tower button.',
    trayCol: 4,
    highlightGrid: 'none',
    arrowToSettings: false,
  },
  place_tower: {
    title: 'Place Your Tower',
    body: 'Click a slot in the middle strip\nbetween the two bases.',
    trayCol: -1,
    highlightGrid: 'alley',
    arrowToSettings: false,
  },
  show_research: {
    title: 'Research',
    body: 'Upgrade your units here once you\nhave enough buildings.',
    trayCol: -1,
    highlightGrid: 'none',
    arrowToSettings: false,
    floatingButton: 'research' as const,
  },
  show_nuke: {
    title: 'Nuke',
    body: 'A powerful one-time strike.\nUnlocks after 60 seconds.',
    trayCol: -1,
    highlightGrid: 'none',
    arrowToSettings: false,
    floatingButton: 'nuke' as const,
  },
  match_done: {
    title: 'Good Luck!',
    body: 'Your army is on its way.\nYou can exit to the main menu\nfrom the Settings button.',
    trayCol: -1,
    highlightGrid: 'none',
    arrowToSettings: true,
  },
  menu_profile: null, menu_solo: null, menu_find: null,
  menu_custom: null, menu_join: null, menu_gallery: null,
  menu_duel: null, complete: null,
};

export function getMatchPopupInfo(): TutorialPopupInfo | null {
  return POPUP_INFO[getTutorialStep()] ?? null;
}

// ── Menu tutorial text ──

export interface MenuTutorialInfo {
  target: 'profile' | 'solo' | 'findGame' | 'custom' | 'join' | 'gallery' | 'duel';
  title: string;
  body: string;
}

export function getMenuTutorialInfo(): MenuTutorialInfo | null {
  const step = getTutorialStep();
  switch (step) {
    case 'menu_profile': return {
      target: 'profile',
      title: 'Profile',
      body: 'Change your avatar, view your stats\nand unlock achievements.',
    };
    case 'menu_solo': return {
      target: 'solo',
      title: 'Play Solo',
      body: 'Pick a race, difficulty, and team size\nto battle against bots.',
    };
    case 'menu_find': return {
      target: 'findGame',
      title: 'Find Game',
      body: 'Queue up for an online match\nagainst other players.',
    };
    case 'menu_custom': return {
      target: 'custom',
      title: 'Custom Game',
      body: 'Create a private lobby and invite\nfriends to play together.',
    };
    case 'menu_join': return {
      target: 'join',
      title: 'Join Party',
      body: 'Enter a party code to join\na friend\'s lobby.',
    };
    case 'menu_gallery': return {
      target: 'gallery',
      title: 'Unit Gallery',
      body: 'Browse every unit in the game\nand learn about their abilities.',
    };
    case 'menu_duel': return {
      target: 'duel',
      title: 'Duel Arena',
      body: 'Units from different races fight here.\nWatch and learn who beats who!',
    };
    default: return null;
  }
}

/** Auto-advance timeout in ms per step. */
export const TUTORIAL_TIMEOUT_MS = 30_000;
