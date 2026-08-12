// Server-authoritative game state machine.
// The client is NEVER allowed to set state directly - only the server
// transitions state, and only along edges defined here.

const STATES = Object.freeze({
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  EVENT: 'EVENT',
  BODY_FOUND: 'BODY_FOUND',
  MEETING: 'MEETING',
  VOTING: 'VOTING',
  RESULT: 'RESULT',
  GAME_OVER: 'GAME_OVER',
});

// Adjacency list of allowed transitions. Anything not listed here is
// rejected by GameState.canTransition().
const TRANSITIONS = {
  [STATES.LOBBY]: [STATES.COUNTDOWN],
  [STATES.COUNTDOWN]: [STATES.PLAYING, STATES.LOBBY], // LOBBY = abort (e.g. player left)
  [STATES.PLAYING]: [STATES.EVENT, STATES.BODY_FOUND, STATES.MEETING, STATES.GAME_OVER],
  [STATES.EVENT]: [STATES.PLAYING, STATES.GAME_OVER],
  [STATES.BODY_FOUND]: [STATES.MEETING, STATES.GAME_OVER],
  [STATES.MEETING]: [STATES.VOTING, STATES.GAME_OVER],
  [STATES.VOTING]: [STATES.RESULT, STATES.GAME_OVER],
  [STATES.RESULT]: [STATES.PLAYING, STATES.GAME_OVER],
  [STATES.GAME_OVER]: [STATES.LOBBY], // rematch / return to lobby
};

class GameState {
  constructor(initial = STATES.LOBBY) {
    this._state = initial;
    this._history = [initial];
  }

  get current() {
    return this._state;
  }

  canTransition(next) {
    const allowed = TRANSITIONS[this._state] || [];
    return allowed.includes(next);
  }

  transition(next) {
    if (!this.canTransition(next)) {
      throw new Error(`Invalid state transition: ${this._state} -> ${next}`);
    }
    this._state = next;
    this._history.push(next);
    return this._state;
  }

  get history() {
    return [...this._history];
  }
}

module.exports = { GameState, STATES };
