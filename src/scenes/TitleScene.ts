/**
 * Title screen — main menu, party/matchmaking, local game setup, and animated duel.
 *
 * Handles the full pre-game flow: solo play, custom game (local/Firebase),
 * find game (matchmaking), join party, and the background duel animation.
 *
 * Sub-modules:
 *   TitleParty    — Firebase init, party CRUD, matchmaking, race cycling
 *   TitleRender   — all rendering methods (menu buttons, panels, duel units)
 *   TitleDuelSim  — duel combat simulation for the background animation
 *   TitleLocalSetup — local setup panel state helpers
 */
import { Scene, SceneManager } from './Scene';
import { UIAssets } from '../rendering/UIAssets';
import { SpriteLoader } from '../rendering/SpriteLoader';
// Race type accessed indirectly via TitlePartyState/TitleRenderState interfaces
import { RACE_COLORS } from '../simulation/data';
import { PartyManager, PartyState, PartyPlayer, getPartyPlayerCount, getActiveSlots } from '../network/PartyManager';
import { PlayerProfile, loadProfile, checkNonMatchAchievement, ACHIEVEMENTS } from '../profile/ProfileData';
import { BotDifficultyLevel } from '../simulation/BotAI';
import { getMapById } from '../simulation/maps';
import { SoundManager } from '../audio/SoundManager';
import { MusicPlayer } from '../audio/MusicPlayer';
import { getAudioSettings, subscribeToAudioSettings, updateAudioSettings } from '../audio/AudioSettings';
import { drawSettingsButton, drawSettingsOverlay, getSettingsOverlayLayout, hitRect as hitOverlayRect, sliderValueFromPoint, handleVisualToggleClick, SettingsSliderDrag } from '../ui/SettingsOverlay';
import { getSafeTop } from '../ui/SafeArea';
import { loadPlayerName } from './TitlePlayerName';
import { isMenuTutorial, advanceTutorial, TUTORIAL_TIMEOUT_MS, refreshTutorialCache } from '../ui/TutorialManager';
import { getElo, saveAllElo, updateTeamElo } from './TitleElo';
import { LocalSetup, saveLocalSetup, getLocalActiveSlots, canStartLocalSetup, canStartParty } from './TitleLocalSetup';
import {
  DuelUnit, DuelProjectile, ARENA_WIDTH,
  TitleSfx,
  getEffectiveSpeed, tickDuelStatusEffects, tickDuelCombat, tickDuelProjectiles, findNearestEnemy,
} from './TitleDuelSim';
import {
  startLobbyCountPolling as _startLobbyCountPolling, stopLobbyCountPolling as _stopLobbyCountPolling,
  doFindGame as _doFindGame,
  cancelMatchmaking as _cancelMatchmaking, clearMatchmakingTimeout as _clearMatchmakingTimeout,
  doCreateParty as _doCreateParty,
  localSetupCycleBot as _localSetupCycleBot, localSetupCycleDifficulty as _localSetupCycleDifficulty,
  localSetupSwapSlots as _localSetupSwapSlots, localSetupCycleMode as _localSetupCycleMode,
  doJoinParty as _doJoinParty, openJoinInput as _openJoinInput, closeJoinInput as _closeJoinInput,
  focusJoinHiddenInput as _focusJoinHiddenInput, blurJoinHiddenInput as _blurJoinHiddenInput,
  cycleRace as _cycleRace, cycleBotRace as _cycleBotRace,
  cyclePartyBotRace as _cyclePartyBotRace,
  spawnDuel as _spawnDuel,
  TitlePartyState,
} from './TitleParty';
import {
  renderMenuButtons as _renderMenuButtons,
  drawMenuTutorial as _drawMenuTutorial, handleMenuTutorialClick as _handleMenuTutorialClick,
  renderNameTag as _renderNameTag,
  getJoinInputLayout as _getJoinInputLayout, renderJoinInput as _renderJoinInput,
  renderLocalSetupPanel as _renderLocalSetupPanel,
  renderPartyPanel as _renderPartyPanel,
  renderPlayerSlot as _renderPlayerSlot,
  drawDuelProjectile as _drawDuelProjectile, drawDuelUnit as _drawDuelUnit,
  TitleRenderState,
} from './TitleRender';
import titleLogoUrl from '../assets/images/title_logo.png?url';

