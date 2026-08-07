import './style.css';
import { Game } from './game/game.js';
import { crashHandler } from './core/errors.js';

const canvas = document.getElementById('game-canvas');

// Install crash handling BEFORE the game exists: a failure during construction
// (bad WebGL context, corrupt save, missing DOM node) is exactly the case where
// a frozen black screen is least explicable to the player.
crashHandler.install({ version: __APP_VERSION__ });

let game;
try {
  game = new Game(canvas);
  crashHandler.getState = () => game.crashState();
  crashHandler.startWatchdog();
} catch (err) {
  crashHandler.report(err, 'startup');
  throw err;
}

// handy for debugging from the console
window.game = game;
