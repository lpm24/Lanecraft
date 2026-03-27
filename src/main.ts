import { SceneManager } from './scenes/Scene';
import { TitleScene } from './scenes/TitleScene';
import { RaceSelectScene } from './scenes/RaceSelectScene';
import { DifficultySelectScene } from './scenes/DifficultySelectScene';
import { MatchScene } from './scenes/MatchScene';
import { PostMatchScene } from './scenes/PostMatchScene';
import { UnitGalleryScene } from './scenes/UnitGalleryScene';
import { recordMatch } from './util/BalanceTracker';
import { SpriteLoader } from './rendering/SpriteLoader';
import { UIAssets } from './rendering/UIAssets';
import { Race, createSeededRng } from './simulation/types';
import { BotDifficultyLevel } from './simulation/BotAI';
import { getMapById } from './simulation/maps';
import { ProfileScene } from './profile/ProfileScene';
import { loadProfile, updateProfileFromMatch, ACHIEVEMENTS } from './profile/ProfileData';
import { SoundManager } from './audio/SoundManager';
import { MusicPlayer } from './audio/MusicPlayer';

// Polyfill CanvasRenderingContext2D.roundRect for older browsers (Safari <15.4, Firefox <112)
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, radii?: number | number[]) {
    const r = typeof radii === 'number' ? [radii, radii, radii, radii]
      : Array.isArray(radii) ? [radii[0] ?? 0, radii[1] ?? radii[0] ?? 0, radii[2] ?? radii[0] ?? 0, radii[3] ?? radii[1] ?? radii[0] ?? 0]
      : [0, 0, 0, 0];
    this.moveTo(x + r[0], y);
    this.lineTo(x + w - r[1], y);
    this.arcTo(x + w, y, x + w, y + r[1], r[1]);
    this.lineTo(x + w, y + h - r[2]);
    this.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]);
    this.lineTo(x + r[3], y + h);
    this.arcTo(x, y + h, x, y + h - r[3], r[3]);
    this.lineTo(x, y + r[0]);
    this.arcTo(x, y, x + r[0], y, r[0]);
    this.closePath();
  };
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

// Suppress native long-press context menu on mobile (Copy/Translate/etc.)
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Shared asset loaders
const sharedSprites = new SpriteLoader();
const sharedUI = new UIAssets();

// Start loading all assets immediately
const uiReady = sharedUI.preload();
const spritesReady = sharedSprites.preloadAll();

