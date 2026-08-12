// Server-authoritative game state machine.
// The client is NEVER allowed to set state directly - only the server
// transitions state, and only along edges defined here.
//
// Full round loop:
//   LOBBY -> STARTING -> NIGHT -> DISCUSSION -> VOTING -> RESULT -> (NIGHT | GAME_OVER)
//   GAME_OVER -> LOBBY (rematch)

const STATES = Object.freeze({
  LOBBY: 'LOBBY',
  STARTING: 'STARTING', // role assignment + short countdown
  NIGHT: 'NIGHT', // imposter(s) privately choose a kill target
  DISCUSSION: 'DISCUSSION', // everyone talks, deaths from the night are revealed
  VOTING: 'VOTING', // alive players vote to eliminate a suspect
  RESULT: 'RESULT', // vote outcome revealed, win condition checked
  GAME_OVER: 'GAME_OVER',
});

// Adjacency list of allowed transitions. Anything not listed here is
// rejected by GameState.canTransition().
const TRANSITIONS = {
  [STATES.LOBBY]: [STATES.STARTING],
  [STATES.STARTING]: [STATES.NIGHT, STATES.LOBBY], // LOBBY = abort (e.g. not enough players left)
  [STATES.NIGHT]: [STATES.DISCUSSION, STATES.GAME_OVER],
  [STATES.DISCUSSION]: [STATES.VOTING, STATES.GAME_OVER],
  [STATES.VOTING]: [STATES.RESULT, STATES.GAME_OVER],
  [STATES.RESULT]: [STATES.NIGHT, STATES.GAME_OVER],
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
