// Assigns roles for a round. The server is the only thing that ever
// decides roles - clients only ever receive the role they personally hold
// (Player.toPrivate()) plus, if they are an IMPOSTER, the identities of
// their fellow imposters (needed to coordinate a kill).

const ROLES = Object.freeze({
  CREW: 'CREW',
  IMPOSTER: 'IMPOSTER',
});

// Roughly 1 imposter per 4 players, minimum 1, and always leaving crew
// in the majority so a vote can still meaningfully happen.
function imposterCount(playerCount) {
  const count = Math.max(1, Math.floor(playerCount / 4));
  return Math.min(count, Math.ceil(playerCount / 2) - 1) || 1;
}

// Mutates each player's `.role`. Returns { crew: Player[], imposters: Player[] }.
function assignRoles(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const nImposters = imposterCount(shuffled.length);
  const imposters = shuffled.slice(0, nImposters);
  const crew = shuffled.slice(nImposters);

  imposters.forEach((p) => { p.role = ROLES.IMPOSTER; });
  crew.forEach((p) => { p.role = ROLES.CREW; });

  return { crew, imposters };
}

module.exports = { ROLES, assignRoles, imposterCount };