// Wait for UI assets (critical for title screen), then start.
// Game sprites can finish loading in the background.
uiReady.then(() => {
  const overlay = document.getElementById('loading-overlay');

  const manager = new SceneManager(canvas);

  // Achievement toast sound
  const toastSfx = new SoundManager();
  manager.setOnToastShow(() => toastSfx.playAchievement());

  // Shared music player for mp3 tracks (menu, race select, combat)
  const musicPlayer = new MusicPlayer();

  // "Now Playing" — forward track name into the active scene
  musicPlayer.onTrackChange = (name: string) => {
    titleScene.setNowPlaying(name);
    matchScene.setNowPlaying(name);
  };

  const profile = loadProfile();
  const titleScene = new TitleScene(manager, canvas, sharedUI, sharedSprites, musicPlayer);
  titleScene.profile = profile;
  const postMatchScene = new PostMatchScene(manager, canvas, sharedUI, sharedSprites);

  // Track selected race between scenes
  let selectedRace: Race = Race.Crown;

  const matchScene = new MatchScene(canvas, sharedUI, musicPlayer, (game) => {
    recordMatch(game.state);
    // Reload profile to pick up out-of-match achievement progress (duels, gallery)
    const freshProfile = loadProfile();
    const newAch = updateProfileFromMatch(freshProfile, game.state, game.playerSlot, game.isMultiplayer);
    for (const achId of newAch) {
      const def = ACHIEVEMENTS.find(a => a.id === achId);
      if (def) manager.showToast(`Achievement: ${def.name}`, def.desc);
    }
    const wasParty = game.isMultiplayer;
    postMatchScene.setStats({
      state: game.state,
      localPlayerId: game.playerSlot,
      slotNames: game.slotNames,
      slotBotDifficulties: game.slotBotDifficulties,
      wasPartyGame: wasParty,
      replayFrames: game.replayFrames,
    });
    // Party games: reset to lobby. Solo games: clean up party.
    if (wasParty && titleScene.party) {
      titleScene.party.resetToWaiting();
    } else if (titleScene.party) {
      titleScene.party.leaveParty();
    }
    manager.switchTo('postMatch');
  });

  matchScene.setOnQuitGame(() => {
    // Reset party to lobby if in a party game, so players stay together
    if (titleScene.party?.state) {
      titleScene.party.resetToWaiting();
    }
    manager.switchTo('title');
  });

  const raceSelectScene = new RaceSelectScene(manager, canvas, sharedSprites, sharedUI, musicPlayer, (race) => {
    selectedRace = race;
    manager.switchTo('difficultySelect');
  });

  const difficultySelectScene = new DifficultySelectScene(manager, canvas, sharedUI, (difficulty, mapDef, teamSize, fogOfWar, isometric) => {
    // Build solo config using party path for proper teamSize support
    const ppt = mapDef.playersPerTeam;
    const bots: { [slot: string]: string } = {};
    // Fill enemy team active slots with bots
    for (let t = 0; t < mapDef.teams.length; t++) {
      for (let s = 0; s < teamSize; s++) {
        const slot = t * ppt + s;
        if (slot === 0) continue; // player slot
        bots[String(slot)] = difficulty;
      }
    }
    matchScene.setPartyConfig({
      humanPlayers: [{ slot: 0, race: selectedRace }],
      slotBots: bots,
      localSlot: 0,
      seed: Math.floor(Math.random() * 2147483647),
      partyCode: '',
      botDifficulty: difficulty,
      mapDef,
      slotNames: { '0': titleScene.name },
      fogOfWar,
      isometric,
    });
    manager.switchTo('match');
  });

  // Party start callback: all humans go straight into match (skip race select)
  titleScene.onPartyStart = (party, localSlot) => {
    const mapDef = getMapById(party.mapId);
    const difficulty = (party.difficulty as BotDifficultyLevel) ?? BotDifficultyLevel.Medium;
    const allRaces = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
    // Build human player list from party slots, resolve random races
    // Use seeded RNG so all clients resolve the same random races
    const raceRng = createSeededRng(party.seed);
    const humanPlayers: { slot: number; race: Race }[] = [];
    for (let i = 0; i < party.maxSlots; i++) {
      const p = party.players[String(i)];
      if (p) {
        const race = (p.race as string) === 'random'
          ? allRaces[Math.floor(raceRng() * allRaces.length)]
          : p.race;
        humanPlayers.push({ slot: i, race });
      }
    }
    // Build slot names from party players
    const slotNames: { [slot: string]: string } = {};
    for (let i = 0; i < party.maxSlots; i++) {
      const p = party.players[String(i)];
      if (p) slotNames[String(i)] = p.name;
    }
    matchScene.setPartyConfig({
      humanPlayers,
      slotBots: party.bots,
      slotBotRaces: party.botRaces,
      localSlot,
      seed: party.seed,
      partyCode: party.code,
      botDifficulty: difficulty,
      mapDef,
      slotNames,
      fogOfWar: party.fogOfWar ?? true,
    });
    manager.switchTo('match');
  };

  // Local setup start callback: solo game with configured bot slots
  titleScene.onLocalStart = (setup) => {
    const mapDef = getMapById(setup.mapId);
    // Resolve 'random' player race
    const allRaces = [Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon, Race.Deep, Race.Wild, Race.Geists, Race.Tenders];
    const playerRace = setup.playerRace === 'random'
      ? allRaces[Math.floor(Math.random() * allRaces.length)]
      : setup.playerRace;
    matchScene.setPartyConfig({
      humanPlayers: [{ slot: setup.playerSlot, race: playerRace }],
      slotBots: setup.bots,
      slotBotRaces: setup.botRaces,
      localSlot: setup.playerSlot,
      seed: Math.floor(Math.random() * 2147483647),
      partyCode: '',  // empty = local game, no CommandSync
      botDifficulty: BotDifficultyLevel.Medium,
      mapDef,
      slotNames: { [String(setup.playerSlot)]: titleScene.name },
      fogOfWar: setup.fogOfWar ?? true,
    });
    manager.switchTo('match');
  };

  const galleryScene = new UnitGalleryScene(manager, canvas, sharedSprites, sharedUI);
  const profileScene = new ProfileScene(manager, canvas, sharedUI, sharedSprites);

  manager.register('title', titleScene);
  manager.register('raceSelect', raceSelectScene);
  manager.register('difficultySelect', difficultySelectScene);
  manager.register('match', matchScene);
  manager.register('postMatch', postMatchScene);
  manager.register('gallery', galleryScene);
  manager.register('profile', profileScene);

  manager.start('title');

  // Fade out the loading overlay
  if (overlay) {
    overlay.classList.add('fade-out');
    overlay.addEventListener('transitionend', () => overlay.remove());
  }
});

// Ensure game sprites finish loading (fire-and-forget, but log errors)
spritesReady.catch((err) => console.warn('Sprite preload error:', err));
