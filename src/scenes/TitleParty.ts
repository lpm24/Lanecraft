/**
 * TitleParty.ts — Party, networking, Firebase, and matchmaking logic
 * extracted from TitleScene.ts.
 *
 * All functions receive explicit dependencies (scene state, managers, etc.)
 * rather than accessing `this` directly, so TitleScene delegates to them.
 */

import { Race, BuildingType } from '../simulation/types';
import { PartyManager, PartyState } from '../network/PartyManager';
import { isFirebaseConfigured, initFirebase } from '../network/FirebaseService';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { getMapById } from '../simulation/maps';
import { PlayerProfile } from '../profile/ProfileData';
import { LocalSetup, saveLocalSetup, loadLocalSetup, createDefaultLocalSetup } from './TitleLocalSetup';
import {
  ALL_RACES, UNIT_TYPES, ARENA_WIDTH,
  getSpawnCountForUnit, pickUpgradePath, createDuelUnit,
  DuelUnit,
} from './TitleDuelSim';

// ─── Types for scene state access ───

/** Subset of TitleScene state that party functions need to read/write. */
export interface TitlePartyState {
  firebaseReady: boolean;
  firebaseInitPromise: Promise<void> | null;
  party: PartyManager | null;
  partyState: PartyState | null;
  partyError: string;
  partyErrorTimer: number;
  matchmaking: boolean;
  matchmakingDots: number;
  matchmakingTimeout: ReturnType<typeof setTimeout> | null;
  connecting: boolean;
  openLobbyCount: number | null;
  lobbyCountPollInterval: ReturnType<typeof setInterval> | null;
  lobbyCountRefreshToken: number;
  joinCodeInput: string;
  joinInputActive: boolean;
  joinHiddenInput: HTMLInputElement | null;
  localSetup: LocalSetup | null;
  playerName: string;
  profile: PlayerProfile | null;
  partyListener: (s: PartyState | null) => void;

  // Duel spawn state
  blueTeam: DuelUnit[];
  redTeam: DuelUnit[];
  bannerBlue: DuelUnit[];
  bannerRed: DuelUnit[];
  projectiles: any[];
  waiting: boolean;
  waitTimer: number;
  winnerLeaving: boolean;
  deadUnits: DuelUnit[];
  deathFade: number;
  winText: string;
  winTimer: number;
  winScale: number;
  fightStartPlayed: boolean;
  subtitle: string;
  subtitlePrev: string;
  subtitleRollTimer: number;
  subtitleIndex: number;
  duelTeamSize: 1 | 2 | 3;
  duelTier: 1 | 2 | 3;
  duelRaceLocked: boolean;
  duelTypeFilter: 'Any' | 'Melee' | 'Ranged' | 'Caster';
}

// ─── Constants ───

/** Max ~20 characters per subtitle to fit the blue ribbon banner */
export const SUBTITLES = [
  'Spawn Glory',
  'To Arms!', 'No Mercy', 'Glory Awaits', 'Hold Nothing Back',
  'One Must Fall', 'Blood & Glory', 'Into the Fray',
  'Steel Meets Steel', 'Ashes to Ashes', 'By Blade or Spell',
  'Draw First Blood', 'Conquer or Perish', 'March to War',
  'The Lanes Await', 'Build. Fight. Win.', 'War Never Changes',
  'Choose Your Race', 'Command the Field', 'Raise Your Army',
  // Easter eggs
  'A Krool World', 'GG No Re', 'Touch Grass Later',
  'Skill Issue Incoming', 'Nerf This', 'Press F for Respects',
  'Perfectly Balanced', 'RNG Be Kind', 'Git Gud',
  'Leeeroy!', 'Do a Barrel Roll', 'It\'s Super Effective',
];

export const SUBTITLE_ROLL_DUR = 0.4;

// ─── Firebase / lobby polling ───

