import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader, drawSpriteFrame, drawGridFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { Race, BuildingType, StatusType } from '../simulation/types';
import { RACE_COLORS, RACE_LABELS } from '../simulation/data';
import { PartyManager, PartyState, PartyPlayer, getPartyPlayerCount, getActiveSlots } from '../network/PartyManager';
import { isFirebaseConfigured, initFirebase } from '../network/FirebaseService';
import { PlayerProfile, ALL_AVATARS, loadProfile, checkNonMatchAchievement, ACHIEVEMENTS } from '../profile/ProfileData';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { getMapById } from '../simulation/maps';
import { SoundManager } from '../audio/SoundManager';
import { MusicPlayer } from '../audio/MusicPlayer';
import { getAudioSettings, subscribeToAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { drawSettingsButton, drawSettingsOverlay, getSettingsOverlayLayout, hitRect as hitOverlayRect, sliderValueFromPoint, handleVisualToggleClick, SettingsSliderDrag } from '../ui/SettingsOverlay';
import { getSafeTop } from '../ui/SafeArea';
import { loadPlayerName } from './TitlePlayerName';
import { isMenuTutorial, advanceTutorial, skipTutorial, getMenuTutorialInfo, TUTORIAL_TIMEOUT_MS, refreshTutorialCache } from '../ui/TutorialManager';
import { getElo, saveAllElo, updateTeamElo } from './TitleElo';
import { LocalSetup, saveLocalSetup, loadLocalSetup, createDefaultLocalSetup, getLocalActiveSlots, canStartLocalSetup, canStartParty } from './TitleLocalSetup';
import {
  DuelUnit, DuelProjectile, ALL_RACES, UNIT_TYPES, ARENA_WIDTH,
  TitleSfx, getSpawnCountForUnit, pickUpgradePath, createDuelUnit,
  getEffectiveSpeed, tickDuelStatusEffects, tickDuelCombat, tickDuelProjectiles, findNearestEnemy,
} from './TitleDuelSim';


const PARTY_DIFFICULTY_OPTIONS: { level: BotDifficultyLevel; label: string; color: string }[] = [
  { level: BotDifficultyLevel.Easy, label: 'EASY', color: '#4caf50' },
  { level: BotDifficultyLevel.Medium, label: 'MED', color: '#ffd740' },
  { level: BotDifficultyLevel.Hard, label: 'HARD', color: '#ff9100' },
  { level: BotDifficultyLevel.Nightmare, label: 'NITE', color: '#ff1744' },
];

function getModeName(teamSize: number): string {
  switch (teamSize) {
    case 1: return 'Duel (1v1)';
    case 2: return 'Battle (2v2)';
    case 3: return 'War (3v3)';
    case 4: return 'Kooktown (4v4)';
    default: return `${teamSize}v${teamSize}`;
  }
}


export class TitleScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private ui: UIAssets;
  private sprites: SpriteLoader;
  private pulseTime = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private touchMoveHandler: ((e: TouchEvent) => void) | null = null;
  private touchEndHandler: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Player name & profile
  private playerName = loadPlayerName();
  get name(): string { return this.playerName; }
  private profileBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private resetEloBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private teamSizeBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private tierBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private raceLockBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private typeFilterBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  profile: PlayerProfile | null = null;

  // Duel state
  private blueTeam: DuelUnit[] = [];
  private bannerBlue: DuelUnit[] = []; // persists for VS banner between fights
  private redTeam: DuelUnit[] = [];
  private bannerRed: DuelUnit[] = []; // persists for VS banner between fights
  private projectiles: DuelProjectile[] = [];
  private waitTimer = 0;
  private waiting = true;
  private deathFade = 0;
  private deadUnits: DuelUnit[] = [];
  private winnerLeaving = false;
  private animTime = 0;

  // Duel mode settings (persisted to localStorage)
  private duelTeamSize: 1 | 2 | 3;
  private duelTier: 1 | 2 | 3;
  private duelRaceLocked = true;
  private duelTypeFilter: 'Any' | 'Melee' | 'Ranged' | 'Caster' = 'Any';
  private subtitle = 'Spawn Glory';
  private subtitlePrev = '';
  private subtitleRollTimer = 0; // seconds remaining in roll animation
  private static readonly SUBTITLE_ROLL_DUR = 0.4;
  private subtitleIndex = 0;
  private resetEloConfirm = false; // true = waiting for second click to confirm

  // Win announcement
  private winText = '';
  private winColor = '#fff';
  private winTimer = 0;
  private winScale = 0;

  // Sound
  private sfx = new TitleSfx();
  private menuMusic = new SoundManager();
  private musicPlayer: MusicPlayer;
  private audioSettings = getAudioSettings();
  private audioSettingsUnsub: (() => void) | null = null;
  private settingsOpen = false;

  /** "Now Playing" track name + timing for fade */
  private nowPlayingName = '';
  private nowPlayingStart = 0;
  private static readonly NP_SHOW_MS = 10_000;
  private static readonly NP_FADE_MS = 600;
  private sliderDrag = new SettingsSliderDrag();
  private userInteracted = false;
  private fightStartPlayed = false;

  // Party / multiplayer state
  party: PartyManager | null = null;
  private partyState: PartyState | null = null;
  private partyError: string = '';
  private partyErrorTimer = 0;
  private copyFeedbackTimer = 0;
  private matchmaking = false; // true while searching for a game
  private matchmakingDots = 0;
  private matchmakingTimeout: ReturnType<typeof setTimeout> | null = null;
  private connecting = false; // true while Firebase is initializing (custom game / find game)
  private joinCodeInput: string = '';
  private joinInputActive = false;
  private joinHiddenInput: HTMLInputElement | null = null;
  private firebaseReady = false;
  // Drag-and-drop state for party slot rearrangement
  private dragSlot = -1;  // which slot is being dragged (-1 = none)
  private dragX = 0;
  private dragY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;
  private dragJustEnded = false; // suppress click after drag
  private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  onPartyStart: ((party: PartyState, localSlot: number) => void) | null = null;
  onLocalStart: ((setup: LocalSetup) => void) | null = null;
  private localSetup: LocalSetup | null = null;

  // Menu tutorial state
  private menuTutorialActive = isMenuTutorial();
  private menuTutorialStepStart = performance.now();
  private menuTutorialSkipAllRect: { x: number; y: number; w: number; h: number } | null = null;

  setNowPlaying(name: string): void {
    this.nowPlayingName = name;
    this.nowPlayingStart = performance.now();
  }

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader, musicPlayer: MusicPlayer) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
    this.musicPlayer = musicPlayer;
    // Load persisted duel settings
    try {
      const ts = localStorage.getItem('lanecraft.duelTeamSize');
      this.duelTeamSize = (ts === '1' ? 1 : ts === '3' ? 3 : 2) as 1 | 2 | 3;
      const tr = localStorage.getItem('lanecraft.duelTier');
      this.duelTier = (tr === '2' ? 2 : tr === '3' ? 3 : 1) as 1 | 2 | 3;
      const rl = localStorage.getItem('lanecraft.duelRaceLocked');
      this.duelRaceLocked = rl === 'false' ? false : true; // default true
      const tf = localStorage.getItem('lanecraft.duelTypeFilter');
      this.duelTypeFilter = (tf === 'Melee' || tf === 'Ranged' || tf === 'Caster') ? tf : 'Any';
    } catch {
      this.duelTeamSize = 1;
      this.duelTier = 1;
      this.duelRaceLocked = true;
      this.duelTypeFilter = 'Any';
    }
  }

  private enterTime = 0;

  enter(): void {
    this.enterTime = Date.now();
    this.pulseTime = 0;
    this.waiting = true;
    this.waitTimer = 0.5;
    this.blueTeam = [];
    this.redTeam = [];
    this.deadUnits = [];
    this.projectiles = [];
    this.winText = '';
    this.winTimer = 0;
    this.userInteracted = false;
    this.settingsOpen = false;
    this.audioSettingsUnsub = subscribeToAudioSettings((settings) => {
      this.audioSettings = settings;
    });
    this.joinCodeInput = '';
    this.joinInputActive = false;
    this.blurJoinHiddenInput();
    this.localSetup = null;

    this.partyError = '';
    this.partyStartFired = false;
    this.matchmaking = false;

    // Reload profile and name (picks up changes from ProfileScene)
    this.profile = loadProfile();
    this.playerName = loadPlayerName();

    // Re-derive tutorial state on scene re-entry (critical: state may have
    // changed since construction, e.g. after finishing match tutorial)
    refreshTutorialCache();
    this.menuTutorialActive = isMenuTutorial();
    this.menuTutorialStepStart = performance.now();

    // Sync profile changes to party (avatar, name) — picks up edits from ProfileScene
    if (this.party) {
      this.party.localName = this.playerName;
      if (this.profile) this.party.localAvatarId = this.profile.avatarId;
      this.partyState = this.party.state;
      this.party.removeListener(this.partyListener);
      this.party.addListener(this.partyListener);
    }

    const interactHandler = () => {
      this.userInteracted = true;
      this.menuMusic.startMenuMusic();
      this.musicPlayer.playMenu();
    };
    let lastClickTime = 0;
    this.clickHandler = (e: MouseEvent) => {
      interactHandler();
      if (this.dragJustEnded) { this.dragJustEnded = false; return; }
      // Suppress click if a touch just fired (Windows touch devices fire both)
      if (Date.now() - lastClickTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.handleClick(cx, cy);
    };
    this.contextMenuHandler = (e: MouseEvent) => {
      // Right-click on own race slot → cycle backwards
      if (!this.partyState && !this.localSetup) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this.partyState && this.party) {
        const pl = this.getPartyLayout();
        const ps = this.partyState;
        const localSlot = this.party.localSlotIndex;
        const maxSlots = ps.maxSlots ?? 4;
        // Right-click own slot → cycle race backward
        if (this.hitRect(cx, cy, pl.slotRects[localSlot])) {
          e.preventDefault();
          this.cycleRace(-1);
          this.menuMusic.playUIClick();
          return;
        }
        // Right-click on bot slot → cycle bot race
        if (this.party.isHost) {
          const partyActiveSet = new Set(getActiveSlots(ps));
          for (let i = 0; i < maxSlots; i++) {
            if (i === localSlot) continue;
            if (!partyActiveSet.has(i)) continue;
            if (this.hitRect(cx, cy, pl.slotRects[i])) {
              const hasPlayer = !!ps.players[String(i)];
              if (!hasPlayer && ps.bots?.[String(i)]) {
                e.preventDefault();
                this.cyclePartyBotRace(i);
                this.menuMusic.playUIClick();
                return;
              }
            }
          }
        }
      } else if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        const ls = this.localSetup;
        // Right-click own slot → cycle race backward
        if (this.hitRect(cx, cy, pl.slotRects[ls.playerSlot])) {
          e.preventDefault();
          this.cycleRace(-1);
          this.menuMusic.playUIClick();
          return;
        }
        // Right-click bot slot → cycle bot race
        const localActiveSet = new Set(getLocalActiveSlots(ls));
        for (let i = 0; i < ls.maxSlots; i++) {
          if (i === ls.playerSlot) continue;
          if (!localActiveSet.has(i)) continue;
          if (this.hitRect(cx, cy, pl.slotRects[i]) && ls.bots[String(i)]) {
            e.preventDefault();
            this.cycleBotRace(i);
            this.menuMusic.playUIClick();
            return;
          }
        }
      }
    };
    this.touchHandler = (e: TouchEvent) => {
      e.preventDefault();
      interactHandler();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const cy = touch.clientY - rect.top;
      // Start slider drag on touch
      const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
      if (this.sliderDrag.start(cx, cy, settingsLayout, this.settingsOpen)) return;
      lastClickTime = Date.now();
      this.handleClick(cx, cy);
    };
    this.touchMoveHandler = (e: TouchEvent) => {
      if (!this.sliderDrag.active) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = touch.clientX - rect.left;
      const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
      this.sliderDrag.move(cx, settingsLayout);
      this.menuMusic.playUISlider();
    };
    this.touchEndHandler = () => {
      this.sliderDrag.end();
    };
    this.keyHandler = (e: KeyboardEvent) => {
      interactHandler();
      if (this.settingsOpen && e.key === 'Escape') {
        this.settingsOpen = false;
        this.menuMusic.playUIClose();
        return;
      }
      // Ctrl+V paste — works even before join input is active
      if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        navigator.clipboard?.readText().then(text => {
          const cleaned = text.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
          if (cleaned.length >= 4) {
            this.joinInputActive = true;
            this.joinCodeInput = cleaned;
            this.focusJoinHiddenInput();
            this.doJoinParty();
          } else if (cleaned.length > 0) {
            this.joinInputActive = true;
            this.joinCodeInput = cleaned;
            this.focusJoinHiddenInput();
          }
        }).catch(() => {});
        return;
      }
      if (this.joinInputActive) {
        if (e.key === 'Escape') { this.menuMusic.playUIBack(); this.closeJoinInput(); return; }
        // Let hidden input handle all text input, Enter, and Backspace
        return;
      }
    };
    this.canvas.addEventListener('mousedown', interactHandler, { once: true });
    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    this.canvas.addEventListener('touchend', this.touchEndHandler);
    window.addEventListener('keydown', this.keyHandler);

    // Drag-and-drop handlers for party slot rearrangement + slider drag
    this.mouseDownHandler = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Settings slider drag
      const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
      if (this.sliderDrag.start(cx, cy, settingsLayout, this.settingsOpen)) return;

      // Local setup drag
      if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        for (let i = 0; i < this.localSetup.maxSlots; i++) {
          const sr = pl.slotRects[i];
          const pad = 15;
          if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
            // Can drag any occupied slot (player or bot)
            if (i === this.localSetup.playerSlot || this.localSetup.bots[String(i)]) {
              this.dragSlot = i;
              this.dragStartX = cx;
              this.dragStartY = cy;
              this.dragX = cx;
              this.dragY = cy;
              this.isDragging = false;
            }
            break;
          }
        }
        return;
      }

      // Firebase party drag (not during matchmaking)
      if (!this.partyState || !this.party?.isHost || this.matchmaking) return;
      const pl = this.getPartyLayout();
      for (let i = 0; i < (this.partyState.maxSlots ?? 4); i++) {
        const sr = pl.slotRects[i];
        const pad = 15;
        if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
          const hasPlayer = !!this.partyState.players[String(i)];
          if (hasPlayer) {
            this.dragSlot = i;
            this.dragStartX = cx;
            this.dragStartY = cy;
            this.dragX = cx;
            this.dragY = cy;
            this.isDragging = false;
          }
          break;
        }
      }
    };
    this.mouseMoveHandler = (e: MouseEvent) => {
      // Settings slider drag
      if (this.sliderDrag.active) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
        this.sliderDrag.move(cx, settingsLayout);
        this.menuMusic.playUISlider();
        return;
      }
      if (this.dragSlot < 0) return;
      const rect = this.canvas.getBoundingClientRect();
      this.dragX = e.clientX - rect.left;
      this.dragY = e.clientY - rect.top;
      // Start drag after moving 8px to distinguish from click
      if (!this.isDragging) {
        const dx = this.dragX - this.dragStartX;
        const dy = this.dragY - this.dragStartY;
        if (dx * dx + dy * dy > 64) this.isDragging = true;
      }
    };
    this.mouseUpHandler = (e: MouseEvent) => {
      if (this.sliderDrag.active) { this.sliderDrag.end(); return; }
      if (this.dragSlot < 0 || !this.isDragging) {
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }
      this.dragJustEnded = true;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Local setup drop
      if (this.localSetup) {
        const pl = this.getLocalSetupLayout();
        for (let i = 0; i < this.localSetup.maxSlots; i++) {
          if (i === this.dragSlot) continue;
          const sr = pl.slotRects[i];
          const pad = 15;
          if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
            this.localSetupSwapSlots(this.dragSlot, i);
            break;
          }
        }
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }

      // Firebase party drop
      if (!this.partyState || !this.party) {
        this.dragSlot = -1;
        this.isDragging = false;
        return;
      }
      const pl = this.getPartyLayout();
      for (let i = 0; i < (this.partyState.maxSlots ?? 4); i++) {
        if (i === this.dragSlot) continue;
        const sr = pl.slotRects[i];
        const pad = 15;
        if (cx >= sr.x - pad && cx <= sr.x + sr.w + pad && cy >= sr.y - pad && cy <= sr.y + sr.h + pad) {
          this.party.swapSlots(this.dragSlot, i);
          break;
        }
      }
      this.dragSlot = -1;
      this.isDragging = false;
    };
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseup', this.mouseUpHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.contextMenuHandler) this.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    if (this.touchHandler) this.canvas.removeEventListener('touchstart', this.touchHandler);
    if (this.touchMoveHandler) this.canvas.removeEventListener('touchmove', this.touchMoveHandler);
    if (this.touchEndHandler) this.canvas.removeEventListener('touchend', this.touchEndHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.mouseDownHandler) this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
    if (this.mouseMoveHandler) this.canvas.removeEventListener('mousemove', this.mouseMoveHandler);
    if (this.mouseUpHandler) this.canvas.removeEventListener('mouseup', this.mouseUpHandler);
    this.clickHandler = null;
    this.contextMenuHandler = null;
    this.touchHandler = null;
    this.touchMoveHandler = null;
    this.touchEndHandler = null;
    this.sliderDrag.end();
    this.keyHandler = null;
    this.mouseDownHandler = null;
    this.mouseMoveHandler = null;
    this.mouseUpHandler = null;
    this.audioSettingsUnsub?.();
    this.audioSettingsUnsub = null;
    this.blurJoinHiddenInput();
    this.menuMusic.stopMusic();
    this.menuMusic.disableTabSuspend();
    this.clearMatchmakingTimeout();
    if (this.party) {
      this.party.removeListener(this.partyListener);
    }
  }

  private partyStartFired = false;
  private partyListener = (s: PartyState | null) => {
    this.partyState = s;
    // Persist party config so custom game remembers mode/bots
    if (s && s.status === 'waiting' && this.party?.isHost) {
      const localSlot = this.party.localSlotIndex ?? 0;
      const mapDef = getMapById(s.mapId ?? 'duel');
      saveLocalSetup({
        mapId: s.mapId ?? 'duel',
        maxSlots: s.maxSlots ?? mapDef.maxPlayers,
        bots: s.bots ? { ...s.bots } : {},
        playerSlot: localSlot,
        playerRace: s.players[String(localSlot)]?.race ?? 'random',
        teamSize: s.teamSize ?? mapDef.playersPerTeam,
      });
    }
    if (s && s.status === 'starting' && this.onPartyStart && !this.partyStartFired) {
      this.partyStartFired = true;
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
      this.onPartyStart(s, this.party?.localSlotIndex ?? 0);
    }
    // Auto-start: when matchmaking and 2+ players present, host starts immediately
    if (s && getPartyPlayerCount(s) >= 2 && this.matchmaking && this.party?.isHost && s.status === 'waiting') {
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
      this.party.startGame();
    }
    // If we joined via matchmaking as guest, just wait for host to start (clear matchmaking flag)
    if (s && getPartyPlayerCount(s) >= 2 && this.matchmaking && !this.party?.isHost) {
      this.matchmaking = false;
      // Do NOT clear the matchmaking timeout — it's our safety net against ghost hosts.
      // If the host never starts, the timeout fires and cancelMatchmaking() leaves the party.
    }
    // Party destroyed while matchmaking or while waiting for ghost host to start
    if (!s && this.matchmaking) {
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
    }
  };

  // ─── Button layout ───

  private getButtonLayout(): {
    solo: { x: number; y: number; w: number; h: number };
    findGame: { x: number; y: number; w: number; h: number };
    create: { x: number; y: number; w: number; h: number };
    join: { x: number; y: number; w: number; h: number };
    gallery: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const btnW = Math.min(w * 0.52, 360);
    const btnH = Math.min(h * 0.07, 52);
    const gap = 10;
    const startY = h * 0.28;
    return {
      solo: { x: (w - btnW) / 2, y: startY, w: btnW, h: btnH },
      findGame: { x: (w - btnW) / 2, y: startY + btnH + gap, w: btnW, h: btnH },
      create: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 2, w: btnW, h: btnH },
      join: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 3, w: btnW, h: btnH },
      gallery: { x: (w - btnW) / 2, y: startY + (btnH + gap) * 4, w: btnW, h: btnH },
    };
  }

  private getPartyLayout(): {
    panel: { x: number; y: number; w: number; h: number };
    slotRects: { x: number; y: number; w: number; h: number }[];
    teamW: number;
    cellTop: number;
    cellBot: number;
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    code: { x: number; y: number; w: number; h: number };
    modeToggle: { x: number; y: number; w: number; h: number };
    fogToggle: { x: number; y: number; w: number; h: number };
    diffBtns: { x: number; y: number; w: number; h: number }[];
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const maxSlots = this.partyState?.maxSlots ?? 4;
    const mapDef = getMapById(this.partyState?.mapId ?? 'duel');
    const ppt = mapDef.playersPerTeam;
    const panelW = Math.min(w * 0.98, 720);
    const panelH = Math.min(h * 0.68, 500);
    const px = (w - panelW) / 2;
    const py = h * 0.26;

    // Mode toggle + fog toggle side by side
    const totalTogW = panelW * 0.72;
    const toggleGap = 8;
    const toggleW = totalTogW * 0.6;
    const fogW = totalTogW - toggleW - toggleGap;
    const toggleH = 24;
    const mapTogY = py + panelH * 0.17;
    const modeTogX = px + (panelW - totalTogW) / 2;

    // Two team columns with slots as rows
    const teamGap = 10;
    const teamW = (panelW - teamGap) / 2;
    const slotAreaTop = py + panelH * 0.26;
    const slotAreaBot = py + panelH * 0.73;
    const slotAreaH = slotAreaBot - slotAreaTop;
    const teamLabelH = 18;
    const rowGap = 4;
    const availH = slotAreaH - teamLabelH;
    const rowH = Math.min(60, (availH - (ppt - 1) * rowGap) / Math.max(1, ppt));

    const slotRects: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < maxSlots; i++) {
      const team = Math.floor(i / ppt);
      const row = i % ppt;
      const tx = px + team * (teamW + teamGap);
      const ry = slotAreaTop + teamLabelH + row * (rowH + rowGap);
      slotRects.push({ x: tx + 4, y: ry, w: teamW - 8, h: rowH });
    }

    // Difficulty buttons (host only, between slots and start button)
    const dbtnW = panelW * 0.18;
    const dbtnH = 22;
    const dbtnGap = 4;
    const dbtnTotalW = PARTY_DIFFICULTY_OPTIONS.length * dbtnW + (PARTY_DIFFICULTY_OPTIONS.length - 1) * dbtnGap;
    const dbtnStartX = px + (panelW - dbtnTotalW) / 2;
    const dbtnY = py + panelH * 0.76;
    const diffBtns = PARTY_DIFFICULTY_OPTIONS.map((_, idx) => ({
      x: dbtnStartX + idx * (dbtnW + dbtnGap),
      y: dbtnY,
      w: dbtnW,
      h: dbtnH,
    }));

    return {
      panel: { x: px, y: py, w: panelW, h: panelH },
      slotRects,
      teamW,
      cellTop: slotAreaTop,
      cellBot: slotAreaBot,
      leave: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      start: { x: px + panelW * 0.46, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      code: { x: px + panelW * 0.125, y: py + 2, w: panelW * 0.75, h: 52 },
      modeToggle: { x: modeTogX, y: mapTogY, w: toggleW, h: toggleH },
      fogToggle: { x: modeTogX + toggleW + toggleGap, y: mapTogY, w: fogW, h: toggleH },
      diffBtns,
    };
  }

  private getLocalSetupLayout(): {
    panel: { x: number; y: number; w: number; h: number };
    slotRects: { x: number; y: number; w: number; h: number }[];
    teamW: number;
    cellTop: number;
    cellBot: number;
    start: { x: number; y: number; w: number; h: number };
    leave: { x: number; y: number; w: number; h: number };
    modeToggle: { x: number; y: number; w: number; h: number };
    fogToggle: { x: number; y: number; w: number; h: number };
  } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const mapDef = getMapById(this.localSetup?.mapId ?? 'duel');
    const maxSlots = this.localSetup?.maxSlots ?? 4;
    const ppt = mapDef.playersPerTeam;
    const panelW = Math.min(w * 0.98, 616);
    const panelH = Math.min(h * 0.58, 420);
    const px = (w - panelW) / 2;
    const py = h * 0.26;

    // Mode toggle + fog toggle side by side
    const totalTogW = panelW * 0.72;
    const toggleGap = 8;
    const toggleW = totalTogW * 0.6;
    const fogW = totalTogW - toggleW - toggleGap;
    const toggleH = 24;
    const mapTogY = py + panelH * 0.12;
    const modeTogX = px + (panelW - totalTogW) / 2;

    // Two team columns with slots as rows
    const teamGap = 10;
    const teamW = (panelW - teamGap) / 2;
    const slotAreaTop = py + panelH * 0.26;
    const slotAreaBot = py + panelH * 0.80;
    const slotAreaH = slotAreaBot - slotAreaTop;
    const teamLabelH = 18;
    const rowGap = 4;
    const availH = slotAreaH - teamLabelH;
    const rowH = Math.min(60, (availH - (ppt - 1) * rowGap) / Math.max(1, ppt));

    const slotRects: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < maxSlots; i++) {
      const team = Math.floor(i / ppt);
      const row = i % ppt;
      const tx = px + team * (teamW + teamGap);
      const ry = slotAreaTop + teamLabelH + row * (rowH + rowGap);
      slotRects.push({ x: tx + 4, y: ry, w: teamW - 8, h: rowH });
    }

    return {
      panel: { x: px, y: py, w: panelW, h: panelH },
      slotRects,
      teamW,
      cellTop: slotAreaTop,
      cellBot: slotAreaBot,
      leave: { x: px + panelW * 0.15, y: py + panelH - 56, w: panelW * 0.28, h: 44 },
      start: { x: px + panelW * 0.46, y: py + panelH - 56, w: panelW * 0.42, h: 44 },
      modeToggle: { x: modeTogX, y: mapTogY, w: toggleW, h: toggleH },
      fogToggle: { x: modeTogX + toggleW + toggleGap, y: mapTogY, w: fogW, h: toggleH },
    };
  }

  private hitRect(cx: number, cy: number, r: { x: number; y: number; w: number; h: number }): boolean {
    // Inflate hit area by pad on each side for mobile tappability (min 44px targets)
    const pad = 6;
    return cx >= r.x - pad && cx <= r.x + r.w + pad && cy >= r.y - pad && cy <= r.y + r.h + pad;
  }

  /** Compute RACE and DIFF button rects for a bot slot, stacked on the right side. */
  private getBotSlotButtons(sr: { x: number; y: number; w: number; h: number }): {
    raceBtn: { x: number; y: number; w: number; h: number };
    diffBtn: { x: number; y: number; w: number; h: number };
  } {
    const btnW = 42;
    const btnH = Math.min(18, (sr.h - 6) / 2);
    const gap = 3;
    const btnX = sr.x + sr.w - btnW - 20; // leave room for X button
    const topY = sr.y + (sr.h - btnH * 2 - gap) / 2;
    return {
      raceBtn: { x: btnX, y: topY, w: btnW, h: btnH },
      diffBtn: { x: btnX, y: topY + btnH + gap, w: btnW, h: btnH },
    };
  }

  /** Red X button in top-right corner of a slot rect. */
  private getSlotRemoveBtn(sr: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
    const size = 16;
    return { x: sr.x + sr.w - size - 1, y: sr.y + 1, w: size, h: size };
  }

  /** Draw the red X remove button in the top-right corner of a slot. */
  private drawRemoveButton(ctx: CanvasRenderingContext2D, sr: { x: number; y: number; w: number; h: number }): void {
    const btn = this.getSlotRemoveBtn(sr);
    ctx.fillStyle = 'rgba(180,40,40,0.6)';
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,80,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 3);
    ctx.stroke();
    ctx.font = `bold ${btn.h * 0.7}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff6666';
    ctx.fillText('X', btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  private handleClick(cx: number, cy: number): void {
    // Ignore clicks shortly after entering (prevents mobile touch-through from other scenes)
    if (Date.now() - this.enterTime < 350) return;
    // Cancel reset ELO confirm if clicking anything other than the reset button
    if (this.resetEloConfirm && !this.hitRect(cx, cy, this.resetEloBtnRect)) {
      this.resetEloConfirm = false;
    }
    const settingsLayout = getSettingsOverlayLayout(this.canvas.clientWidth, this.canvas.clientHeight);
    if (hitOverlayRect(cx, cy, settingsLayout.button, 6)) {
      this.settingsOpen = !this.settingsOpen;
      if (this.settingsOpen) this.menuMusic.playUIOpen(); else this.menuMusic.playUIClose();
      return;
    }
    if (this.settingsOpen) {
      if (hitOverlayRect(cx, cy, settingsLayout.close, 8)) {
        this.settingsOpen = false;
        this.menuMusic.playUIClose();
        return;
      }
      if (hitOverlayRect(cx, cy, settingsLayout.musicRow)) {
        updateAudioSettings({ musicVolume: sliderValueFromPoint(cx, settingsLayout.musicRow) });
        this.menuMusic.playUISlider();
        return;
      }
      if (hitOverlayRect(cx, cy, settingsLayout.sfxRow)) {
        updateAudioSettings({ sfxVolume: sliderValueFromPoint(cx, settingsLayout.sfxRow) });
        this.menuMusic.playUISlider();
        return;
      }
      if (handleVisualToggleClick(cx, cy, settingsLayout)) { this.menuMusic.playUIToggle(); return; }
      if (hitOverlayRect(cx, cy, settingsLayout.panel)) return;
      this.settingsOpen = false;
      this.menuMusic.playUIClose();
    }

    // Duel control buttons (always active)
    if (this.hitRect(cx, cy, this.resetEloBtnRect)) {
      if (this.resetEloConfirm) {
        saveAllElo({});
        this.resetEloConfirm = false;
        this.menuMusic.playUIConfirm();
      } else {
        this.resetEloConfirm = true;
        this.menuMusic.playUIClick();
      }
      return;
    }
    // Any other duel button click cancels the reset confirm
    const hitAnyDuelBtn = this.hitRect(cx, cy, this.teamSizeBtnRect) || this.hitRect(cx, cy, this.tierBtnRect) || this.hitRect(cx, cy, this.raceLockBtnRect) || this.hitRect(cx, cy, this.typeFilterBtnRect);
    if (hitAnyDuelBtn) this.resetEloConfirm = false;
    if (this.hitRect(cx, cy, this.teamSizeBtnRect)) {
      this.duelTeamSize = this.duelTeamSize === 1 ? 2 : this.duelTeamSize === 2 ? 3 : 1;
      try { localStorage.setItem('lanecraft.duelTeamSize', String(this.duelTeamSize)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      this.menuMusic.playUIClick();
      return;
    }
    if (this.hitRect(cx, cy, this.tierBtnRect)) {
      this.duelTier = this.duelTier === 1 ? 2 : this.duelTier === 2 ? 3 : 1;
      try { localStorage.setItem('lanecraft.duelTier', String(this.duelTier)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      this.menuMusic.playUIClick();
      return;
    }
    if (this.hitRect(cx, cy, this.raceLockBtnRect)) {
      this.duelRaceLocked = !this.duelRaceLocked;
      try { localStorage.setItem('lanecraft.duelRaceLocked', String(this.duelRaceLocked)); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      this.menuMusic.playUIClick();
      return;
    }
    if (this.hitRect(cx, cy, this.typeFilterBtnRect)) {
      const cycle: Array<'Any' | 'Melee' | 'Ranged' | 'Caster'> = ['Any', 'Melee', 'Ranged', 'Caster'];
      const idx = cycle.indexOf(this.duelTypeFilter);
      this.duelTypeFilter = cycle[(idx + 1) % cycle.length];
      try { localStorage.setItem('lanecraft.duelTypeFilter', this.duelTypeFilter); } catch {}
      this.waiting = true;
      this.waitTimer = 0.5;
      this.blueTeam = [];
      this.redTeam = [];
      this.menuMusic.playUIClick();
      return;
    }

    // If in local setup mode, handle local setup UI
    if (this.localSetup) {
      // Profile button accessible from lobby
      if (this.hitRect(cx, cy, this.profileBtnRect)) {
        this.menuMusic.playUIClick();
        this.manager.switchTo('profile');
        return;
      }
      const pl = this.getLocalSetupLayout();
      const ls = this.localSetup;
      const localActiveSet = new Set(getLocalActiveSlots(ls));
      // Click own slot's race to cycle
      if (this.hitRect(cx, cy, pl.slotRects[ls.playerSlot])) {
        this.cycleRace();
        this.menuMusic.playUIClick();
        return;
      }
      // Click non-player slots: check X/RACE/DIFF buttons first, then cell for empty slots
      for (let i = 0; i < ls.maxSlots; i++) {
        if (i === ls.playerSlot) continue;
        if (!localActiveSet.has(i)) continue;
        const sr = pl.slotRects[i];
        if (!sr) continue;
        if (ls.bots[String(i)]) {
          // X button — remove bot
          const removeBtn = this.getSlotRemoveBtn(sr);
          if (this.hitRect(cx, cy, removeBtn)) {
            delete ls.bots[String(i)];
            if (ls.botRaces) delete ls.botRaces[String(i)];
            saveLocalSetup(ls);
            this.menuMusic.playUIClick();
            return;
          }
          // RACE and DIFF buttons
          const { raceBtn, diffBtn } = this.getBotSlotButtons(sr);
          if (this.hitRect(cx, cy, raceBtn)) {
            this.cycleBotRace(i);
            this.menuMusic.playUIClick();
            return;
          }
          if (this.hitRect(cx, cy, diffBtn)) {
            this.localSetupCycleDifficulty(i);
            this.menuMusic.playUIClick();
            return;
          }
        }
        // Click anywhere in cell on empty slot adds a bot
        if (this.hitRect(cx, cy, sr) && !ls.bots[String(i)]) {
          this.localSetupCycleBot(i);
          this.menuMusic.playUIClick();
          return;
        }
      }
      // Mode toggle (1v1 / 2v2 / 3v3)
      if (this.hitRect(cx, cy, pl.modeToggle)) {
        this.localSetupCycleMode();
        this.menuMusic.playUIClick();
        return;
      }
      // Fog of war toggle
      if (this.hitRect(cx, cy, pl.fogToggle)) {
        ls.fogOfWar = !(ls.fogOfWar ?? true);
        saveLocalSetup(ls);
        this.menuMusic.playUIToggle();
        return;
      }
      // Start button
      if (this.hitRect(cx, cy, pl.start) && canStartLocalSetup(ls)) {
        saveLocalSetup(ls);
        this.menuMusic.playUIConfirm();
        if (this.onLocalStart) this.onLocalStart(ls);
        this.localSetup = null;
        return;
      }
      // Leave / back button — save state so it's restored next time
      if (this.hitRect(cx, cy, pl.leave)) {
        saveLocalSetup(ls);
        this.menuMusic.playUIBack();
        this.localSetup = null;
        return;
      }
      return;
    }

    // If in a party (but not matchmaking), handle party UI
    if (this.partyState && !this.matchmaking) {
      // Profile button accessible from lobby
      if (this.hitRect(cx, cy, this.profileBtnRect)) {
        this.menuMusic.playUIClick();
        this.manager.switchTo('profile');
        return;
      }
      const pl = this.getPartyLayout();
      const ps = this.partyState;
      const isHost = this.party?.isHost;
      const localSlot = this.party?.localSlotIndex ?? 0;
      const maxSlots = ps.maxSlots ?? 4;
      // Click own slot to cycle race
      if (this.hitRect(cx, cy, pl.slotRects[localSlot])) {
        this.cycleRace();
        this.menuMusic.playUIClick();
        return;
      }
      // Host clicking non-local slots: X/RACE/DIFF buttons on bot slots, X on player slots, cell click for empty
      const partyActiveSet = new Set(getActiveSlots(ps));
      if (isHost) {
        for (let i = 0; i < maxSlots; i++) {
          if (i === localSlot) continue;
          if (!partyActiveSet.has(i)) continue;
          const sr = pl.slotRects[i];
          if (!sr) continue;
          const hasPlayer = !!ps.players[String(i)];
          const currentBot = ps.bots?.[String(i)] ?? null;
          // X button — remove bot
          if (currentBot) {
            const removeBtn = this.getSlotRemoveBtn(sr);
            if (this.hitRect(cx, cy, removeBtn)) {
              this.party?.setSlotBot(i, null);
              this.menuMusic.playUIClick();
              return;
            }
          }
          if (hasPlayer) continue;
          if (currentBot) {
            const { raceBtn, diffBtn } = this.getBotSlotButtons(sr);
            if (this.hitRect(cx, cy, raceBtn)) {
              this.cyclePartyBotRace(i);
              this.menuMusic.playUIClick();
              return;
            }
            if (this.hitRect(cx, cy, diffBtn)) {
              const cycle = [BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
              const curIdx = cycle.indexOf(currentBot as BotDifficultyLevel);
              this.party?.setSlotBot(i, cycle[(curIdx + 1) % cycle.length]);
              this.menuMusic.playUIClick();
              return;
            }
          }
          // Empty slot — click anywhere in cell adds a bot
          if (this.hitRect(cx, cy, sr) && !currentBot) {
            this.party?.setSlotBot(i, BotDifficultyLevel.Easy);
            this.menuMusic.playUIClick();
            return;
          }
        }
      }
      // Fog of war toggle (host only)
      if (isHost && this.hitRect(cx, cy, pl.fogToggle)) {
        const current = this.partyState.fogOfWar ?? true;
        this.party?.updateFogOfWar(!current);
        this.menuMusic.playUIToggle();
        return;
      }
      // Mode toggle (host only — cycle Duel → Battle → War)
      if (isHost && this.hitRect(cx, cy, pl.modeToggle)) {
        const mapDef = getMapById(this.partyState.mapId ?? 'duel');
        const currentTS = this.partyState.teamSize ?? mapDef.playersPerTeam;
        // Cycle: 1→2 (stay duel), 2→3 (skirmish), 3→4 (warzone), 4→1 (duel)
        if (currentTS === 1) {
          this.party?.updateTeamSize(2);
        } else if (currentTS === 2) {
          this.party?.updateMap('skirmish', 3);
        } else if (currentTS === 3) {
          this.party?.updateMap('warzone', 4);
        } else {
          this.party?.updateMap('duel', 1);
        }
        this.menuMusic.playUIClick();
        return;
      }
      if (isHost && this.hitRect(cx, cy, pl.start) && canStartParty(this.partyState)) {
        this.menuMusic.playUIConfirm();
        this.party?.startGame();
        return;
      }
      if (this.hitRect(cx, cy, pl.leave)) {
        this.menuMusic.playUIBack();
        this.party?.leaveParty();
        return;
      }
      // Click invite code to copy
      if (this.hitRect(cx, cy, pl.code)) {
        navigator.clipboard?.writeText(this.partyState.code).catch(() => {});
        this.copyFeedbackTimer = 120; // ~2s at 60fps
        this.menuMusic.playUIClick();
        return;
      }
      return;
    }

    // If join input is active, handle button clicks or dismiss
    if (this.joinInputActive) {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const jl = this.getJoinInputLayout(w, h);
      if (this.hitRect(cx, cy, jl.join) && this.joinCodeInput.length >= 4) {
        this.menuMusic.playUIConfirm();
        this.doJoinParty();
        return;
      }
      if (this.hitRect(cx, cy, jl.cancel)) {
        this.menuMusic.playUIBack();
        this.closeJoinInput();
        return;
      }
      // Tapping the code display area refocuses the hidden input (reopens keyboard)
      const codeArea = { x: jl.boxX, y: jl.boxY + jl.boxH * 0.35, w: jl.boxW, h: jl.boxH * 0.35 };
      if (this.hitRect(cx, cy, codeArea)) {
        this.focusJoinHiddenInput();
        return;
      }
      // Clicking outside the scroll + buttons area dismisses
      const fullH = (jl.cancel.y + jl.cancel.h) - jl.bgY;
      if (!this.hitRect(cx, cy, { x: jl.bgX, y: jl.bgY, w: jl.bgW, h: fullH })) {
        this.menuMusic.playUIBack();
        this.closeJoinInput();
      }
      return;
    }

    // Menu tutorial intercept (advances on any click, but doesn't block navigation)
    if (this.menuTutorialActive && this.handleMenuTutorialClick(cx, cy)) {
      return;
    }

    // Profile button
    if (this.hitRect(cx, cy, this.profileBtnRect)) {
      this.menuMusic.playUIClick();
      this.manager.switchTo('profile');
      return;
    }

    const btns = this.getButtonLayout();
    if (this.hitRect(cx, cy, btns.solo)) {
      this.menuMusic.playUIClick();
      this.manager.switchTo('raceSelect');
      return;
    }
    if (this.hitRect(cx, cy, btns.findGame)) {
      if (this.matchmaking) {
        this.menuMusic.playUIBack();
        this.cancelMatchmaking();
      } else {
        this.menuMusic.playUIClick();
        this.doFindGame();
      }
      return;
    }
    if (this.hitRect(cx, cy, btns.create) && !this.connecting) {
      this.menuMusic.playUIClick();
      this.doCreateParty();
      return;
    }
    if (this.hitRect(cx, cy, btns.gallery)) {
      this.menuMusic.playUIClick();
      this.manager.switchTo('gallery');
      return;
    }
    if (this.hitRect(cx, cy, btns.join)) {
      this.menuMusic.playUIOpen();
      this.openJoinInput();
      return;
    }
  }

  // ─── Party actions ───

  private firebaseInitPromise: Promise<void> | null = null;

  private ensureFirebase(): Promise<void> {
    if (this.firebaseReady) return Promise.resolve();
    if (!isFirebaseConfigured()) {
      this.showPartyError('Firebase not configured');
      return Promise.reject(new Error('Firebase not configured'));
    }
    // Deduplicate concurrent calls
    if (this.firebaseInitPromise) return this.firebaseInitPromise;
    this.firebaseInitPromise = initFirebase().then(() => {
      this.firebaseReady = true;
      if (!this.party) this.party = new PartyManager();
      this.party.addListener(this.partyListener);
      this.firebaseInitPromise = null;
    }).catch((err) => {
      this.firebaseInitPromise = null;
      console.error('[Firebase] Init failed:', err.code || '', err.message || err);
      this.showPartyError(err.code === 'auth/admin-restricted-operation'
        ? 'Enable Anonymous Auth in Firebase Console'
        : (err.message || 'Firebase error'));
      throw err;
    });
    return this.firebaseInitPromise;
  }

  private async doFindGame(): Promise<void> {
    if (this.matchmaking) return;
    this.connecting = true;
    this.matchmaking = true;
    this.matchmakingDots = 0;
    // Timeout: if no game starts within 60s, cancel and let the user know
    this.clearMatchmakingTimeout();
    this.matchmakingTimeout = setTimeout(() => {
      // Fire even if matchmaking flag was cleared (guest joined but host never started).
      // cancelMatchmaking will leave the ghost party.
      this.cancelMatchmaking();
      this.showPartyError('No players found — try again');
    }, 60_000);
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      if (this.profile) this.party!.localAvatarId = this.profile.avatarId;
      const lastRace = this.getLastPartyRace();
      const joined = await this.party!.findAndJoinGame(lastRace);
      if (!joined) {
        // No open games — create one and wait
        await this.party!.createParty(lastRace);
      }
      // Either joined or created — matchmaking stays true until party gets a guest or game starts
      // If we joined someone's party, matchmaking ends when partyListener fires
    } catch (e: any) {
      console.error('[Party] Find game failed:', e);
      this.showPartyError(e.message || 'Failed to find game');
      this.matchmaking = false;
      this.clearMatchmakingTimeout();
    } finally {
      this.connecting = false;
    }
  }

  private cancelMatchmaking(): void {
    this.matchmaking = false;
    this.clearMatchmakingTimeout();
    // Leave the background party we created while searching
    if (this.party && this.partyState) {
      this.party.leaveParty();
    }
  }

  private clearMatchmakingTimeout(): void {
    if (this.matchmakingTimeout) {
      clearTimeout(this.matchmakingTimeout);
      this.matchmakingTimeout = null;
    }
  }

  private getLastPartyRace(): Race {
    const saved = localStorage.getItem('lanecraft.lastPartyRace');
    if (saved && ALL_RACES.includes(saved as Race)) return saved as Race;
    return Race.Crown;
  }

  private async doCreateParty(): Promise<void> {
    this.connecting = true;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      if (this.profile) this.party!.localAvatarId = this.profile.avatarId;
      // Restore saved custom game settings (mode/map)
      const saved = loadLocalSetup();
      const mapId = saved?.mapId ?? 'duel';
      const teamSize = saved?.teamSize ?? 1;
      await this.party!.createParty(this.getLastPartyRace(), mapId);
      // Restore team size if different from map default
      if (teamSize !== getMapById(mapId).playersPerTeam) {
        await this.party!.updateTeamSize(teamSize);
      }
      // Restore saved bots and their races
      if (saved?.bots) {
        for (const [slot, difficulty] of Object.entries(saved.bots)) {
          const slotNum = Number(slot);
          if (slotNum !== (saved.playerSlot ?? 0)) {
            await this.party!.setSlotBot(slotNum, difficulty);
            const botRace = saved.botRaces?.[slot];
            if (botRace && botRace !== 'random') {
              await this.party!.setSlotBotRace(slotNum, botRace);
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[Party] Create failed:', e);
      // Fall back to local setup if Firebase isn't available
      this.localSetup = loadLocalSetup() ?? createDefaultLocalSetup();
    } finally {
      this.connecting = false;
    }
  }

  private localSetupCycleBot(slot: number): void {
    if (!this.localSetup) return;
    if (slot === this.localSetup.playerSlot) return; // can't replace yourself
    const current = this.localSetup.bots[String(slot)] ?? null;
    const cycle: (string | null)[] = [null, BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
    const curIdx = current ? cycle.indexOf(current) : 0;
    const nextIdx = (curIdx + 1) % cycle.length;
    const next = cycle[nextIdx];
    if (next) {
      this.localSetup.bots[String(slot)] = next;
    } else {
      delete this.localSetup.bots[String(slot)];
      // Clean up race when removing bot
      if (this.localSetup.botRaces) delete this.localSetup.botRaces[String(slot)];
    }
    saveLocalSetup(this.localSetup);
  }

  /** Cycle bot difficulty without removing — Easy→Med→Hard→Nightmare→Easy */
  private localSetupCycleDifficulty(slot: number): void {
    if (!this.localSetup) return;
    const current = this.localSetup.bots[String(slot)];
    if (!current) return;
    const cycle = [BotDifficultyLevel.Easy, BotDifficultyLevel.Medium, BotDifficultyLevel.Hard, BotDifficultyLevel.Nightmare];
    const curIdx = cycle.indexOf(current as BotDifficultyLevel);
    this.localSetup.bots[String(slot)] = cycle[(curIdx + 1) % cycle.length];
    saveLocalSetup(this.localSetup);
  }

  private localSetupSwapSlots(slotA: number, slotB: number): void {
    if (!this.localSetup || slotA === slotB) return;
    const botA = this.localSetup.bots[String(slotA)] ?? null;
    const botB = this.localSetup.bots[String(slotB)] ?? null;
    const isPlayerA = this.localSetup.playerSlot === slotA;
    const isPlayerB = this.localSetup.playerSlot === slotB;

    // Swap bots
    if (botA) this.localSetup.bots[String(slotB)] = botA; else delete this.localSetup.bots[String(slotB)];
    if (botB) this.localSetup.bots[String(slotA)] = botB; else delete this.localSetup.bots[String(slotA)];

    // Swap bot races
    if (this.localSetup.botRaces) {
      const raceA = this.localSetup.botRaces[String(slotA)] ?? null;
      const raceB = this.localSetup.botRaces[String(slotB)] ?? null;
      if (raceA) this.localSetup.botRaces[String(slotB)] = raceA; else delete this.localSetup.botRaces[String(slotB)];
      if (raceB) this.localSetup.botRaces[String(slotA)] = raceB; else delete this.localSetup.botRaces[String(slotA)];
    }

    // Swap player slot if involved
    if (isPlayerA) this.localSetup.playerSlot = slotB;
    else if (isPlayerB) this.localSetup.playerSlot = slotA;

    saveLocalSetup(this.localSetup);
  }

  private localSetupCycleMode(): void {
    if (!this.localSetup) return;
    const currentTS = this.localSetup.teamSize ?? 1;

    // Cycle: 1v1 (duel) → 2v2 (duel) → 3v3 (skirmish) → 4v4 (warzone) → 1v1 (duel)
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

    // Resolve player slot (may need to move if map changed)
    let playerSlot = this.localSetup.playerSlot;
    if (playerSlot >= nextMap.maxPlayers) playerSlot = 0;
    const playerTeam = Math.floor(playerSlot / ppt);

    // Build active slot set
    const newActiveSet = new Set<number>();
    for (let t = 0; t < nextMap.teams.length; t++) {
      for (let s = 0; s < newTS; s++) {
        newActiveSet.add(t * ppt + s);
      }
    }

    // Rebuild bots for new mode
    const oldBots = { ...this.localSetup.bots };
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

    // Preserve bot races for slots that still exist
    const oldBotRaces = this.localSetup.botRaces ?? {};
    const botRaces: { [slot: string]: string } = {};
    for (const [slot, race] of Object.entries(oldBotRaces)) {
      if (bots[slot]) botRaces[slot] = race;
    }

    // If player is in an inactive slot, move to first active slot on their team
    if (!newActiveSet.has(playerSlot)) {
      const myTeamSlots = [...newActiveSet].filter(s => Math.floor(s / ppt) === playerTeam);
      playerSlot = myTeamSlots[0] ?? 0;
    }

    this.localSetup = {
      mapId: newMapId,
      maxSlots: nextMap.maxPlayers,
      bots,
      botRaces: Object.keys(botRaces).length > 0 ? botRaces : undefined,
      playerSlot,
      playerRace: this.localSetup.playerRace,
      teamSize: newTS,
    };
    saveLocalSetup(this.localSetup);
  }

  private async doJoinParty(): Promise<void> {
    if (this.joinCodeInput.length < 4) return;
    this.connecting = true;
    try {
      await this.ensureFirebase();
      this.party!.localName = this.playerName;
      if (this.profile) this.party!.localAvatarId = this.profile.avatarId;
      await this.party!.joinParty(this.joinCodeInput, this.getLastPartyRace());
      this.closeJoinInput();
    } catch (e: any) {
      console.error('[Party] Join failed:', e);
      this.showPartyError(e.message || 'Failed to join');
    } finally {
      this.connecting = false;
    }
  }

  private openJoinInput(): void {
    this.joinInputActive = true;
    this.joinCodeInput = '';
    this.focusJoinHiddenInput();
  }

  private closeJoinInput(): void {
    this.joinInputActive = false;
    this.joinCodeInput = '';
    this.blurJoinHiddenInput();
  }

  private focusJoinHiddenInput(): void {
    if (!this.joinHiddenInput) {
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
        this.joinCodeInput = cleaned;
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && this.joinCodeInput.length >= 4) {
          this.doJoinParty();
        } else if (e.key === 'Escape') {
          this.closeJoinInput();
        }
      });
      document.body.appendChild(inp);
      this.joinHiddenInput = inp;
    }
    this.joinHiddenInput.value = this.joinCodeInput;
    this.joinHiddenInput.focus();
  }

  private blurJoinHiddenInput(): void {
    if (this.joinHiddenInput) {
      this.joinHiddenInput.blur();
      this.joinHiddenInput.remove();
      this.joinHiddenInput = null;
    }
  }

  private cycleRace(dir: number = 1): void {
    // Cycle order: Crown → Horde → ... → Tenders → Random → Crown → ...
    const raceOrder: (Race | 'random')[] = [...ALL_RACES, 'random'];
    if (this.localSetup) {
      const currentRace = this.localSetup.playerRace;
      const idx = raceOrder.indexOf(currentRace);
      this.localSetup.playerRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
      saveLocalSetup(this.localSetup);
      return;
    }
    if (!this.party || !this.partyState) return;
    const localSlot = this.party.localSlotIndex;
    const myPlayer = this.partyState.players[String(localSlot)];
    const currentRace = myPlayer?.race ?? Race.Crown;
    const idx = raceOrder.indexOf(currentRace);
    const nextRace = raceOrder[(idx + dir + raceOrder.length) % raceOrder.length];
    this.party.updateRace(nextRace as Race);
    localStorage.setItem('lanecraft.lastPartyRace', String(nextRace));
  }

  private cycleBotRace(slot: number): void {
    if (!this.localSetup) return;
    if (!this.localSetup.botRaces) this.localSetup.botRaces = {};
    const raceOrder: (string)[] = ['random', ...ALL_RACES];
    const current = this.localSetup.botRaces[String(slot)] ?? 'random';
    const idx = raceOrder.indexOf(current);
    const next = raceOrder[(idx + 1) % raceOrder.length];
    this.localSetup.botRaces[String(slot)] = next;
    saveLocalSetup(this.localSetup);
  }

  private cyclePartyBotRace(slot: number): void {
    if (!this.partyState || !this.party) return;
    const raceOrder: (string)[] = ['random', ...ALL_RACES];
    const current = this.partyState.botRaces?.[String(slot)] ?? 'random';
    const idx = raceOrder.indexOf(current);
    const next = raceOrder[(idx + 1) % raceOrder.length];
    this.party.setSlotBotRace(slot, next === 'random' ? null : next);
  }

  private showPartyError(msg: string): void {
    this.partyError = msg;
    this.partyErrorTimer = 3;
  }

  // Max ~20 characters per subtitle to fit the blue ribbon banner
  private static readonly SUBTITLES = [
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

  private spawnDuel(): void {
    this.blueTeam = [];
    this.redTeam = [];
    this.bannerBlue = [];
    this.bannerRed = [];

    // Rotate subtitle — "Spawn Glory" first, then random with roll animation
    this.subtitleIndex++;
    if (this.subtitleIndex > 0) {
      this.subtitlePrev = this.subtitle;
      const subs = TitleScene.SUBTITLES;
      this.subtitle = subs[Math.floor(Math.random() * subs.length)];
      this.subtitleRollTimer = TitleScene.SUBTITLE_ROLL_DUR;
    }

    // Determine allowed unit types based on type filter
    const allowedTypes = this.duelTypeFilter === 'Melee' ? [BuildingType.MeleeSpawner]
      : this.duelTypeFilter === 'Ranged' ? [BuildingType.RangedSpawner]
      : this.duelTypeFilter === 'Caster' ? [BuildingType.CasterSpawner]
      : UNIT_TYPES;

    // Pick team-wide race if race-locked
    const blueTeamRace = this.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;
    const redTeamRace = this.duelRaceLocked ? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)] : null;

    for (let i = 0; i < this.duelTeamSize; i++) {
      const blueRace = blueTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      const blueType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      // Ensure red side differs from blue (re-roll if same race+type)
      let redRace = redTeamRace ?? ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
      let redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
      let rerolls = 0;
      while (redRace === blueRace && redType === blueType && rerolls < 10) {
        if (!redTeamRace) redRace = ALL_RACES[Math.floor(Math.random() * ALL_RACES.length)];
        redType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
        rerolls++;
      }

      const bluePath = pickUpgradePath(this.duelTier);
      const redPath = pickUpgradePath(this.duelTier);
      const blueCount = getSpawnCountForUnit(blueRace, blueType, bluePath);
      const redCount = getSpawnCountForUnit(redRace, redType, redPath);
      for (let si = 0; si < blueCount; si++) {
        const u = createDuelUnit(blueRace, blueType, -2 - i * 2 - si * 0.6, false, 0, this.duelTier, bluePath);
        this.blueTeam.push(u);
        if (si === 0) this.bannerBlue.push(u); // one banner entry per spawn group
      }
      for (let si = 0; si < redCount; si++) {
        const u = createDuelUnit(redRace, redType, ARENA_WIDTH + 2 + i * 2 + si * 0.6, true, 2, this.duelTier, redPath);
        this.redTeam.push(u);
        if (si === 0) this.bannerRed.push(u); // one banner entry per spawn group
      }
    }
    this.projectiles = [];
    this.waiting = false;
    this.winnerLeaving = false;
    this.deadUnits = [];
    this.deathFade = 0;
    this.winText = '';
    this.winTimer = 0;
    this.winScale = 0;
    this.fightStartPlayed = false;
  }

  update(dt: number): void {
    this.pulseTime += dt;
    const dtSec = dt / 1000;
    this.animTime += dtSec;

    if (this.partyErrorTimer > 0) this.partyErrorTimer -= dtSec;
    if (this.copyFeedbackTimer > 0) this.copyFeedbackTimer--;
    if (this.subtitleRollTimer > 0) this.subtitleRollTimer -= dtSec;

    // Menu tutorial: refresh cache and handle timeout (before render)
    refreshTutorialCache();
    this.menuTutorialActive = isMenuTutorial();
    if (this.menuTutorialActive && performance.now() - this.menuTutorialStepStart > TUTORIAL_TIMEOUT_MS) {
      advanceTutorial();
      this.menuTutorialStepStart = performance.now();
      this.menuTutorialActive = isMenuTutorial();
    }

    // Animate win announcement
    if (this.winTimer > 0) {
      this.winTimer -= dtSec;
      this.winScale = Math.min(1, this.winScale + dtSec * 5);
    }

    if (this.waiting) {
      this.waitTimer -= dtSec;
      if (this.waitTimer <= 0) this.spawnDuel();
      return;
    }

    const allUnits = [...this.blueTeam, ...this.redTeam];

    // Decay attack animation timers
    for (const u of allUnits) {
      if (u.attackAnimTimer > 0) {
        u.attackAnimTimer -= dtSec;
        if (u.attackAnimTimer <= 0) u.isAttacking = false;
      }
    }

    // Play fight start sound when any pair is close enough
    if (!this.fightStartPlayed) {
      outer:
      for (const b of this.blueTeam) {
        if (!b.alive) continue;
        for (const r of this.redTeam) {
          if (!r.alive) continue;
          const dist = Math.abs(r.x - b.x);
          if (dist <= Math.max(b.range, r.range) + 1) {
            this.fightStartPlayed = true;
            if (this.userInteracted) this.sfx.playFightStart();
            break outer;
          }
        }
      }
    }

    if (this.winnerLeaving) {
      // Move all alive units off screen
      for (const u of allUnits) {
        if (u.alive) {
          const speed = getEffectiveSpeed(u);
          u.x += u.facingLeft ? -speed * dtSec : speed * dtSec;
        }
      }

      if (this.deathFade > 0) this.deathFade -= dtSec * 2;
      tickDuelProjectiles(this.projectiles, dtSec);

      const anyAlive = allUnits.some(u => u.alive);
      const allOffScreen = !allUnits.some(u => u.alive && u.x > -3 && u.x < ARENA_WIDTH + 3);
      const done = !anyAlive ? this.deathFade <= 0 : allOffScreen;

      if (done) {
        this.waiting = true;
        this.waitTimer = 3;
        this.blueTeam = [];
        this.redTeam = [];
        this.projectiles = [];
      }
      return;
    }

    // Run combat — each unit targets nearest enemy
    const blueAlive = this.blueTeam.filter(u => u.alive);
    const redAlive = this.redTeam.filter(u => u.alive);

    if (blueAlive.length > 0 && redAlive.length > 0) {
      // Record total HP for hit sounds
      const blueHpBefore = blueAlive.reduce((s, u) => s + u.hp, 0);
      const redHpBefore = redAlive.reduce((s, u) => s + u.hp, 0);

      for (const u of blueAlive) {
        const target = findNearestEnemy(u, redAlive);
        if (target) tickDuelCombat(u, target, dtSec, this.projectiles);
      }
      for (const u of redAlive) {
        const target = findNearestEnemy(u, blueAlive);
        if (target) tickDuelCombat(u, target, dtSec, this.projectiles);
      }
      const projHit = tickDuelProjectiles(this.projectiles, dtSec);
      for (const u of allUnits) {
        if (u.alive) tickDuelStatusEffects(u, dtSec);
      }

      // Play hit sounds
      if (this.userInteracted) {
        const blueHpAfter = blueAlive.reduce((s, u) => s + u.hp, 0);
        const redHpAfter = redAlive.reduce((s, u) => s + u.hp, 0);
        if (redHpAfter < redHpBefore) this.sfx.playHit();
        else if (blueHpAfter < blueHpBefore) this.sfx.playHit();
        else if (projHit) this.sfx.playHit();
      }

      // Check team deaths
      const blueStillAlive = this.blueTeam.filter(u => u.alive);
      const redStillAlive = this.redTeam.filter(u => u.alive);

      if (blueStillAlive.length === 0 || redStillAlive.length === 0) {
        const blueDead = blueStillAlive.length === 0;
        const redDead = redStillAlive.length === 0;

        if (blueDead && redDead) {
          updateTeamElo(this.blueTeam, this.redTeam, 'draw');
          this.winText = 'DRAW!';
          this.winColor = '#aaa';
          if (this.userInteracted) this.sfx.playDraw();
        } else if (redDead) {
          updateTeamElo(this.blueTeam, this.redTeam, 'a');
          const blueRaceName = this.bannerBlue[0].race.charAt(0).toUpperCase() + this.bannerBlue[0].race.slice(1);
          this.winText = this.duelTeamSize === 1 ? `${this.blueTeam[0].name} WINS!`
            : this.duelRaceLocked ? `${blueRaceName} WINS!` : 'BLUE WINS!';
          this.winColor = '#4488ff';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        } else {
          updateTeamElo(this.blueTeam, this.redTeam, 'b');
          const redRaceName = this.bannerRed[0].race.charAt(0).toUpperCase() + this.bannerRed[0].race.slice(1);
          this.winText = this.duelTeamSize === 1 ? `${this.redTeam[0].name} WINS!`
            : this.duelRaceLocked ? `${redRaceName} WINS!` : 'RED WINS!';
          this.winColor = '#ff4444';
          if (this.userInteracted) { this.sfx.playKill(); this.sfx.playWin(); }
        }

        this.winTimer = 2.5;
        this.winScale = 0;
        this.deadUnits = allUnits.filter(u => !u.alive);
        this.deathFade = 1;
        this.winnerLeaving = true;

        // Track duel completion for achievements
        if (this.profile) {
          for (const duelAchId of ['duel_watcher', 'duel_fan', 'duel_addict']) {
            const unlocked = checkNonMatchAchievement(this.profile, duelAchId);
            if (unlocked) {
              const def = ACHIEVEMENTS.find(a => a.id === unlocked);
              if (def) this.manager.showToast(`Achievement: ${def.name}`, def.desc);
            }
          }
        }
      }
    }
  }

  private tileToScreen(tileX: number, w: number): number {
    const margin = w * 0.08;
    const arenaW = w - margin * 2;
    return margin + (tileX / ARENA_WIDTH) * arenaW;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = ctx.canvas.clientWidth;
    const h = ctx.canvas.clientHeight;
    ctx.imageSmoothingEnabled = false;

    // Clean background: sky gradient + solid grass ground
    const groundY = h * 0.82;

    // Sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(1, '#c4e4f0');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    // Ground
    const grassGrad = ctx.createLinearGradient(0, groundY, 0, h);
    grassGrad.addColorStop(0, '#5a9a3e');
    grassGrad.addColorStop(0.15, '#4a8c34');
    grassGrad.addColorStop(1, '#3d7a2c');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    ctx.fillStyle = '#6aad4a';
    ctx.fillRect(0, groundY, w, 2);

    // Draw units — feet anchored ON the ground line
    const unitSize = Math.max(48, Math.min(w / 6, 80));
    const unitBaseY = groundY;
    const frameTick = Math.floor(this.animTime * 20);

    // Draw dead units (fading) first, then living
    if (this.deadUnits.length > 0 && this.deathFade > 0) {
      ctx.globalAlpha = Math.max(0, this.deathFade);
      for (const du of this.deadUnits) this.drawDuelUnit(ctx, du, unitSize, unitBaseY, frameTick, w);
      ctx.globalAlpha = 1;
    }

    for (const u of this.blueTeam) {
      if (u.alive) this.drawDuelUnit(ctx, u, unitSize, unitBaseY, frameTick, w);
    }
    for (const u of this.redTeam) {
      if (u.alive) this.drawDuelUnit(ctx, u, unitSize, unitBaseY, frameTick, w);
    }

    // Draw projectiles
    for (const p of this.projectiles) {
      this.drawDuelProjectile(ctx, p, unitBaseY, unitSize, w);
    }

    // Vignette
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // === VS Banner (uses bannerBlue/bannerRed to persist between fights) ===
    if (this.bannerBlue.length > 0 && this.bannerRed.length > 0) {
      const teamSize = this.bannerBlue.length;
      const vsY = groundY + 4;
      const lineH = teamSize === 1 ? 0 : Math.max(12, Math.min(h * 0.025, 16));
      const vsH = Math.max(44, Math.min(h * 0.08, 56)) + lineH * (teamSize - 1);
      const vsW = Math.min(w * 0.85, 480);
      const vsX = (w - vsW) / 2;

      const vsPadX = Math.round(vsW * 0.075);
      const vsPadY = Math.round(vsH * 0.075);
      this.ui.drawWoodTable(ctx, vsX - vsPadX, vsY - vsPadY, vsW + vsPadX * 2, vsH + vsPadY * 2);

      const fontSize = Math.max(11, Math.min(vsH / (teamSize + 1) * 0.45, 14));
      ctx.textBaseline = 'middle';

      for (let i = 0; i < teamSize; i++) {
        const blue = this.bannerBlue[i];
        const red = this.bannerRed[i];
        const rowY = vsY + vsH * (0.22 + 0.56 * i / Math.max(1, teamSize));

        const blueColor = RACE_COLORS[blue.race].primary;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'right';
        ctx.fillStyle = blue.alive ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';
        ctx.fillText(blue.name, w / 2 - fontSize * 1.2 + 1, rowY + 1);
        ctx.fillStyle = blue.alive ? blueColor : 'rgba(128,128,128,0.5)';
        ctx.fillText(blue.name, w / 2 - fontSize * 1.2, rowY);
        if (!blue.alive) {
          const tw = ctx.measureText(blue.name).width;
          ctx.strokeStyle = 'rgba(255,60,60,0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(w / 2 - fontSize * 1.2 - tw - 2, rowY);
          ctx.lineTo(w / 2 - fontSize * 1.2 + 2, rowY);
          ctx.stroke();
        }

        if (i === 0) {
          ctx.textAlign = 'center';
          ctx.font = `bold ${Math.round(fontSize * 1.3)}px monospace`;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText('VS', w / 2 + 1, rowY + 1);
          ctx.fillStyle = '#fff';
          ctx.fillText('VS', w / 2, rowY);
        }

        const redColor = RACE_COLORS[red.race].primary;
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'left';
        ctx.fillStyle = red.alive ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';
        ctx.fillText(red.name, w / 2 + fontSize * 1.2 + 1, rowY + 1);
        ctx.fillStyle = red.alive ? redColor : 'rgba(128,128,128,0.5)';
        ctx.fillText(red.name, w / 2 + fontSize * 1.2, rowY);
        if (!red.alive) {
          const tw = ctx.measureText(red.name).width;
          ctx.strokeStyle = 'rgba(255,60,60,0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(w / 2 + fontSize * 1.2 - 2, rowY);
          ctx.lineTo(w / 2 + fontSize * 1.2 + tw + 2, rowY);
          ctx.stroke();
        }
      }

      // Team avg ELO
      const eloY = vsY + vsH * 0.85;
      const eloFontSize = Math.max(11, fontSize * 0.7);
      ctx.font = `${eloFontSize}px monospace`;
      const blueAvgElo = Math.round(this.bannerBlue.reduce((s, u) => s + getElo(u.race, u.category, u.upgradeNode), 0) / teamSize);
      const redAvgElo = Math.round(this.bannerRed.reduce((s, u) => s + getElo(u.race, u.category, u.upgradeNode), 0) / teamSize);
      const blueFavored = blueAvgElo > redAvgElo;
      const redFavored = redAvgElo > blueAvgElo;
      const eloLabel = teamSize > 1 ? 'avg ' : '';

      ctx.textAlign = 'right';
      ctx.fillStyle = blueFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(`${blueFavored ? '\u2713 ' : ''}${eloLabel}${blueAvgElo}`, w / 2 - fontSize * 1.2, eloY);
      ctx.textAlign = 'left';
      ctx.fillStyle = redFavored ? '#ffe082' : 'rgba(255,255,255,0.6)';
      ctx.fillText(`${eloLabel}${redAvgElo}${redFavored ? ' \u2713' : ''}`, w / 2 + fontSize * 1.2, eloY);

      // === Duel control buttons ===
      const ctrlY = vsY + vsH + 6;
      const ctrlH = Math.max(20, Math.min(h * 0.035, 28));
      const ctrlW = Math.max(56, Math.min(w * 0.14, 80));
      const ctrlGap = 8;
      const totalCtrlW = ctrlW * 5 + ctrlGap * 4;
      const ctrlStartX = (w - totalCtrlW) / 2;
      const ctrlFont = Math.max(11, Math.min(ctrlH * 0.42, 12));

      const drawCtrlBtn = (x: number, label: string, strokeColor: string, textColor: string) => {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.roundRect(x, ctrlY, ctrlW, ctrlH, 4); ctx.fill();
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x, ctrlY, ctrlW, ctrlH, 4); ctx.stroke();
        ctx.font = `bold ${ctrlFont}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.fillText(label, x + ctrlW / 2, ctrlY + ctrlH / 2);
      };

      this.resetEloBtnRect = { x: ctrlStartX, y: ctrlY, w: ctrlW, h: ctrlH };
      const resetLabel = this.resetEloConfirm ? 'SURE?' : 'RESET';
      const resetStroke = this.resetEloConfirm ? 'rgba(255,40,40,0.8)' : 'rgba(255,80,80,0.5)';
      const resetText = this.resetEloConfirm ? '#ff4444' : '#ff8a80';
      drawCtrlBtn(ctrlStartX, resetLabel, resetStroke, resetText);

      const tsX = ctrlStartX + ctrlW + ctrlGap;
      this.teamSizeBtnRect = { x: tsX, y: ctrlY, w: ctrlW, h: ctrlH };
      drawCtrlBtn(tsX, `${this.duelTeamSize}v${this.duelTeamSize}`, 'rgba(100,180,255,0.5)', '#80d8ff');

      const trX = tsX + ctrlW + ctrlGap;
      this.tierBtnRect = { x: trX, y: ctrlY, w: ctrlW, h: ctrlH };
      drawCtrlBtn(trX, `TIER ${this.duelTier}`, 'rgba(255,215,0,0.5)', '#ffe082');

      const rlX = trX + ctrlW + ctrlGap;
      this.raceLockBtnRect = { x: rlX, y: ctrlY, w: ctrlW, h: ctrlH };
      const rlOn = this.duelRaceLocked;
      drawCtrlBtn(rlX, rlOn ? 'LOCKED' : 'MIXED', rlOn ? 'rgba(180,130,255,0.5)' : 'rgba(120,120,120,0.5)', rlOn ? '#ce93d8' : '#999');

      const tfX = rlX + ctrlW + ctrlGap;
      this.typeFilterBtnRect = { x: tfX, y: ctrlY, w: ctrlW, h: ctrlH };
      const tfColors: Record<string, [string, string]> = {
        'Any': ['rgba(120,120,120,0.5)', '#999'],
        'Melee': ['rgba(255,120,80,0.5)', '#ff8a65'],
        'Ranged': ['rgba(80,200,120,0.5)', '#81c784'],
        'Caster': ['rgba(100,140,255,0.5)', '#90caf9'],
      };
      const [tfStroke, tfText] = tfColors[this.duelTypeFilter];
      drawCtrlBtn(tfX, this.duelTypeFilter.toUpperCase(), tfStroke, tfText);
    }

    // === Win announcement ===
    if (this.winTimer > 0 && this.winText) {
      const scale = 0.5 + 0.5 * Math.min(1, this.winScale);
      const announceSize = Math.max(18, Math.min(w / 12, 36));

      ctx.save();
      ctx.translate(w / 2, groundY - unitSize * 1.3);
      ctx.scale(scale, scale);

      ctx.font = `bold ${announceSize}px monospace`;
      const textW = ctx.measureText(this.winText).width;
      const pillW = textW + announceSize * 2;
      const pillH = announceSize * 1.8;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      const r = pillH / 2;
      ctx.moveTo(-pillW / 2 + r, -pillH / 2);
      ctx.lineTo(pillW / 2 - r, -pillH / 2);
      ctx.arc(pillW / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-pillW / 2 + r, pillH / 2);
      ctx.arc(-pillW / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
      ctx.fill();

      ctx.strokeStyle = this.winColor;
      ctx.shadowColor = this.winColor;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(this.winText, 1, 1);
      ctx.fillStyle = this.winColor;
      ctx.fillText(this.winText, 0, 0);

      ctx.restore();
    }

    // === UI Elements ===

    // Title banner
    const bannerW = Math.min(w * 0.75, 550);
    const bannerH = Math.min(h * 0.18, 140);
    const bannerX = (w - bannerW) / 2;
    const bannerY = h * 0.04;
    this.ui.drawBanner(ctx, bannerX, bannerY, bannerW, bannerH);

    const titleSize = Math.max(20, Math.min(bannerW / 10, 44));
    ctx.font = `bold ${titleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText('LANECRAFT', w / 2 + 2, bannerY + bannerH * 0.45 + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('LANECRAFT', w / 2, bannerY + bannerH * 0.45);

    // Subtitle
    const subW = Math.min(w * 0.62, 420);
    const subH = Math.min(h * 0.055, 40);
    const subX = (w - subW) / 2;
    const subY = bannerY + bannerH - subH * 0.2;
    this.ui.drawSmallRibbon(ctx, subX, subY, subW, subH, 0);
    const subFontSize = Math.max(11, subH * 0.38);
    ctx.font = `bold ${subFontSize}px monospace`;
    ctx.textBaseline = 'middle';
    const subCenterY = subY + subH * 0.5;
    if (this.subtitleRollTimer > 0) {
      // Roll animation: old text slides up and fades out, new text slides up from below
      const t = 1 - this.subtitleRollTimer / TitleScene.SUBTITLE_ROLL_DUR; // 0→1
      const ease = t * t * (3 - 2 * t); // smoothstep
      const offset = subH * 0.6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(subX, subY, subW, subH);
      ctx.clip();
      // Old text sliding up
      ctx.globalAlpha = 1 - ease;
      ctx.fillStyle = '#fff';
      ctx.fillText(this.subtitlePrev, w / 2, subCenterY - offset * ease);
      // New text sliding up from below
      ctx.globalAlpha = ease;
      ctx.fillText(this.subtitle, w / 2, subCenterY + offset * (1 - ease));
      ctx.restore();
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText(this.subtitle, w / 2, subCenterY);
    }

    // === Buttons or Party Panel ===
    if (this.localSetup) {
      this.renderLocalSetupPanel(ctx, w, h);
    } else if (this.partyState && !this.matchmaking) {
      this.renderPartyPanel(ctx, w, h);
    } else if (this.joinInputActive) {
      this.renderJoinInput(ctx, w, h);
    } else {
      this.renderMenuButtons(ctx, w, h);
    }

    const settingsLayout = getSettingsOverlayLayout(w, h);
    drawSettingsButton(ctx, this.ui, settingsLayout.button, this.settingsOpen);
    if (this.settingsOpen) drawSettingsOverlay(ctx, this.ui, settingsLayout, this.audioSettings);

    // Party error toast
    if (this.partyError && this.partyErrorTimer > 0) {
      const errAlpha = Math.min(1, this.partyErrorTimer);
      ctx.globalAlpha = errAlpha;
      const errW = Math.min(w * 0.6, 360);
      const errH = 36;
      const errX = (w - errW) / 2;
      const errY = h * 0.70;
      this.ui.drawBigRibbon(ctx, errX, errY, errW, errH, 1); // red ribbon
      ctx.font = `bold ${Math.max(11, errH * 0.36)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(this.partyError, w / 2, errY + errH * 0.5);
      ctx.globalAlpha = 1;
    }

    // Player name + dice button
    this.renderNameTag(ctx, w, h);

    // === "Now Playing" track name (bottom-left) ===
    if (this.nowPlayingName) {
      const elapsed = performance.now() - this.nowPlayingStart;
      const total = TitleScene.NP_SHOW_MS + TitleScene.NP_FADE_MS;
      if (elapsed < total) {
        const alpha = elapsed < TitleScene.NP_SHOW_MS
          ? 1
          : 1 - (elapsed - TitleScene.NP_SHOW_MS) / TitleScene.NP_FADE_MS;
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff';
        ctx.fillText(`♪ ${this.nowPlayingName}`, 10, h - 12);
        ctx.restore();
      }
    }

    // Menu tutorial overlay
    this.drawMenuTutorial(ctx, w, h);

    // Version
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.max(11, Math.min(w / 60, 14))}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(`build ${__BUILD_NUMBER__} (${__BUILD_HASH__})`, w / 2, h - 12);
  }

  // ─── Render: Main menu buttons ───

  private renderMenuButtons(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const btns = this.getButtonLayout();
    const pulse = 0.6 + 0.4 * Math.sin(this.pulseTime / 500);
    const r = (i: number) => UIAssets.swordReveal(this.pulseTime, i);

    // PLAY SOLO — blue sword (pulsing)
    const r0 = r(0);
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 400));
    const ox0 = this.ui.drawSword(ctx, btns.solo.x, btns.solo.y, btns.solo.w, btns.solo.h, 0, r0);
    ctx.shadowBlur = 0;
    if (r0 > 0) this.drawSwordLabel(ctx, btns.solo, 'PLAY SOLO', pulse * r0, ox0);

    // FIND GAME — red sword (pulsing when searching)
    const r1 = r(1);
    if (this.matchmaking) {
      this.matchmakingDots = (this.matchmakingDots + 0.02) % 4;
      const dots = '.'.repeat(Math.floor(this.matchmakingDots));
      ctx.shadowColor = '#ff9800';
      ctx.shadowBlur = 12 * (0.3 + 0.3 * Math.sin(this.pulseTime / 300));
      const ox1 = this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1, r1);
      ctx.shadowBlur = 0;
      if (r1 > 0) this.drawSwordLabel(ctx, btns.findGame, `SEARCHING${dots}`, (0.6 + 0.4 * Math.sin(this.pulseTime / 300)) * r1, ox1);
    } else {
      const ox1 = this.ui.drawSword(ctx, btns.findGame.x, btns.findGame.y, btns.findGame.w, btns.findGame.h, 1, r1);
      if (r1 > 0) this.drawSwordLabel(ctx, btns.findGame, 'FIND GAME', r1, ox1);
    }

    // CUSTOM GAME — yellow sword (show connecting feedback)
    const r2 = r(2);
    if (this.connecting && !this.matchmaking) {
      ctx.shadowColor = '#ffd740';
      ctx.shadowBlur = 10 * (0.3 + 0.3 * Math.sin(this.pulseTime / 300));
      const ox2 = this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2, r2);
      ctx.shadowBlur = 0;
      const dots = '.'.repeat(Math.floor((this.pulseTime / 200) % 4));
      if (r2 > 0) this.drawSwordLabel(ctx, btns.create, `CONNECTING${dots}`, (0.6 + 0.4 * Math.sin(this.pulseTime / 300)) * r2, ox2);
    } else {
      const ox2 = this.ui.drawSword(ctx, btns.create.x, btns.create.y, btns.create.w, btns.create.h, 2, r2);
      if (r2 > 0) this.drawSwordLabel(ctx, btns.create, 'CUSTOM GAME', r2, ox2);
    }

    // JOIN PARTY — purple sword
    const r3 = r(3);
    const ox3 = this.ui.drawSword(ctx, btns.join.x, btns.join.y, btns.join.w, btns.join.h, 3, r3);
    if (r3 > 0) this.drawSwordLabel(ctx, btns.join, 'JOIN PARTY', r3, ox3);

    // UNIT GALLERY — dark sword
    const r4 = r(4);
    const ox4 = this.ui.drawSword(ctx, btns.gallery.x, btns.gallery.y, btns.gallery.w, btns.gallery.h, 4, r4);
    if (r4 > 0) this.drawSwordLabel(ctx, btns.gallery, 'UNIT GALLERY', r4, ox4);
  }

  private drawSwordLabel(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    text: string,
    alpha: number,
    offsetX = 0,
  ): void {
    const fontSize = Math.max(11, Math.min(rect.h * 0.32, 18));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    const tx = rect.x + rect.w * 0.52 + offsetX;
    const ty = rect.y + rect.h * 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(text, tx + 1, ty + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, tx, ty);
    ctx.globalAlpha = 1;
  }

  // ─── Menu tutorial overlay ───

  private getMenuTutorialTargetRect(w: number, h: number): { x: number; y: number; w: number; h: number } | null {
    const info = getMenuTutorialInfo();
    if (!info) return null;
    const btns = this.getButtonLayout();
    switch (info.target) {
      case 'profile': return this.profileBtnRect;
      case 'solo': return btns.solo;
      case 'findGame': return btns.findGame;
      case 'custom': return btns.create;
      case 'join': return btns.join;
      case 'gallery': return btns.gallery;
      case 'duel': {
        // Duel area = the bottom portion of the screen where units fight
        const groundY = h * 0.82;
        const margin = w * 0.08;
        return { x: margin, y: groundY - 60, w: w - margin * 2, h: h - (groundY - 60) };
      }
      default: return null;
    }
  }

  private drawMenuTutorial(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.menuTutorialActive) return;

    const info = getMenuTutorialInfo();
    if (!info) return;

    const targetRect = this.getMenuTutorialTargetRect(w, h);
    const pad = 8;

    // Dim overlay with spotlight cutout (four rects around the hole)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    if (targetRect) {
      const hx = targetRect.x - pad;
      const hy = targetRect.y - pad;
      const hw = targetRect.w + pad * 2;
      const hh = targetRect.h + pad * 2;
      if (hy > 0) ctx.fillRect(0, 0, w, hy);
      if (hy + hh < h) ctx.fillRect(0, hy + hh, w, h - (hy + hh));
      if (hx > 0) ctx.fillRect(0, hy, hx, hh);
      if (hx + hw < w) ctx.fillRect(hx + hw, hy, w - (hx + hw), hh);
      // Glow border
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
      ctx.strokeStyle = `rgba(255, 215, 64, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(hx, hy, hw, hh, 8);
      ctx.stroke();
    } else {
      ctx.fillRect(0, 0, w, h);
    }

    // Popup bubble — sized to fit content, positioned to not overlap highlight
    const bodyLines = info.body.split('\n');
    const popupW = Math.min(280, w - 40);
    // title(26) + gap(10) + bodyLines*17 + gap(10) + skipLink(16) + padding(8)
    const popupH = 26 + 10 + bodyLines.length * 17 + 10 + 16 + 8;
    let popupX: number;
    let popupY: number;
    if (targetRect) {
      const targetCx = targetRect.x + targetRect.w / 2;
      // Default: place to the right of the target
      popupX = targetRect.x + targetRect.w + 16;
      popupY = targetRect.y + (targetRect.h - popupH) / 2;
      // If it doesn't fit on the right, try left
      if (popupX + popupW > w - 10) {
        popupX = targetRect.x - popupW - 16;
      }
      // If it doesn't fit on either side (wide targets like duel area), go above
      if (popupX < 10) {
        popupX = targetCx - popupW / 2;
        popupY = targetRect.y - popupH - 16;
      }
      // If above doesn't fit, go below
      if (popupY < 10) {
        popupY = targetRect.y + targetRect.h + 16;
      }
    } else {
      popupX = (w - popupW) / 2;
      popupY = h * 0.4;
    }
    popupY = Math.max(10, Math.min(popupY, h - popupH - 10));
    popupX = Math.max(10, Math.min(popupX, w - popupW - 10));

    // Background
    ctx.fillStyle = 'rgba(20, 15, 10, 0.92)';
    ctx.beginPath();
    ctx.roundRect(popupX, popupY, popupW, popupH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(popupX, popupY, popupW, popupH, 10);
    ctx.stroke();

    // Title
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(info.title, popupX + popupW / 2, popupY + 26);

    // Body
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '13px monospace';
    const lines = info.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], popupX + popupW / 2, popupY + 48 + i * 17);
    }

    // "Next" button
    const nextW = 56;
    const nextH = 24;
    const nextX = popupX + popupW - nextW - 8;
    const nextY = popupY + 6;
    ctx.fillStyle = 'rgba(255, 215, 64, 0.2)';
    ctx.beginPath();
    ctx.roundRect(nextX, nextY, nextW, nextH, 4);
    ctx.fill();
    ctx.fillStyle = '#ffd740';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('Next', nextX + nextW / 2, nextY + 16);
    // "Skip Tutorial" link
    ctx.fillStyle = '#777';
    ctx.font = '11px monospace';
    ctx.fillText('Skip Tutorial', popupX + popupW / 2, popupY + popupH - 6);
    const skipAllW = ctx.measureText('Skip Tutorial').width;
    this.menuTutorialSkipAllRect = {
      x: popupX + popupW / 2 - skipAllW / 2,
      y: popupY + popupH - 18,
      w: skipAllW,
      h: 16,
    };

    ctx.textAlign = 'start';
  }

  private handleMenuTutorialClick(cx: number, cy: number): boolean {
    if (!this.menuTutorialActive) return false;

    // "Skip Tutorial" link (check first — most destructive)
    if (this.menuTutorialSkipAllRect) {
      const r = this.menuTutorialSkipAllRect;
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        skipTutorial();
        this.menuTutorialActive = false;
        return true;
      }
    }

    // "Next" button or any other click advances to next step.
    // This ensures the user is NEVER trapped — every click dismisses.
    advanceTutorial();
    this.menuTutorialStepStart = performance.now();
    this.menuTutorialActive = isMenuTutorial();
    return true;
  }

  // ─── Render: Player name tag ───

  private renderNameTag(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const fontSize = Math.max(12, Math.min(_w / 40, 16));
    const nameH = fontSize + 8;
    const baseAvatarSize = nameH * 2;
    const avatarSize = Math.round(baseAvatarSize * 1.3);  // 30% bigger

    // Positions — avatar top-left, name underneath
    const avatarX = 8;
    const avatarY = 8 + getSafeTop();

    // ── Profile avatar button (square) ──
    this.profileBtnRect = { x: avatarX, y: avatarY, w: avatarSize, h: avatarSize };

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(avatarX, avatarY, avatarSize, avatarSize, 6);
    ctx.stroke();

    // Draw avatar sprite
    if (this.profile) {
      const avatarDef = ALL_AVATARS.find(a => a.id === this.profile!.avatarId);
      if (avatarDef) {
        const sprData = this.sprites.getUnitSprite(avatarDef.race, avatarDef.category, 0, false, avatarDef.upgradeNode);
        if (sprData) {
          const [img, def] = sprData;
          const frame = getSpriteFrame(Math.floor(this.pulseTime / 50), def);
          const aspect = def.frameW / def.frameH;
          const sprInset = 4;
          const sprSize = avatarSize - sprInset * 2;
          // Apply sprite scale so avatars match in-game relative sizes
          const sprScale = def.scale ?? 1.0;
          const drawH = sprSize * sprScale;
          const drawW = drawH * aspect;
          const gY = def.groundY ?? 0.71;
          const feetY = avatarY + avatarSize - sprInset - 2;
          const drawY = feetY - drawH * gY;
          const drawX = avatarX + (avatarSize - drawW) / 2;
          if (def.flipX) {
            ctx.save();
            ctx.translate(avatarX + avatarSize / 2, 0);
            ctx.scale(-1, 1);
            ctx.translate(-(avatarX + avatarSize / 2), 0);
          }
          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
          if (def.flipX) ctx.restore();
        }
      }
    }

    // ── Player name underneath avatar ──
    const nameCx = avatarX + avatarSize / 2;
    const nameY = avatarY + avatarSize + 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(11, fontSize * 0.8)}px monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(this.playerName, nameCx + 1, nameY + 1);
    ctx.fillStyle = '#ffd700';
    ctx.fillText(this.playerName, nameCx, nameY);
    ctx.textBaseline = 'alphabetic';

  }

  // ─── Render: Join code input ───

  private getJoinInputLayout(w: number, h: number) {
    const boxW = Math.min(w * 0.55, 340);
    const boxH = Math.min(h * 0.16, 120);
    const boxX = (w - boxW) / 2;
    const boxY = h * 0.30;
    const bgW = boxW * 1.5;
    const bgH = boxH * 1.5;
    const bgX = boxX - (bgW - boxW) / 2;
    const bgY = boxY - (bgH - boxH) / 2;
    const btnH = 44;
    const btnY = boxY + boxH + 8;
    return {
      boxW, boxH, boxX, boxY,
      bgW, bgH, bgX, bgY,
      cancel: { x: bgX + bgW * 0.08, y: btnY, w: bgW * 0.32, h: btnH },
      join:   { x: bgX + bgW * 0.60, y: btnY, w: bgW * 0.32, h: btnH },
    };
  }

  private renderJoinInput(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const jl = this.getJoinInputLayout(w, h);

    this.ui.drawBanner(ctx, jl.bgX, jl.bgY, jl.bgW, jl.bgH);

    const labelSize = Math.max(11, Math.min(jl.boxH * 0.18, 16));
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3a2a1a';
    ctx.fillText('ENTER INVITE CODE', w / 2, jl.boxY + jl.boxH * 0.25);

    // Code display
    const codeSize = Math.max(18, Math.min(jl.boxH * 0.28, 32));
    ctx.font = `bold ${codeSize}px monospace`;
    const display = this.joinCodeInput + (Math.floor(this.animTime * 2) % 2 === 0 ? '_' : ' ');
    ctx.fillStyle = '#8b4513';
    ctx.fillText(display, w / 2, jl.boxY + jl.boxH * 0.52);

    // CANCEL button — red sword (left)
    this.ui.drawSword(ctx, jl.cancel.x, jl.cancel.y, jl.cancel.w, jl.cancel.h, 1);
    const cancelFontSize = Math.max(11, Math.min(jl.cancel.h * 0.32, 14));
    ctx.font = `bold ${cancelFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('CANCEL', jl.cancel.x + jl.cancel.w * 0.52, jl.cancel.y + jl.cancel.h * 0.5);

    // JOIN button — blue sword (right), dimmed if code too short
    const canJoin = this.joinCodeInput.length >= 4;
    ctx.globalAlpha = canJoin ? 1 : 0.4;
    this.ui.drawSword(ctx, jl.join.x, jl.join.y, jl.join.w, jl.join.h, canJoin ? 0 : 4);
    const joinFontSize = Math.max(11, Math.min(jl.join.h * 0.35, 16));
    ctx.font = `bold ${joinFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('JOIN', jl.join.x + jl.join.w * 0.52, jl.join.y + jl.join.h * 0.5);
    ctx.globalAlpha = 1;
  }

  // ─── Render: Party panel ───

  // ─── Render: Local setup panel (no Firebase) ───

  private renderLocalSetupPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getLocalSetupLayout();
    const ls = this.localSetup!;
    const maxSlots = ls.maxSlots;
    const mapDef = getMapById(ls.mapId);
    const playersPerTeam = mapDef.playersPerTeam;

    // Panel background
    const ppPadX = Math.round(pl.panel.w * 0.075);
    const ppPadY = Math.round(pl.panel.h * 0.05);
    this.ui.drawWoodTable(ctx, pl.panel.x - ppPadX, pl.panel.y - ppPadY, pl.panel.w + ppPadX * 2, pl.panel.h + ppPadY * 2);

    const fontSize = Math.max(11, Math.min(pl.panel.w / 28, 15));

    // Header
    const headerH = 28;
    const headerY = pl.panel.y + 6;
    this.ui.drawSmallRibbon(ctx, pl.panel.x + pl.panel.w * 0.2, headerY, pl.panel.w * 0.6, headerH, 0); // blue
    ctx.font = `bold ${Math.max(11, headerH * 0.45)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('GAME SETUP', w / 2, headerY + headerH * 0.5);

    // Mode toggle (1v1 / 2v2 / 3v3)
    {
      const mt = pl.modeToggle;
      const ts = ls.teamSize ?? mapDef.playersPerTeam;
      const modeLabel = getModeName(ts);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(mt.x, mt.y, mt.w, mt.h);
      ctx.strokeStyle = 'rgba(255,215,64,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mt.x, mt.y, mt.w, mt.h);
      const mtFontSize = Math.max(11, mt.h * 0.5);
      ctx.font = `bold ${mtFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`MODE: ${modeLabel}`, mt.x + mt.w / 2, mt.y + mt.h / 2);
      ctx.fillStyle = 'rgba(255,215,64,0.6)';
      ctx.fillText('<', mt.x + 10, mt.y + mt.h / 2);
      ctx.fillText('>', mt.x + mt.w - 10, mt.y + mt.h / 2);
    }

    // Fog of War toggle
    {
      const ft = pl.fogToggle;
      const fogOn = ls.fogOfWar ?? true;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(ft.x, ft.y, ft.w, ft.h);
      ctx.strokeStyle = fogOn ? 'rgba(102,217,239,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ft.x, ft.y, ft.w, ft.h);
      const ftFontSize = Math.max(11, ft.h * 0.5);
      ctx.font = `bold ${ftFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fogOn ? '#66d9ef' : 'rgba(255,255,255,0.4)';
      ctx.fillText(`FOG: ${fogOn ? 'ON' : 'OFF'}`, ft.x + ft.w / 2, ft.y + ft.h / 2);
    }

    // Two-column team layout
    const activeSlots = new Set(getLocalActiveSlots(ls));
    const teamW = pl.teamW;
    const teamGap = 10;
    const teamColors = ['rgba(50,100,220,0.12)', 'rgba(220,50,50,0.12)'];
    const teamBorderColors = ['rgba(80,140,255,0.35)', 'rgba(255,80,80,0.35)'];
    const teamLabels = ['TEAM 1', 'TEAM 2'];
    const { cellTop: slotAreaTop, cellBot: slotAreaBot } = pl;

    for (let t = 0; t < mapDef.teams.length; t++) {
      const x0 = pl.panel.x + t * (teamW + teamGap);
      const x1 = x0 + teamW;
      const r = 6;
      ctx.fillStyle = teamColors[t];
      ctx.beginPath();
      ctx.roundRect(x0, slotAreaTop, x1 - x0, slotAreaBot - slotAreaTop, r);
      ctx.fill();
      ctx.strokeStyle = teamBorderColors[t];
      ctx.lineWidth = 1;
      ctx.stroke();

      const teamLabelSize = Math.max(11, fontSize * 0.7);
      ctx.font = `bold ${teamLabelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = teamBorderColors[t];
      ctx.fillText(teamLabels[t], (x0 + x1) / 2, slotAreaTop + 3);
    }

    // Render slots as rows within team columns
    for (let i = 0; i < maxSlots; i++) {
      const slotRect = pl.slotRects[i];
      const isPlayer = i === ls.playerSlot;
      const botDiff = ls.bots[String(i)] ?? null;
      const isActive = activeSlots.has(i);

      if (this.isDragging && this.dragSlot === i) ctx.globalAlpha = 0.3;
      if (!isActive) ctx.globalAlpha = 0.15;

      if (isPlayer) {
        const fakePlayer = { uid: 'local', name: this.playerName, race: ls.playerRace } as PartyPlayer;
        this.renderPlayerSlot(ctx, fakePlayer, true, slotRect, true, i, true);
      } else if (botDiff) {
        const spad = 3;
        const icoSz = slotRect.h - spad * 2;
        const leftPad = slotRect.x + spad;
        const midY = slotRect.y + slotRect.h / 2;
        const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === botDiff);
        const diffLabel = diffOpt?.label ?? botDiff.toUpperCase();
        const diffColor = diffOpt?.color ?? '#aaa';
        const botRace = ls.botRaces?.[String(i)] ?? 'random';

        // Left: sprite + race name + difficulty
        if (botRace !== 'random') {
          const spriteData = this.sprites.getUnitSprite(botRace as Race, 'melee', i);
          if (spriteData) {
            const [img, def] = spriteData;
            const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
            const gY = def.groundY ?? 0.71;
            const drawY = slotRect.y + spad + icoSz - icoSz * gY;
            drawSpriteFrame(ctx, img, def, frame, leftPad, drawY, icoSz, icoSz);
          }
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${fontSize}px monospace`;
          const colors = RACE_COLORS[botRace as Race];
          ctx.fillStyle = colors?.primary ?? '#aaa';
          ctx.fillText(RACE_LABELS[botRace as Race] ?? botRace, leftPad + icoSz + 4, midY + fontSize * 0.55);
        } else {
          ctx.font = `bold ${Math.max(14, icoSz * 0.5)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,220,100,0.6)';
          ctx.fillText('?', leftPad + icoSz / 2, midY);
          ctx.textAlign = 'left';
          ctx.font = `bold ${fontSize}px monospace`;
          ctx.fillStyle = 'rgba(255,220,100,0.9)';
          ctx.fillText('RANDOM', leftPad + icoSz + 4, midY + fontSize * 0.55);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(11, fontSize * 0.75)}px monospace`;
        ctx.fillStyle = diffColor;
        ctx.fillText(`BOT ${diffLabel}`, leftPad + icoSz + 4, midY - fontSize * 0.45);

        // Right side: RACE / DIFF buttons + X remove
        {
          const { raceBtn, diffBtn } = this.getBotSlotButtons(slotRect);
          const btnFontSize = Math.max(10, raceBtn.h * 0.6);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(raceBtn.x, raceBtn.y, raceBtn.w, raceBtn.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(raceBtn.x, raceBtn.y, raceBtn.w, raceBtn.h);
          ctx.font = `bold ${btnFontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillText('RACE', raceBtn.x + raceBtn.w / 2, raceBtn.y + raceBtn.h / 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(diffBtn.x, diffBtn.y, diffBtn.w, diffBtn.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.strokeRect(diffBtn.x, diffBtn.y, diffBtn.w, diffBtn.h);
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillText('DIFF', diffBtn.x + diffBtn.w / 2, diffBtn.y + diffBtn.h / 2);
          this.drawRemoveButton(ctx, slotRect);
        }
      } else {
        const slotCx = slotRect.x + slotRect.w / 2;
        const slotMidY = slotRect.y + slotRect.h / 2;
        ctx.font = `bold ${Math.max(11, fontSize * 0.8)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(isActive ? 'EMPTY' : '—', slotCx, slotMidY);
        if (isActive) {
          ctx.font = `${Math.max(11, fontSize * 0.55)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText('tap to add bot', slotCx, slotMidY + fontSize * 1.1);
        }
      }

      if ((this.isDragging && this.dragSlot === i) || !isActive) ctx.globalAlpha = 1;

      // Horizontal dividers between rows within same team
      const row = i % playersPerTeam;
      if (row > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(slotRect.x, slotRect.y - 2);
        ctx.lineTo(slotRect.x + slotRect.w, slotRect.y - 2);
        ctx.stroke();
      }
    }

    // Drag ghost
    if (this.isDragging && this.dragSlot >= 0) {
      ctx.globalAlpha = 0.7;
      const ghostSize = 40;
      if (this.dragSlot === ls.playerSlot) {
        const dragRace = ls.playerRace === 'random' ? Race.Crown : ls.playerRace;
        const spriteData = this.sprites.getUnitSprite(dragRace, 'melee', this.dragSlot < playersPerTeam ? 0 : 1);
        if (spriteData) {
          const [img, def] = spriteData;
          const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
          const gY = def.groundY ?? 0.71;
          drawSpriteFrame(ctx, img, def, frame, this.dragX - ghostSize / 2, this.dragY - ghostSize * gY, ghostSize, ghostSize);
        }
        ctx.font = `bold ${Math.max(11, fontSize * 0.7)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(this.playerName, this.dragX, this.dragY + ghostSize * 0.4);
      } else {
        const diff = ls.bots[String(this.dragSlot)];
        if (diff) {
          const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === diff);
          ctx.font = `bold ${Math.max(12, fontSize * 1.2)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = diffOpt?.color ?? '#aaa';
          ctx.fillText('BOT', this.dragX, this.dragY);
        }
      }
      ctx.globalAlpha = 1;
    }

    // START button
    const canStart = canStartLocalSetup(ls);
    ctx.globalAlpha = canStart ? 1 : 0.4;
    this.ui.drawSword(ctx, pl.start.x, pl.start.y, pl.start.w, pl.start.h, canStart ? 0 : 4);
    const startFontSize = Math.max(11, Math.min(pl.start.h * 0.35, 16));
    ctx.font = `bold ${startFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('START', pl.start.x + pl.start.w * 0.52, pl.start.y + pl.start.h * 0.5);
    ctx.globalAlpha = 1;

    // BACK button
    this.ui.drawSword(ctx, pl.leave.x, pl.leave.y, pl.leave.w, pl.leave.h, 1);
    const leaveFontSize = Math.max(11, Math.min(pl.leave.h * 0.32, 14));
    ctx.font = `bold ${leaveFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('BACK', pl.leave.x + pl.leave.w * 0.52, pl.leave.y + pl.leave.h * 0.5);

    // Start validation hint
    if (!canStart) {
      ctx.font = `${Math.max(11, fontSize * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,100,100,0.7)';
      ctx.fillText('Each team needs at least 1 player or bot', w / 2, pl.start.y - 8);
    }
  }

  // ─── Render: Party panel (Firebase) ───

  private renderPartyPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getPartyLayout();
    const ps = this.partyState!;
    const maxSlots = ps.maxSlots ?? 4;

    // Panel background — oversized for 9-slice dead space
    const ppPadX = Math.round(pl.panel.w * 0.075);
    const ppPadY = Math.round(pl.panel.h * 0.05);
    this.ui.drawWoodTable(ctx, pl.panel.x - ppPadX, pl.panel.y - ppPadY, pl.panel.w + ppPadX * 2, pl.panel.h + ppPadY * 2);

    const fontSize = Math.max(11, Math.min(pl.panel.w / 28, 15));
    const isHost = this.party?.isHost;

    // Big ribbon header with party code front-and-center
    const codeRibW = pl.panel.w * 0.75;
    const codeRibH = 62;
    const codeRibX = pl.panel.x + (pl.panel.w - codeRibW) / 2;
    const codeRibY = pl.panel.y + 2;
    this.ui.drawBigRibbon(ctx, codeRibX, codeRibY, codeRibW, codeRibH, 2); // yellow

    // "PARTY CODE" small label at top of ribbon
    const labelSize = Math.max(11, codeRibH * 0.2);
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText('PARTY CODE', w / 2, codeRibY + codeRibH * 0.25);

    // Large code text — letter-spaced, bright white on the ribbon
    // Scale font to fit within ribbon width on small screens
    let codeFontSize = Math.max(18, Math.min(pl.panel.w / 8, 44));
    let codeStr = ps.code.split('').join('   ');
    ctx.font = `bold ${codeFontSize}px monospace`;
    const maxCodeW = codeRibW * 0.88;
    if (ctx.measureText(codeStr).width > maxCodeW) {
      // Try narrower spacing first
      codeStr = ps.code.split('').join('  ');
      ctx.font = `bold ${codeFontSize}px monospace`;
      if (ctx.measureText(codeStr).width > maxCodeW) {
        codeStr = ps.code.split('').join(' ');
        ctx.font = `bold ${codeFontSize}px monospace`;
        if (ctx.measureText(codeStr).width > maxCodeW) {
          codeFontSize = codeFontSize * maxCodeW / ctx.measureText(codeStr).width;
          ctx.font = `bold ${codeFontSize}px monospace`;
        }
      }
    }
    const codeTxtY = codeRibY + codeRibH * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(codeStr, w / 2 + 1, codeTxtY + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(codeStr, w / 2, codeTxtY);

    // Tap to copy hint / copied feedback
    ctx.font = `${Math.max(11, fontSize * 0.7)}px monospace`;
    if (this.copyFeedbackTimer > 0) {
      const fadeIn = Math.min(1, (120 - this.copyFeedbackTimer) / 10);
      const floatY = (1 - this.copyFeedbackTimer / 120) * -6;
      ctx.fillStyle = `rgba(100,255,100,${fadeIn * 0.9})`;
      ctx.fillText('copied to clipboard!', w / 2, codeRibY + codeRibH + 8 + floatY);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('tap code to copy', w / 2, codeRibY + codeRibH + 8);
    }

    // Mode toggle (1v1 / 2v2 / 3v3 — host only)
    {
      const mt = pl.modeToggle;
      const mapDef2 = getMapById(ps.mapId ?? 'duel');
      const ts = ps.teamSize ?? mapDef2.playersPerTeam;
      const modeLabel = getModeName(ts);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(mt.x, mt.y, mt.w, mt.h);
      ctx.strokeStyle = 'rgba(255,215,64,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mt.x, mt.y, mt.w, mt.h);
      const mtFontSize = Math.max(11, mt.h * 0.5);
      ctx.font = `bold ${mtFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`MODE: ${modeLabel}`, mt.x + mt.w / 2, mt.y + mt.h / 2);
      if (isHost) {
        ctx.fillStyle = 'rgba(255,215,64,0.6)';
        ctx.fillText('<', mt.x + 10, mt.y + mt.h / 2);
        ctx.fillText('>', mt.x + mt.w - 10, mt.y + mt.h / 2);
      }
    }

    // Fog of War toggle (host can click, guests see state)
    {
      const ft = pl.fogToggle;
      const fogOn = ps.fogOfWar ?? true;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(ft.x, ft.y, ft.w, ft.h);
      ctx.strokeStyle = fogOn ? 'rgba(102,217,239,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ft.x, ft.y, ft.w, ft.h);
      const ftFontSize = Math.max(11, ft.h * 0.5);
      ctx.font = `bold ${ftFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fogOn ? '#66d9ef' : 'rgba(255,255,255,0.4)';
      ctx.fillText(`FOG: ${fogOn ? 'ON' : 'OFF'}`, ft.x + ft.w / 2, ft.y + ft.h / 2);
    }

    // Two-column team layout
    const partyActiveSlots = new Set(getActiveSlots(ps));
    const teamW = pl.teamW;
    const teamGap = 10;
    const localSlot = this.party?.localSlotIndex ?? 0;
    const mapDef = getMapById(ps.mapId ?? 'duel');
    const playersPerTeam = mapDef.playersPerTeam;
    const teamColors = ['rgba(50,100,220,0.12)', 'rgba(220,50,50,0.12)'];
    const teamBorderColors = ['rgba(80,140,255,0.35)', 'rgba(255,80,80,0.35)'];
    const teamLabels = ['TEAM 1', 'TEAM 2'];
    const { cellTop: slotAreaTop, cellBot: slotAreaBot } = pl;

    for (let t = 0; t < 2; t++) {
      const x0 = pl.panel.x + t * (teamW + teamGap);
      const x1 = x0 + teamW;
      const r = 6;
      ctx.fillStyle = teamColors[t];
      ctx.beginPath();
      ctx.roundRect(x0, slotAreaTop, x1 - x0, slotAreaBot - slotAreaTop, r);
      ctx.fill();
      ctx.strokeStyle = teamBorderColors[t];
      ctx.lineWidth = 1;
      ctx.stroke();

      const teamLabelSize = Math.max(11, fontSize * 0.7);
      ctx.font = `bold ${teamLabelSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = teamBorderColors[t];
      ctx.fillText(teamLabels[t], (x0 + x1) / 2, slotAreaTop + 3);
    }

    // Render slots as rows within team columns
    for (let i = 0; i < maxSlots; i++) {
      const player = ps.players[String(i)];
      const slotRect = pl.slotRects[i];
      const botDiff = ps.bots?.[String(i)] ?? null;

      const isSlotActive = partyActiveSlots.has(i);
      if (this.isDragging && this.dragSlot === i) ctx.globalAlpha = 0.3;
      else if (!isSlotActive) ctx.globalAlpha = 0.15;

      if (player) {
        const isSlotHost = i === 0;
        this.renderPlayerSlot(ctx, player, isSlotHost, slotRect, i === localSlot, i, i === localSlot);
        if (isHost && i !== localSlot && !isSlotHost && isSlotActive) {
          this.drawRemoveButton(ctx, slotRect);
        }
      } else if (botDiff) {
        const spad = 3;
        const icoSz = slotRect.h - spad * 2;
        const leftPad = slotRect.x + spad;
        const midY = slotRect.y + slotRect.h / 2;
        const diffOpt = PARTY_DIFFICULTY_OPTIONS.find(d => d.level === botDiff);
        const diffLabel = diffOpt?.label ?? botDiff.toUpperCase();
        const diffColor = diffOpt?.color ?? '#aaa';
        const botRace = ps.botRaces?.[String(i)] ?? 'random';

        if (botRace !== 'random') {
          const spriteData = this.sprites.getUnitSprite(botRace as Race, 'melee', i);
          if (spriteData) {
            const [img, def] = spriteData;
            const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
            const gY = def.groundY ?? 0.71;
            const drawY = slotRect.y + spad + icoSz - icoSz * gY;
            drawSpriteFrame(ctx, img, def, frame, leftPad, drawY, icoSz, icoSz);
          }
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${fontSize}px monospace`;
          const colors = RACE_COLORS[botRace as Race];
          ctx.fillStyle = colors?.primary ?? '#aaa';
          ctx.fillText(RACE_LABELS[botRace as Race] ?? botRace.toUpperCase(), leftPad + icoSz + 4, midY + fontSize * 0.55);
        } else {
          ctx.font = `bold ${Math.max(14, icoSz * 0.5)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,220,100,0.8)';
          ctx.fillText('?', leftPad + icoSz / 2, midY);
          ctx.textAlign = 'left';
          ctx.font = `bold ${fontSize}px monospace`;
          ctx.fillStyle = 'rgba(255,220,100,0.9)';
          ctx.fillText('RANDOM', leftPad + icoSz + 4, midY + fontSize * 0.55);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(11, fontSize * 0.75)}px monospace`;
        ctx.fillStyle = diffColor;
        ctx.fillText(`BOT ${diffLabel}`, leftPad + icoSz + 4, midY - fontSize * 0.45);

        if (isHost && isSlotActive) {
          const { raceBtn, diffBtn } = this.getBotSlotButtons(slotRect);
          const btnFontSize = Math.max(10, raceBtn.h * 0.6);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(raceBtn.x, raceBtn.y, raceBtn.w, raceBtn.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(raceBtn.x, raceBtn.y, raceBtn.w, raceBtn.h);
          ctx.font = `bold ${btnFontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillText('RACE', raceBtn.x + raceBtn.w / 2, raceBtn.y + raceBtn.h / 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(diffBtn.x, diffBtn.y, diffBtn.w, diffBtn.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.strokeRect(diffBtn.x, diffBtn.y, diffBtn.w, diffBtn.h);
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillText('DIFF', diffBtn.x + diffBtn.w / 2, diffBtn.y + diffBtn.h / 2);
          this.drawRemoveButton(ctx, slotRect);
        }
      } else {
        const slotCx = slotRect.x + slotRect.w / 2;
        const slotMidY = slotRect.y + slotRect.h / 2;
        ctx.font = `bold ${Math.max(11, fontSize * 0.8)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(isSlotActive ? 'EMPTY' : '—', slotCx, slotMidY);
        if (isHost && isSlotActive) {
          ctx.font = `${Math.max(11, fontSize * 0.55)}px monospace`;
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText('tap to add bot', slotCx, slotMidY + fontSize * 1.1);
        }
      }

      if ((this.isDragging && this.dragSlot === i) || !isSlotActive) ctx.globalAlpha = 1;

      // Horizontal dividers between rows within same team
      const row = i % playersPerTeam;
      if (row > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(slotRect.x, slotRect.y - 2);
        ctx.lineTo(slotRect.x + slotRect.w, slotRect.y - 2);
        ctx.stroke();
      }
    }

    // Drag ghost
    if (this.isDragging && this.dragSlot >= 0) {
      const dragPlayer = ps.players[String(this.dragSlot)];
      if (dragPlayer) {
        ctx.globalAlpha = 0.7;
        const ghostSize = 40;
        const spriteData = this.sprites.getUnitSprite(dragPlayer.race, 'melee', this.dragSlot < playersPerTeam ? 0 : 1);
        if (spriteData) {
          const [img, def] = spriteData;
          const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
          const gY = def.groundY ?? 0.71;
          drawSpriteFrame(ctx, img, def, frame, this.dragX - ghostSize / 2, this.dragY - ghostSize * gY, ghostSize, ghostSize);
        }
        ctx.font = `bold ${Math.max(11, fontSize * 0.7)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(dragPlayer.name, this.dragX, this.dragY + ghostSize * 0.4);
        ctx.globalAlpha = 1;
      }
    }

    // START button (host only, enabled when 2+ players)
    if (isHost) {
      const canStart = canStartParty(ps);
      ctx.globalAlpha = canStart ? 1 : 0.4;
      this.ui.drawSword(ctx, pl.start.x, pl.start.y, pl.start.w, pl.start.h, canStart ? 0 : 4); // blue or dark
      const startFontSize = Math.max(11, Math.min(pl.start.h * 0.35, 16));
      ctx.font = `bold ${startFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText('START', pl.start.x + pl.start.w * 0.52, pl.start.y + pl.start.h * 0.5);
      ctx.globalAlpha = 1;
    } else {
      // Guest sees "waiting for host"
      ctx.font = `${Math.max(11, fontSize * 0.8)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('Waiting for host to start...', pl.start.x + pl.start.w * 0.5, pl.start.y + pl.start.h * 0.5);
    }

    // LEAVE button — red sword
    this.ui.drawSword(ctx, pl.leave.x, pl.leave.y, pl.leave.w, pl.leave.h, 1);
    const leaveFontSize = Math.max(11, Math.min(pl.leave.h * 0.32, 14));
    ctx.font = `bold ${leaveFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('LEAVE', pl.leave.x + pl.leave.w * 0.52, pl.leave.y + pl.leave.h * 0.5);
  }

  private renderPlayerSlot(
    ctx: CanvasRenderingContext2D,
    player: PartyPlayer, isHost: boolean,
    raceRect: { x: number; y: number; w: number; h: number },
    isLocal = false,
    slotIndex = 0,
    showRaceBtn = false,
  ): void {
    const fontSize = Math.max(11, Math.min(raceRect.w / 18, 14));
    const isRandom = (player.race as string) === 'random';
    const pad = 3;
    const imgSize = raceRect.h - pad * 2; // fill row height
    const midY = raceRect.y + raceRect.h / 2;
    let curX = raceRect.x + pad;

    // 1) Avatar badge
    const avatarIdToUse = isLocal ? this.profile?.avatarId : player.avatarId;
    const avatarDef = avatarIdToUse ? ALL_AVATARS.find(a => a.id === avatarIdToUse) : undefined;
    const badgeSize = imgSize;
    const badgeX = curX;
    const badgeY = raceRect.y + pad;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 3);
    ctx.fill();
    ctx.strokeStyle = isLocal ? 'rgba(255,215,0,0.4)' : 'rgba(180,180,180,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 3);
    ctx.stroke();
    if (avatarDef) {
      const sprData = this.sprites.getUnitSprite(avatarDef.race, avatarDef.category, 0, false, avatarDef.upgradeNode);
      if (sprData) {
        const [img, def] = sprData;
        const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
        const aspect = def.frameW / def.frameH;
        const sprInset = 2;
        const sprScale = def.scale ?? 1.0;
        const drawH = (badgeSize - sprInset * 2) * sprScale;
        const drawW = drawH * aspect;
        const gY = def.groundY ?? 0.71;
        const feetY = badgeY + badgeSize - sprInset - 1;
        const drawY = feetY - drawH * gY;
        const drawX = badgeX + (badgeSize - drawW) / 2;
        drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
      }
    }
    curX += badgeSize + 3;

    // 2) Race sprite
    if (isRandom) {
      ctx.font = `bold ${Math.max(14, imgSize * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,220,100,0.8)';
      ctx.fillText('?', curX + imgSize / 2, midY);
    } else {
      const spriteData = this.sprites.getUnitSprite(player.race, 'melee', slotIndex);
      if (spriteData) {
        const [img, def] = spriteData;
        const frame = getSpriteFrame(Math.floor(this.animTime * 20), def);
        const gY = def.groundY ?? 0.71;
        const drawY = raceRect.y + pad + imgSize - imgSize * gY;
        drawSpriteFrame(ctx, img, def, frame, curX, drawY, imgSize, imgSize);
      }
    }
    curX += imgSize + 4;

    // 3) Text: top = HOST label, middle = Player Name, bottom = Race Name
    const textX = curX;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Host tag above name
    if (isHost) {
      ctx.font = `${Math.max(8, fontSize * 0.55)}px monospace`;
      ctx.fillStyle = '#ffe082';
      ctx.fillText('HOST', textX, midY - fontSize * 1.0);
    }

    // Player name
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = '#fff';
    const nameText = player.name;
    ctx.fillText(nameText, textX, midY - fontSize * 0.25);

    // Bottom line: race name
    ctx.font = `${Math.max(11, fontSize * 0.8)}px monospace`;
    if (isRandom) {
      ctx.fillStyle = 'rgba(255,220,100,0.9)';
      ctx.fillText('RANDOM', textX, midY + fontSize * 0.75);
    } else {
      const colors = RACE_COLORS[player.race];
      ctx.fillStyle = colors.primary;
      ctx.fillText(RACE_LABELS[player.race], textX, midY + fontSize * 0.75);
    }

    // 4) RACE button (only for own slot, hidden when too narrow to avoid collision)
    if (showRaceBtn && raceRect.w > 250) {
      const btnW = 42;
      const btnH = Math.min(18, (raceRect.h - 6) / 2);
      const btnX = raceRect.x + raceRect.w - btnW - 4;
      const btnY = raceRect.y + (raceRect.h - btnH) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.font = `bold ${Math.max(10, btnH * 0.6)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('RACE', btnX + btnW / 2, btnY + btnH / 2);
    }
  }

  private drawDuelProjectile(ctx: CanvasRenderingContext2D, proj: DuelProjectile, baseY: number, unitSize: number, screenW: number): void {
    const sx = this.tileToScreen(proj.x, screenW);
    // Projectiles fly at ~60% unit height
    const py = baseY - unitSize * 0.5;
    const animFrame = 5 + Math.floor(this.animTime * 10) % 10;

    const usesArrow = proj.sourceRace === Race.Crown && !proj.aoe;

    if (usesArrow) {
      // Arrow sprite — rotate toward target
      const arrowData = this.sprites.getArrowSprite(proj.sourcePlayerId < 2 ? 0 : 1);
      if (arrowData) {
        const [img] = arrowData;
        const angle = proj.facingLeft ? Math.PI : 0;
        const size = unitSize * 0.35;
        ctx.save();
        ctx.translate(sx, py);
        ctx.rotate(angle);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
        return;
      }
    }

    if (proj.aoe) {
      // Caster AoE — circle sprite
      const circData = this.sprites.getCircleSprite(proj.sourceRace);
      if (circData) {
        const [img, def] = circData;
        const size = unitSize * 0.45;
        drawGridFrame(ctx, img, def, animFrame, sx - size / 2, py - size / 2, size, size);
        return;
      }
    }

    // Ranged — orb sprite
    const orbData = this.sprites.getOrbSprite(proj.sourceRace);
    if (orbData) {
      const [img, def] = orbData;
      const size = unitSize * 0.3;
      drawGridFrame(ctx, img, def, animFrame, sx - size / 2, py - size / 2, size, size);
      return;
    }

    // Fallback: colored dot
    const color = proj.sourcePlayerId < 2 ? '#4fc3f7' : '#ff8a65';
    ctx.beginPath();
    ctx.arc(sx, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  private drawDuelUnit(ctx: CanvasRenderingContext2D, unit: DuelUnit, size: number, baseY: number, frameTick: number, screenW: number): void {
    const attacking = unit.isAttacking;
    const spriteData = this.sprites.getUnitSprite(unit.race, unit.category, unit.playerId, attacking, unit.upgradeNode);
    if (!spriteData) return;

    const [img, def] = spriteData;
    const spriteScale = def.scale ?? 1.0;
    const baseH = size * spriteScale;
    const aspect = def.frameW / def.frameH;
    const drawW = baseH * aspect;
    const drawH = baseH * (def.heightScale ?? 1.0);
    const frame = getSpriteFrame(frameTick, def);
    const sx = this.tileToScreen(unit.x, screenW);
    const gY = def.groundY ?? 0.71;
    const drawY = baseY - drawH * gY;

    // flipX sprites face left natively — invert facing so they match right-facing convention
    const effectiveFaceLeft = def.flipX ? !unit.facingLeft : unit.facingLeft;
    if (effectiveFaceLeft) {
      ctx.save();
      ctx.translate(sx, 0);
      ctx.scale(-1, 1);
      drawSpriteFrame(ctx, img, def, frame, -drawW / 2, drawY, drawW, drawH);
      ctx.restore();
    } else {
      drawSpriteFrame(ctx, img, def, frame, sx - drawW / 2, drawY, drawW, drawH);
    }

    // Status effect VFX overlays
    const fxTick = Math.floor(this.animTime * 10);
    const fxSize = size * 0.6;
    const unitCenterY = baseY - size * 0.4;

    for (const eff of unit.statusEffects) {
      if (eff.type === StatusType.Burn) {
        const fxData = this.sprites.getFxSprite('burn');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.5 + 0.15 * eff.stacks, 1);
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.6, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.6, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Slow) {
        const fxData = this.sprites.getFxSprite('slow');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = Math.min(0.4 + 0.15 * eff.stacks, 0.9);
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.4, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.4, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Haste) {
        const fxData = this.sprites.getFxSprite('haste');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          ctx.globalAlpha = 0.6;
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.5, fxSize, fxSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - fxSize / 2, unitCenterY - fxSize * 0.5, fxSize, fxSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      if (eff.type === StatusType.Shield) {
        const fxData = this.sprites.getFxSprite('shield');
        if (fxData) {
          const [fxImg, fxDef] = fxData;
          const shieldSize = fxSize * 1.3;
          ctx.globalAlpha = 0.5;
          if ('cols' in fxDef && 'rows' in fxDef) {
            drawGridFrame(ctx, fxImg, fxDef as any, fxTick, sx - shieldSize / 2, unitCenterY - shieldSize / 2, shieldSize, shieldSize);
          } else {
            drawSpriteFrame(ctx, fxImg, fxDef as any, fxTick, sx - shieldSize / 2, unitCenterY - shieldSize / 2, shieldSize, shieldSize);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // HP bar
    if (unit.hp < unit.maxHp || unit.statusEffects.length > 0) {
      const barW = size * 0.7;
      const barH = 5;
      const barX = sx - barW / 2;
      const barY = drawY - 10;
      const hpPct = Math.max(0, unit.hp / unit.maxHp);

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpPct, barH);

      if (unit.shieldHp > 0) {
        const shieldPct = Math.min(1, unit.shieldHp / 12);
        ctx.fillStyle = 'rgba(100,181,246,0.7)';
        ctx.fillRect(barX, barY, barW * shieldPct, barH);
      }
    }

    // Status effect indicator dots
    if (unit.statusEffects.length > 0) {
      const dotY = drawY - 2;
      let dotX = sx - (unit.statusEffects.length - 1) * 4;
      for (const eff of unit.statusEffects) {
        let color = '#fff';
        if (eff.type === StatusType.Burn) color = '#ff4400';
        else if (eff.type === StatusType.Slow) color = '#2979ff';
        else if (eff.type === StatusType.Haste) color = '#00e676';
        else if (eff.type === StatusType.Shield) color = '#64b5f6';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fill();
        dotX += 8;
      }
    }
  }
}