const PARTY_DIFFICULTY_OPTIONS: { level: BotDifficultyLevel; label: string; color: string }[] = [
  { level: BotDifficultyLevel.Easy, label: 'EASY', color: '#4caf50' },
  { level: BotDifficultyLevel.Medium, label: 'MED', color: '#ffd740' },
  { level: BotDifficultyLevel.Hard, label: 'HARD', color: '#ff9100' },
  { level: BotDifficultyLevel.Nightmare, label: 'NITE', color: '#ff1744' },
];


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
  subtitleIndex = 0; // accessed via TitlePartyState
  private resetEloConfirm = false; // true = waiting for second click to confirm

  // Win announcement
  private winText = '';
  private winColor = '#fff';
  private winTimer = 0;
  private winScale = 0;

  // Title logo image
  private titleLogoImg: HTMLImageElement | null = null;

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
  matchmakingDots = 0; // accessed via TitlePartyState / TitleRenderState
  matchmakingTimeout: ReturnType<typeof setTimeout> | null = null; // accessed via TitlePartyState
  private connecting = false; // true while Firebase is initializing (custom game / find game)
  openLobbyCount: number | null = null; // accessed via TitlePartyState / TitleRenderState
  lobbyCountPollInterval: ReturnType<typeof setInterval> | null = null; // accessed via TitlePartyState
  lobbyCountRefreshToken = 0; // accessed via TitlePartyState
  private joinCodeInput: string = '';
  private joinInputActive = false;
  joinHiddenInput: HTMLInputElement | null = null; // accessed via TitlePartyState
  firebaseReady = false; // accessed via TitlePartyState
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
  menuTutorialSkipAllRect: { x: number; y: number; w: number; h: number } | null = null; // accessed via TitleRenderState

  setNowPlaying(name: string): void {
    this.nowPlayingName = name;
    this.nowPlayingStart = performance.now();
  }

  /** Expose scene state for TitleParty delegate functions. */
  private get _partyState(): TitlePartyState { return this as any; }

  /** Expose scene state for TitleRender delegate functions. */
  private get _renderState(): TitleRenderState { return this as any; }

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, ui: UIAssets, sprites: SpriteLoader, musicPlayer: MusicPlayer) {
    this.manager = manager;
    this.canvas = canvas;
    this.ui = ui;
    this.sprites = sprites;
    this.musicPlayer = musicPlayer;
    // Load title logo
    const logoImg = new Image();
    logoImg.src = titleLogoUrl;
    logoImg.onload = () => { this.titleLogoImg = logoImg; };
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
    this.openLobbyCount = null;
    this.startLobbyCountPolling();

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
    this.stopLobbyCountPolling();
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
        botRaces: s.botRaces ? { ...s.botRaces } : undefined,
        playerSlot: localSlot,
        playerRace: s.players[String(localSlot)]?.race ?? 'random',
        teamSize: s.teamSize ?? mapDef.playersPerTeam,
        fogOfWar: s.fogOfWar,
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
    const panelH = Math.min(h * 0.64, 470);
    const px = (w - panelW) / 2;
    const py = h * 0.09;

    // Mode toggle + fog toggle side by side
    const totalTogW = panelW * 0.72;
    const toggleGap = 8;
    const toggleW = totalTogW * 0.6;
    const fogW = totalTogW - toggleW - toggleGap;
    const toggleH = 24;
    const mapTogY = py + panelH * 0.13;
    const modeTogX = px + (panelW - totalTogW) / 2;

    // Two team columns with slots as rows
    const teamGap = 10;
    const teamW = (panelW - teamGap) / 2;
    const slotAreaTop = py + panelH * 0.22;
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
      code: { x: px + panelW * 0.08, y: py - 28, w: panelW * 0.84, h: 82 },
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
    const py = h * 0.09;

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

  // ─── Party actions (delegated to TitleParty.ts) ───

  // firebaseInitPromise is accessed via TitlePartyState interface
  firebaseInitPromise: Promise<void> | null = null;

  private startLobbyCountPolling(): void { _startLobbyCountPolling(this._partyState); }
  private stopLobbyCountPolling(): void { _stopLobbyCountPolling(this._partyState); }
  private doFindGame(): Promise<void> { return _doFindGame(this._partyState); }
  private cancelMatchmaking(): void { _cancelMatchmaking(this._partyState); }
  private clearMatchmakingTimeout(): void { _clearMatchmakingTimeout(this._partyState); }
  private doCreateParty(): Promise<void> { return _doCreateParty(this._partyState); }
  private localSetupCycleBot(slot: number): void { _localSetupCycleBot(this._partyState, slot); }
  private localSetupCycleDifficulty(slot: number): void { _localSetupCycleDifficulty(this._partyState, slot); }
  private localSetupSwapSlots(slotA: number, slotB: number): void { _localSetupSwapSlots(this._partyState, slotA, slotB); }
  private localSetupCycleMode(): void { _localSetupCycleMode(this._partyState); }
  private doJoinParty(): Promise<void> { return _doJoinParty(this._partyState); }
  private openJoinInput(): void { _openJoinInput(this._partyState); }
  private closeJoinInput(): void { _closeJoinInput(this._partyState); }
  private focusJoinHiddenInput(): void { _focusJoinHiddenInput(this._partyState); }
  private blurJoinHiddenInput(): void { _blurJoinHiddenInput(this._partyState); }
  private cycleRace(dir: number = 1): void { _cycleRace(this._partyState, dir); }
  private cycleBotRace(slot: number): void { _cycleBotRace(this._partyState, slot); }
  private cyclePartyBotRace(slot: number): void { _cyclePartyBotRace(this._partyState, slot); }
  private spawnDuel(): void { _spawnDuel(this._partyState); }

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

    // Title logo + subtitle drawn on top
    const bannerH = Math.min(h * 0.35, 280);
    const bannerY = h * 0.01 + getSafeTop();
    if (this.titleLogoImg) {
      const aspect = this.titleLogoImg.width / this.titleLogoImg.height;
      const maxW = Math.min(w * 0.75, 500);
      let logoW = bannerH * aspect;
      let logoH = bannerH;
      if (logoW > maxW) { logoW = maxW; logoH = logoW / aspect; }
      const logoX = (w - logoW) / 2;
      ctx.drawImage(this.titleLogoImg, logoX, bannerY, logoW, logoH);
    }
    const subW = Math.min(w * 0.62, 420);
    const subH = Math.min(h * 0.055, 40);
    const subX = (w - subW) / 2;
    const logoActualH = this.titleLogoImg ? Math.min(bannerH, Math.min(w * 0.75, 500) / (this.titleLogoImg.width / this.titleLogoImg.height)) : bannerH;
    const subY = bannerY + logoActualH * 1.02 - subH * 0.5;
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

    // Player name + portrait (rendered before panels so panels cover it)
    this.renderNameTag(ctx, w, h);

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

  // ─── Render methods (delegated to TitleRender.ts) ───

  private renderMenuButtons(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    _renderMenuButtons(ctx, this.ui, this._renderState, this.getButtonLayout());
  }

  private drawMenuTutorial(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    _drawMenuTutorial(ctx, w, h, this._renderState, this.profileBtnRect, this.getButtonLayout());
  }

  private handleMenuTutorialClick(cx: number, cy: number): boolean {
    return _handleMenuTutorialClick(this._renderState, cx, cy);
  }

  private renderNameTag(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    _renderNameTag(ctx, _w, _h, this.sprites, this._renderState, this.profileBtnRect);
  }

  private getJoinInputLayout(w: number, h: number) {
    return _getJoinInputLayout(w, h);
  }

  private renderJoinInput(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    _renderJoinInput(ctx, w, h, this.ui, this._renderState);
  }

  private renderLocalSetupPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getLocalSetupLayout();
    const ls = this.localSetup!;
    const renderSlot = (ctx2: CanvasRenderingContext2D, player: PartyPlayer, isHost: boolean, raceRect: { x: number; y: number; w: number; h: number }, isLocal: boolean, slotIndex: number, showRaceBtn: boolean) =>
      this.renderPlayerSlot(ctx2, player, isHost, raceRect, isLocal, slotIndex, showRaceBtn);
    _renderLocalSetupPanel(ctx, w, _h, this.ui, this.sprites, this._renderState, ls, pl,
      this.getBotSlotButtons.bind(this), this.getSlotRemoveBtn.bind(this),
      this.drawRemoveButton.bind(this), renderSlot);
  }

  // ─── Render: Party panel (Firebase) ───

  private renderPartyPanel(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const pl = this.getPartyLayout();
    const ps = this.partyState!;
    const renderSlot = (ctx2: CanvasRenderingContext2D, player: PartyPlayer, isHost: boolean, raceRect: { x: number; y: number; w: number; h: number }, isLocal: boolean, slotIndex: number, showRaceBtn: boolean) =>
      this.renderPlayerSlot(ctx2, player, isHost, raceRect, isLocal, slotIndex, showRaceBtn);
    _renderPartyPanel(ctx, w, _h, this.ui, this.sprites, this._renderState, ps,
      !!this.party?.isHost, this.party?.localSlotIndex ?? 0, this.copyFeedbackTimer, pl,
      this.getBotSlotButtons.bind(this), this.getSlotRemoveBtn.bind(this),
      this.drawRemoveButton.bind(this), renderSlot);
  }

  private renderPlayerSlot(
    ctx: CanvasRenderingContext2D,
    player: PartyPlayer, isHost: boolean,
    raceRect: { x: number; y: number; w: number; h: number },
    isLocal = false,
    slotIndex = 0,
    showRaceBtn = false,
  ): void {
    _renderPlayerSlot(ctx, this.sprites, this._renderState, player, isHost, raceRect, isLocal, slotIndex, showRaceBtn);
  }

  private drawDuelProjectile(ctx: CanvasRenderingContext2D, proj: DuelProjectile, baseY: number, unitSize: number, screenW: number): void {
    _drawDuelProjectile(ctx, this.sprites, this.animTime, proj, baseY, unitSize, screenW, this.tileToScreen.bind(this));
  }

  private drawDuelUnit(ctx: CanvasRenderingContext2D, unit: DuelUnit, size: number, baseY: number, frameTick: number, screenW: number): void {
    _drawDuelUnit(ctx, this.sprites, this.animTime, unit, size, baseY, frameTick, screenW, this.tileToScreen.bind(this));
  }
}
