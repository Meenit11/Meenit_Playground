'use strict';
/**
 * Example game module: a trivial counter race.
 * Shows the module interface from PROTOCOL.md section 3 and is used by the
 * engine tests. Each player has a private `secret` that only they can see.
 *
 * Actions: start (host), tap, leave, kick (host), restart (host).
 */

function clone(v) {
  return structuredClone(v);
}

function host(state, playerId) {
  if (state.hostId !== playerId) throw new Error('Only the host can do that');
}

module.exports = {
  name: '_example',

  defaultSettings: { target: 5 },

  validateSettings(settings) {
    const target = Number(settings.target);
    if (!Number.isInteger(target) || target < 1 || target > 100) {
      throw new Error('Target must be between 1 and 100');
    }
    return { target };
  },

  init({ code, hostId, hostName, settings }) {
    return {
      code,
      phase: 'lobby',
      hostId,
      settings,
      players: [{ id: hostId, name: hostName, isHost: true, taps: 0, secret: `s-${hostId}` }],
      winnerId: null,
    };
  },

  join(state, player) {
    const next = clone(state);
    next.players.push({ ...player, taps: 0, secret: `s-${player.id}` });
    return next;
  },

  reduce(state, action, playerId) {
    const next = clone(state);
    const me = next.players.find((p) => p.id === playerId);
    switch (action.type) {
      case 'start':
        host(next, playerId);
        if (next.phase !== 'lobby') throw new Error('The game has already started');
        if (next.players.length < 2) throw new Error('You need at least 2 players');
        next.phase = 'playing';
        return next;
      case 'tap':
        if (next.phase !== 'playing') throw new Error('The game is not running');
        me.taps += 1;
        if (me.taps >= next.settings.target) {
          next.phase = 'ended';
          next.winnerId = playerId;
        }
        return next;
      case 'leave':
        next.players = next.players.filter((p) => p.id !== playerId);
        if (next.hostId === playerId && next.players.length) {
          next.hostId = next.players[0].id;
          next.players[0].isHost = true;
        }
        return next;
      case 'kick': {
        host(next, playerId);
        const target = action.payload && action.payload.playerId;
        if (!target || target === playerId) throw new Error('Pick a player to remove');
        next.players = next.players.filter((p) => p.id !== target);
        return next;
      }
      case 'restart':
        host(next, playerId);
        next.phase = 'lobby';
        next.winnerId = null;
        for (const p of next.players) p.taps = 0;
        return next;
      default:
        throw new Error(`Unknown action '${action.type}'`);
    }
  },

  view(state, playerId) {
    const v = clone(state);
    v.players = v.players.map((p) => {
      const { secret, ...pub } = p;
      return pub;
    });
    const me = state.players.find((p) => p.id === playerId);
    v.me = me ? { id: playerId, secret: me.secret, taps: me.taps } : { id: playerId };
    return v;
  },
};