export function ensureFirebase(state: TitlePartyState, silent = false): Promise<void> {
  if (state.firebaseReady) return Promise.resolve();
  if (!isFirebaseConfigured()) {
    if (!silent) showPartyError(state, 'Firebase not configured');
    return Promise.reject(new Error('Firebase not configured'));
  }
  if (state.firebaseInitPromise) return state.firebaseInitPromise;
  state.firebaseInitPromise = initFirebase().then(() => {
    state.firebaseReady = true;
    if (!state.party) state.party = new PartyManager();
    state.party.addListener(state.partyListener);
    state.firebaseInitPromise = null;
  }).catch((err) => {
    state.firebaseInitPromise = null;
    console.error('[Firebase] Init failed:', err.code || '', err.message || err);
    if (!silent) {
      showPartyError(state, err.code === 'auth/admin-restricted-operation'
        ? 'Enable Anonymous Auth in Firebase Console'
        : (err.message || 'Firebase error'));
    }
    throw err;
  });
  return state.firebaseInitPromise;
}

export function shouldPollLobbyCount(state: TitlePartyState): boolean {
  return !state.localSetup && !state.partyState && !state.joinInputActive && !state.matchmaking;
}

export function startLobbyCountPolling(state: TitlePartyState): void {
  stopLobbyCountPolling(state);
  if (!isFirebaseConfigured()) return;
  refreshLobbyCount(state);
  state.lobbyCountPollInterval = setInterval(() => {
    if (!shouldPollLobbyCount(state)) return;
    refreshLobbyCount(state);
  }, 10_000);
}

export function stopLobbyCountPolling(state: TitlePartyState): void {
  if (state.lobbyCountPollInterval) {
    clearInterval(state.lobbyCountPollInterval);
    state.lobbyCountPollInterval = null;
  }
  state.lobbyCountRefreshToken++;
}

export async function refreshLobbyCount(state: TitlePartyState): Promise<void> {
  if (!shouldPollLobbyCount(state)) return;
  const token = ++state.lobbyCountRefreshToken;
  try {
    await ensureFirebase(state, true);
    const count = await state.party!.getOpenGameCount();
    if (token === state.lobbyCountRefreshToken && shouldPollLobbyCount(state)) {
      state.openLobbyCount = count;
    }
  } catch {
    if (token === state.lobbyCountRefreshToken) state.openLobbyCount = null;
  }
}

// ─── Matchmaking ───

export async function doFindGame(state: TitlePartyState): Promise<void> {
  if (state.matchmaking) return;
  state.connecting = true;
  state.matchmaking = true;
  state.matchmakingDots = 0;
  clearMatchmakingTimeout(state);
  state.matchmakingTimeout = setTimeout(() => {
    cancelMatchmaking(state);
    showPartyError(state, 'No players found — try again');
  }, 60_000);
  try {
    await ensureFirebase(state);
    state.party!.localName = state.playerName;
    if (state.profile) state.party!.localAvatarId = state.profile.avatarId;
    const lastRace = getLastPartyRace();
    const joined = await state.party!.findAndJoinGame(lastRace);
    if (!joined) {
      await state.party!.createParty(lastRace);
    }
  } catch (e: any) {
    console.error('[Party] Find game failed:', e);
    showPartyError(state, e.message || 'Failed to find game');
    state.matchmaking = false;
    clearMatchmakingTimeout(state);
  } finally {
    state.connecting = false;
  }
}

export function cancelMatchmaking(state: TitlePartyState): void {
  state.matchmaking = false;
  clearMatchmakingTimeout(state);
  if (state.party && state.partyState) {
    state.party.leaveParty();
  }
}

export function clearMatchmakingTimeout(state: TitlePartyState): void {
  if (state.matchmakingTimeout) {
    clearTimeout(state.matchmakingTimeout);
    state.matchmakingTimeout = null;
  }
}

export function getLastPartyRace(): Race {
  const saved = localStorage.getItem('lanecraft.lastPartyRace');
  if (saved && ALL_RACES.includes(saved as Race)) return saved as Race;
  return Race.Crown;
}

// ─── Party creation / joining ───

