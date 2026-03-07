import { SceneManager } from './scenes/Scene';
import { TitleScene } from './scenes/TitleScene';
import { RaceSelectScene } from './scenes/RaceSelectScene';
import { MatchScene } from './scenes/MatchScene';
import { PostMatchScene } from './scenes/PostMatchScene';
import { recordMatch } from './util/BalanceTracker';
import { SpriteLoader } from './rendering/SpriteLoader';
import { UIAssets } from './rendering/UIAssets';
import { Race } from './simulation/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

const manager = new SceneManager(canvas);

// Shared sprite loader — preload everything on the title screen
const sharedSprites = new SpriteLoader();
sharedSprites.preloadAll();

// Shared UI assets
const sharedUI = new UIAssets();
sharedUI.preload();

// Wire up scenes
const titleScene = new TitleScene(manager, canvas, sharedUI, sharedSprites);

const postMatchScene = new PostMatchScene(manager, canvas, sharedUI);

const matchScene = new MatchScene(canvas, sharedUI, (game) => {
  recordMatch(game.state);
  postMatchScene.setStats({ state: game.state, localPlayerId: 0 });
  manager.switchTo('postMatch');
});

const raceSelectScene = new RaceSelectScene(manager, canvas, sharedSprites, sharedUI, (result) => {
  matchScene.setPlayerRace(result.playerRace);
  manager.switchTo('match');
});

// Party start callback: host + guest go straight into match (skip race select)
titleScene.onPartyStart = (party) => {
  const hostRace = party.host.race;
  const guestRace = party.guest?.race ?? Race.Crown;
  matchScene.setPartyConfig(hostRace, guestRace, party.seed);
  manager.switchTo('match');
};

manager.register('title', titleScene);
manager.register('raceSelect', raceSelectScene);
manager.register('match', matchScene);
manager.register('postMatch', postMatchScene);

manager.start('title');
