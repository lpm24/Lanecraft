import { SceneManager } from './scenes/Scene';
import { TitleScene } from './scenes/TitleScene';
import { RaceSelectScene } from './scenes/RaceSelectScene';
import { MatchScene } from './scenes/MatchScene';
import { PostMatchScene } from './scenes/PostMatchScene';
import { UnitGalleryScene } from './scenes/UnitGalleryScene';
import { recordMatch } from './util/BalanceTracker';
import { SpriteLoader } from './rendering/SpriteLoader';
import { UIAssets } from './rendering/UIAssets';
import { Race } from './simulation/types';
import { BotDifficultyLevel } from './simulation/BotAI';
import { ProfileScene } from './profile/ProfileScene';
import { loadProfile, updateProfileFromMatch } from './profile/ProfileData';

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

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

  const profile = loadProfile();
  const titleScene = new TitleScene(manager, canvas, sharedUI, sharedSprites);
  titleScene.profile = profile;
  const postMatchScene = new PostMatchScene(manager, canvas, sharedUI);

  const matchScene = new MatchScene(canvas, sharedUI, (game) => {
    recordMatch(game.state);
    const newAch = updateProfileFromMatch(profile, game.state, game.playerSlot);
    if (newAch.length > 0) console.log('[Profile] New achievements:', newAch);
    postMatchScene.setStats({ state: game.state, localPlayerId: game.playerSlot });
    // Clean up party data from Firebase when match ends
    if (titleScene.party) {
      titleScene.party.leaveParty();
    }
    manager.switchTo('postMatch');
  });

  const raceSelectScene = new RaceSelectScene(manager, canvas, sharedSprites, sharedUI, (result) => {
    matchScene.setPlayerRace(result.playerRace, result.botDifficulty);
    manager.switchTo('match');
  });

  // Party start callback: host + guest go straight into match (skip race select)
  titleScene.onPartyStart = (party, isHost) => {
    const hostRace = party.host.race;
    const guestRace = party.guest?.race ?? Race.Crown;
    const difficulty = (party.difficulty as BotDifficultyLevel) ?? BotDifficultyLevel.Medium;
    matchScene.setPartyConfig(hostRace, guestRace, party.seed, party.code, isHost, difficulty);
    manager.switchTo('match');
  };

  const galleryScene = new UnitGalleryScene(manager, canvas, sharedSprites, sharedUI);
  const profileScene = new ProfileScene(manager, canvas, sharedUI, sharedSprites);

  manager.register('title', titleScene);
  manager.register('raceSelect', raceSelectScene);
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
