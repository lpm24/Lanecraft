import { SceneManager } from './scenes/Scene';
import { TitleScene } from './scenes/TitleScene';
import { RaceSelectScene } from './scenes/RaceSelectScene';
import { MatchScene } from './scenes/MatchScene';
import { PostMatchScene } from './scenes/PostMatchScene';
import { recordMatch } from './util/BalanceTracker';

const canvas = document.getElementById('game') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas element not found');

const manager = new SceneManager(canvas);

// Wire up scenes
const titleScene = new TitleScene(manager, canvas);

const postMatchScene = new PostMatchScene(manager, canvas);

const matchScene = new MatchScene(canvas, (game) => {
  recordMatch(game.state);
  postMatchScene.setStats({ state: game.state, localPlayerId: 0 });
  manager.switchTo('postMatch');
});

const raceSelectScene = new RaceSelectScene(manager, canvas, (result) => {
  matchScene.setPlayerRace(result.playerRace);
  manager.switchTo('match');
});

manager.register('title', titleScene);
manager.register('raceSelect', raceSelectScene);
manager.register('match', matchScene);
manager.register('postMatch', postMatchScene);

manager.start('title');