export async function doCreateParty(state: TitlePartyState): Promise<void> {
  state.connecting = true;
  try {
    await ensureFirebase(state);
    state.party!.localName = state.playerName;
    if (state.profile) state.party!.localAvatarId = state.profile.avatarId;
    const saved = loadLocalSetup();
    const mapId = saved?.mapId ?? 'duel';
    const teamSize = saved?.teamSize ?? 1;
    await state.party!.createParty(getLastPartyRace(), mapId);
    if (teamSize !== getMapById(mapId).playersPerTeam) {
      await state.party!.updateTeamSize(teamSize);
    }
    if (saved?.bots) {
      for (const [slot, difficulty] of Object.entries(saved.bots)) {
        const slotNum = Number(slot);
        if (slotNum !== (saved.playerSlot ?? 0)) {
          await state.party!.setSlotBot(slotNum, difficulty);
          const botRace = saved.botRaces?.[slot];
          if (botRace && botRace !== 'random') {
            await state.party!.setSlotBotRace(slotNum, botRace);
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[Party] Create failed:', e);
    state.localSetup = loadLocalSetup() ?? createDefaultLocalSetup();
  } finally {
    state.connecting = false;
  }
}

// ─── Local setup mutations ───

export function localSetupCycleBot(state: TitlePartyState, slot: number): void {
  if (!state.localSetup) return;
  if (slot === state.localSetup.playerSlot) return;
  const current = state.localSetup.bots[String(slot)] ?? null;
  const cycle: (string | null)[] = [null, BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
  const curIdx = current ? cycle.indexOf(current) : 0;
  const nextIdx = (curIdx + 1) % cycle.length;
  const next = cycle[nextIdx];
  if (next) {
    state.localSetup.bots[String(slot)] = next;
  } else {
    delete state.localSetup.bots[String(slot)];
    if (state.localSetup.botRaces) delete state.localSetup.botRaces[String(slot)];
  }
  saveLocalSetup(state.localSetup);
}

export function localSetupCycleDifficulty(state: TitlePartyState, slot: number): void {
  if (!state.localSetup) return;
  const current = state.localSetup.bots[String(slot)];
  if (!current) return;
  const cycle = [BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
  const curIdx = cycle.indexOf(current as BotDifficultyLevel);
  state.localSetup.bots[String(slot)] = cycle[(curIdx + 1) % cycle.length];
  saveLocalSetup(state.localSetup);
}

export function localSetupSwapSlots(state: TitlePartyState, slotA: number, slotB: number): void {
  if (!state.localSetup || slotA === slotB) return;
  const botA = state.localSetup.bots[String(slotA)] ?? null;
  const botB = state.localSetup.bots[String(slotB)] ?? null;
  const isPlayerA = state.localSetup.playerSlot === slotA;
  const isPlayerB = state.localSetup.playerSlot === slotB;

  if (botA) state.localSetup.bots[String(slotB)] = botA; else delete state.localSetup.bots[String(slotB)];
  if (botB) state.localSetup.bots[String(slotA)] = botB; else delete state.localSetup.bots[String(slotA)];

  if (state.localSetup.botRaces) {
    const raceA = state.localSetup.botRaces[String(slotA)] ?? null;
    const raceB = state.localSetup.botRaces[String(slotB)] ?? null;
    if (raceA) state.localSetup.botRaces[String(slotB)] = raceA; else delete state.localSetup.botRaces[String(slotB)];
    if (raceB) state.localSetup.botRaces[String(slotA)] = raceB; else delete state.localSetup.botRaces[String(slotA)];
  }

  if (isPlayerA) state.localSetup.playerSlot = slotB;
  else if (isPlayerB) state.localSetup.playerSlot = slotA;

  saveLocalSetup(state.localSetup);
}

export function localSetupCycleMode(state: TitlePartyState): void {
  if (!state.localSetup) return;
  const currentTS = state.localSetup.teamSize ?? 1;

  let newTS: number;
  let newMapId: string;
  if (currentTS === 1) {
    newTS = 2; newMapId = 'duel';
  } else if (currentTS === 2) {
    newTS = 3; newMapId = 'skirmish';
  } else if (currentTS === 3) {
    newTS = 4; newMapId = 'warzone';
  } else {
    newTS = 1; newMapId = 'duel';
  }

  const nextMap = getMapById(newMapId);
  const ppt = nextMap.playersPerTeam;

  let playerSlot = state.localSetup.playerSlot;
  if (playerSlot >= nextMap.maxPlayers) playerSlot = 0;
  const playerTeam = Math.floor(playerSlot / ppt);

  const newActiveSet = new Set<number>();
  for (let t = 0; t < nextMap.teams.length; t++) {
    for (let s = 0; s < newTS; s++) {
      newActiveSet.add(t * ppt + s);
    }
  }

  const oldBots = { ...state.localSetup.bots };
  const bots: { [slot: string]: string } = {};
  for (let i = 0; i < nextMap.maxPlayers; i++) {
    if (i === playerSlot) continue;
    if (!newActiveSet.has(i)) continue;
    const slotTeam = Math.floor(i / ppt);
    if (oldBots[String(i)]) {
      bots[String(i)] = oldBots[String(i)];
    } else if (slotTeam !== playerTeam) {
      bots[String(i)] = BotDifficultyLevel.Medium;
    }
  }

  const oldBotRaces = state.localSetup.botRaces ?? {};
  const botRaces: { [slot: string]: string } = {};
  for (const [slot, race] of Object.entries(oldBotRaces)) {
    if (bots[slot]) botRaces[slot] = race;
  }

  if (!newActiveSet.has(playerSlot)) {
    const myTeamSlots = [...newActiveSet].filter(s => Math.floor(s / ppt) === playerTeam);
    playerSlot = myTeamSlots[0] ?? 0;
  }

  state.localSetup = {
    mapId: newMapId,
    maxSlots: nextMap.maxPlayers,
    bots,
    botRaces: Object.keys(botRaces).length > 0 ? botRaces : undefined,
    playerSlot,
    playerRace: state.localSetup.playerRace,
    teamSize: newTS,
  };
  saveLocalSetup(state.localSetup);
}

// ─── Join party ───

export async function doJoinParty(state: TitlePartyState): Promise<void> {
  if (state.joinCodeInput.length < 4) return;
  state.connecting = true;
  try {
    await ensureFirebase(state);
    state.party!.localName = state.playerName;
    if (state.profile) state.party!.localAvatarId = state.profile.avatarId;
    await state.party!.joinParty(state.joinCodeInput, getLastPartyRace());
    closeJoinInput(state);
  } catch (e: any) {
    console.error('[Party] Join failed:', e);
    showPartyError(state, e.message || 'Failed to join');
  } finally {
    state.connecting = false;
  }
}

export function openJoinInput(state: TitlePartyState): void {
  state.joinInputActive = true;
  state.joinCodeInput = '';
  focusJoinHiddenInput(state);
}

export function closeJoinInput(state: TitlePartyState): void {
  state.joinInputActive = false;
  state.joinCodeInput = '';
  blurJoinHiddenInput(state);
}

export function focusJoinHiddenInput(state: TitlePartyState): void {
  if (!state.joinHiddenInput) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.autocapitalize = 'characters';
    inp.autocomplete = 'off';
    inp.maxLength = 5;
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    inp.style.top = '0';
    inp.style.opacity = '0';
    inp.style.width = '1px';
    inp.style.height = '1px';
    inp.addEventListener('input', () => {
      const cleaned = inp.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
      inp.value = cleaned;
      state.joinCodeInput = cleaned;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.joinCodeInput.length >= 4) {
        doJoinParty(state);
      } else if (e.key === 'Escape') {
        closeJoinInput(state);
      }
    });
    document.body.appendChild(inp);
    state.joinHiddenInput = inp;
  }
  state.joinHiddenInput.value = state.joinCodeInput;
  state.joinHiddenInput.focus();
}

export function blurJoinHiddenInput(state: TitlePartyState): void {
  if (state.joinHiddenInput) {
    state.joinHiddenInput.blur();
    state.joinHiddenInput.remove();
    state.joinHiddenInput = null;
  }
}

// ─── Race cycling ───

export function cycleRace(state: TitlePartyState, dir: number = 1): void {
  const raceOrder: (Race | 'random')[] = [...ALL_RACES, 'random'];
  if (state.localSetup) {
    const currentRace = state.localSetup.playerRace;
    const idx = raceOrder.indexOf(currentRace);
    state.localSetup.playerRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
    saveLocalSetup(state.localSetup);
    return;
  }
  if (!state.party || !state.partyState) return;
  const localSlot = state.party.localSlotIndex;
  const myPlayer = state.partyState.players[String(localSlot)];
  const currentRace = myPlayer?.race ?? Race.Crown;
  const idx = raceOrder.indexOf(currentRace);
  const nextRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
  state.party.updateRace(nextRace as Race);
  localStorage.setItem('lanecraft.lastPartyRace', String(nextRace));
}

export function cycleBotRace(state: TitlePartyState, slot: number): void {
  if (!state.localSetup) return;
  if (!state.localSetup.botRaces) state.localSetup.botRaces = {};
  const raceOrder: (string)[] = ['random', ...ALL_RACES];
  const current = state.localSetup.botRaces[String(slot)] ?? 'random';
  const idx = raceOrder.indexOf(current);
  const next = raceOrder[(idx + 1) % raceOrder.length];
  state.localSetup.botRaces[String(slot)] = next;
  saveLocalSetup(state.localSetup);
}

export function cyclePartyBotRace(state: TitlePartyState, slot: number): void {
  if (!state.partyState || !state.party) return;
  const raceOrder: (string)[] = ['random', ...ALL_RACES];
  const current = state.partyState.botRaces?.[String(slot)] ?? 'random';
  const idx = raceOrder.indexOf(current);
  const next = raceOrder[(idx + 1) % raceOrder.length];
  state.party.setSlotBotRace(slot, next === 'random' ? null : next);
}

export function showPartyError(state: TitlePartyState, msg: string): void {
  state.partyError = msg;
  state.partyErrorTimer = 3;
}

// ─── Duel spawning ───

export function spawnDuel(state: TitlePartyState): void {
  state.blueTeam = [];
  state.redTeam = [];
  state.bannerBlue = [];
  state.bannerRed = [];

  state.subtitleIndex++;
  if (state.subtitleIndex > 0) {
    state.subtitlePrev = state.subtitle;
    state.subtitle = SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)];
    state.subtitleRollTimer = SUBTITLE_ROLL_DUR;
  }

  const allowedTypes = state.duelTypeFilter === 'Melee' ? [BuildingType.MeleeSpawner]
    : state.duelTypeFilter === 'Ranged' ? [BuildingType.RangedSpawner]
    : state.duelTypeFilter === 'Caster' ? [BuildingType.CasterSpawner]
    : UNIT_TYPES;

  const blueTeamRace = state.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;
  const redTeamRace = state.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;

  for (let i = 0; i < state.duelTeamSize; i++) {
    const blueRace = blueTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    const blueType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
    let redRace = redTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
    let redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
    let rerolls = 0;
    while (redRace === blueRace && redType === blueType && rerolls < 10) {
      if (!redTeamRace) redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      rerolls++;
    }

    const bluePath = pickUpgradePath(state.duelTier);
    const redPath = pickUpgradePath(state.duelTier);
    const blueCount = getSpawnCountForUnit(blueRace, blueType, bluePath);
    const redCount = getSpawnCountForUnit(redRace, redType, redPath);
    for (let si = 0; si < blueCount; si++) {
      const u = createDuelUnit(blueRace, blueType, -2 - i * 2 - si * 0.6, false, 0, state.duelTier, bluePath);
      state.blueTeam.push(u);
      if (si === 0) state.bannerBlue.push(u);
    }
    for (let si = 0; si < redCount; si++) {
      const u = createDuelUnit(redRace, redType, ARENA_WIDTH + 2 + i * 2 + si * 0.6, true, 2, state.duelTier, redPath);
      state.redTeam.push(u);
      if (si === 0) state.bannerRed.push(u);
    }
  }
  state.projectiles = [];
  state.waiting = false;
  state.winnerLeaving = false;
  state.deadUnits = [];
  state.deathFade = 0;
  state.winText = '';
  state.winTimer = 0;
  state.winScale = 0;
  state.fightStartPlayed = false;
}
