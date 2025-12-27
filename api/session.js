// Session Management - Serverless Function with Vercel KV Storage
// Uses Redis for persistent sessions across serverless function instances

const { kv } = require('@vercel/kv');

// Session key prefix
const SESSION_PREFIX = 'vibesync:session:';
const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds

// Generate unique session code
function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get session from KV store
async function getSession(code) {
  if (!code) return null;
  try {
    const session = await kv.get(`${SESSION_PREFIX}${code.toUpperCase()}`);
    return session;
  } catch (error) {
    console.error('KV get error:', error);
    return null;
  }
}

// Save session to KV store
async function saveSession(code, session) {
  try {
    await kv.set(`${SESSION_PREFIX}${code.toUpperCase()}`, session, { ex: SESSION_TTL });
    return true;
  } catch (error) {
    console.error('KV set error:', error);
    return false;
  }
}

// Delete session from KV store
async function deleteSession(code) {
  try {
    await kv.del(`${SESSION_PREFIX}${code.toUpperCase()}`);
    return true;
  } catch (error) {
    console.error('KV delete error:', error);
    return false;
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;
  let body = req.body || {};
  
  // Parse body if string
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  // Debug logging
  console.log(`Session API: action=${action}`);

  try {
    switch (action) {
      // Create a new session (Host only)
      case 'create': {
        const { hostToken, hostName, hostId } = body;
        
        if (!hostToken) {
          return res.status(400).json({ error: 'Host token required' });
        }

        const code = generateSessionCode();
        const session = {
          code,
          hostId,
          hostName: hostName || 'Host',
          hostToken,
          queue: [],
          guests: [],
          history: [],
          reactions: [],
          playRequests: [],
          currentTrack: null,
          isPlaying: false,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          settings: {
            allowVoting: true,
            allowGuestRemove: false,
            autoPlay: true,
            syncPlayback: true
          }
        };

        const saved = await saveSession(code, session);
        
        if (!saved) {
          return res.status(500).json({ error: 'Failed to create session - storage error' });
        }
        
        console.log(`Session created: ${code}`);
        
        return res.json({
          success: true,
          session: {
            code,
            hostName: session.hostName,
            queueLength: 0,
            guestCount: 0
          }
        });
      }

      // Join an existing session (Guest) - NOW STORES TOKEN FOR SYNC
      case 'join': {
        const { code, guestName, guestId, guestToken } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        console.log(`Join attempt: code=${code.toUpperCase()}, guestName=${guestName}, hasToken=${!!guestToken}`);

        const session = await getSession(code);
        
        if (!session) {
          console.log(`Session ${code.toUpperCase()} not found in KV store`);
          return res.status(404).json({ 
            error: 'Session not found',
            hint: 'The session may have expired. Please ask the host to create a new session.'
          });
        }

        // Add or update guest
        const guestIdent = guestId || `guest_${Date.now()}`;
        const existingGuestIndex = session.guests.findIndex(g => g.id === guestIdent);
        
        const guestData = {
          id: guestIdent,
          name: guestName || `Guest ${session.guests.length + 1}`,
          token: guestToken, // Store token for sync!
          joinedAt: Date.now()
        };

        if (existingGuestIndex >= 0) {
          // Update existing guest (refresh token)
          session.guests[existingGuestIndex] = { 
            ...session.guests[existingGuestIndex], 
            ...guestData 
          };
        } else {
          session.guests.push(guestData);
        }

        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          session: {
            code: session.code,
            hostName: session.hostName,
            queue: session.queue,
            guests: session.guests.map(g => ({ id: g.id, name: g.name })),
            history: session.history.slice(-10),
            currentTrack: session.currentTrack,
            isPlaying: session.isPlaying,
            settings: session.settings
          }
        });
      }

      // Get session state (polling)
      case 'get': {
        const { code } = req.query;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Clear old reactions (older than 5 seconds)
        const now = Date.now();
        const oldReactionsCount = session.reactions.length;
        session.reactions = session.reactions.filter(r => now - r.timestamp < 5000);
        
        // Only save if reactions changed (to reduce writes)
        if (session.reactions.length !== oldReactionsCount) {
          await saveSession(code, session);
        }

        return res.json({
          success: true,
          session: {
            code: session.code,
            hostName: session.hostName,
            queue: session.queue,
            guests: session.guests.map(g => ({ id: g.id, name: g.name })),
            history: session.history.slice(-10),
            currentTrack: session.currentTrack,
            isPlaying: session.isPlaying,
            reactions: session.reactions,
            playRequests: session.playRequests || [],
            settings: session.settings,
            lastActivity: session.lastActivity
          }
        });
      }

      // Get all tokens for synchronized playback
      case 'get-all-tokens': {
        const { code } = req.query;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Collect all tokens (host + guests with tokens)
        const tokens = [];
        
        if (session.hostToken) {
          tokens.push(session.hostToken);
          console.log('Host token: present');
        } else {
          console.log('Host token: MISSING');
        }
        
        session.guests.forEach((g, i) => {
          if (g.token) {
            tokens.push(g.token);
            console.log(`Guest ${i} (${g.name}): token present`);
          } else {
            console.log(`Guest ${i} (${g.name}): NO TOKEN - guest needs to rejoin session`);
          }
        });
        
        console.log(`Total tokens for sync: ${tokens.length} (host + ${session.guests.length} guests)`);

        return res.json({
          success: true,
          tokens,
          participantCount: tokens.length,
          guestsWithoutTokens: session.guests.filter(g => !g.token).map(g => g.name)
        });
      }

      // Add track to queue
      case 'addTrack': {
        const { code, track, addedBy, addedById } = body;
        
        if (!code || !track) {
          return res.status(400).json({ error: 'Session code and track required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Check if track already in queue
        const existingTrack = session.queue.find(t => t.id === track.id);
        if (existingTrack) {
          return res.status(400).json({ error: 'Track already in queue' });
        }

        session.queue.push({
          ...track,
          addedBy: addedBy || 'Guest',
          addedById: addedById,
          addedAt: Date.now(),
          votes: 1,
          votedBy: [addedById || addedBy || 'Guest']
        });

        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          queue: session.queue
        });
      }

      // Vote for a track
      case 'vote': {
        const { code, trackId, voterId, voteType } = body;
        
        if (!code || !trackId) {
          return res.status(400).json({ error: 'Session code and track ID required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.settings.allowVoting) {
          return res.status(403).json({ error: 'Voting disabled' });
        }

        const track = session.queue.find(t => t.id === trackId);
        if (!track) {
          return res.status(404).json({ error: 'Track not found in queue' });
        }

        // Check if already voted
        const voterIdent = voterId || 'anonymous';
        if (!track.votedBy) track.votedBy = [];
        
        if (track.votedBy.includes(voterIdent)) {
          // Remove vote (toggle)
          track.votes = Math.max(0, track.votes - 1);
          track.votedBy = track.votedBy.filter(v => v !== voterIdent);
        } else {
          // Add vote
          track.votes = (track.votes || 0) + 1;
          track.votedBy.push(voterIdent);
        }

        // Sort queue by votes (higher votes first)
        session.queue.sort((a, b) => (b.votes || 0) - (a.votes || 0));
        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          queue: session.queue
        });
      }

      // Remove track from queue (host or track owner)
      case 'removeTrack': {
        const { code, trackId, requesterId, isHost } = body;
        
        if (!code || !trackId) {
          return res.status(400).json({ error: 'Session code and track ID required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        const trackIndex = session.queue.findIndex(t => t.id === trackId);
        if (trackIndex === -1) {
          return res.status(404).json({ error: 'Track not found' });
        }

        // Only host or track owner can remove (unless guest remove is allowed)
        const track = session.queue[trackIndex];
        if (!isHost && track.addedById !== requesterId && !session.settings.allowGuestRemove) {
          return res.status(403).json({ error: 'Not authorized to remove this track' });
        }

        session.queue.splice(trackIndex, 1);
        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          queue: session.queue
        });
      }

      // Update current track (for sync status)
      case 'update-track': {
        const { code, track } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Add old track to history if exists
        if (session.currentTrack && session.currentTrack.id !== track?.id) {
          session.history.push({
            ...session.currentTrack,
            playedAt: Date.now()
          });
          // Keep only last 50 tracks in history
          if (session.history.length > 50) {
            session.history = session.history.slice(-50);
          }
        }

        session.currentTrack = track;
        session.isPlaying = !!track;
        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          currentTrack: session.currentTrack,
          history: session.history.slice(-10)
        });
      }

      // Play next track from queue (host only) - returns tokens for sync
      case 'playNext': {
        const { code } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        if (session.queue.length === 0) {
          return res.status(400).json({ error: 'Queue is empty' });
        }

        // Add current track to history
        if (session.currentTrack) {
          session.history.push({
            ...session.currentTrack,
            playedAt: Date.now()
          });
        }

        // Remove first track and return it
        const nextTrack = session.queue.shift();
        session.currentTrack = nextTrack;
        session.isPlaying = true;
        session.lastActivity = Date.now();

        // Collect all tokens for sync
        const tokens = [session.hostToken];
        session.guests.forEach(g => {
          if (g.token) tokens.push(g.token);
        });

        await saveSession(code, session);

        return res.json({
          success: true,
          track: nextTrack,
          queue: session.queue,
          tokens,
          history: session.history.slice(-10)
        });
      }

      // Send reaction (emoji)
      case 'react': {
        const { code, emoji, userName, userId } = body;
        
        if (!code || !emoji) {
          return res.status(400).json({ error: 'Session code and emoji required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        session.reactions.push({
          emoji,
          userName: userName || 'Anonymous',
          userId,
          timestamp: Date.now()
        });

        // Keep only last 20 reactions
        if (session.reactions.length > 20) {
          session.reactions = session.reactions.slice(-20);
        }

        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          reactions: session.reactions
        });
      }

      // Update participant token (for when tokens refresh)
      case 'update-token': {
        const { code, oderId, userId, newToken, isHost } = body;
        const participantId = userId || oderId; // Support both for backwards compat
        
        if (!code || !newToken) {
          return res.status(400).json({ error: 'Session code and new token required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          // Not an error - session might have ended, just log it
          console.log(`Token update for non-existent session ${code} - ignoring`);
          return res.json({ success: true, message: 'Session not found, token not updated' });
        }

        if (isHost) {
          session.hostToken = newToken;
          console.log('Updated host token');
        } else {
          const guest = session.guests.find(g => g.id === participantId);
          if (guest) {
            guest.token = newToken;
            console.log(`Updated token for guest: ${guest.name}`);
          } else {
            // Guest might have left, not an error
            console.log(`Guest ${participantId} not found for token update - may have left`);
          }
        }

        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({ success: true });
      }

      // Request to play (guest requests host to play a song)
      case 'request-play': {
        const { code, track, requestedBy, requestedById } = body;
        
        if (!code || !track) {
          return res.status(400).json({ error: 'Session code and track required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Add to pending requests
        if (!session.playRequests) session.playRequests = [];
        
        // Check if already requested
        const existing = session.playRequests.find(r => r.track.id === track.id);
        if (existing) {
          return res.status(400).json({ error: 'Song already requested' });
        }

        session.playRequests.push({
          track,
          requestedBy: requestedBy || 'Guest',
          requestedById,
          requestedAt: Date.now()
        });

        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          message: 'Request sent to host',
          requests: session.playRequests
        });
      }

      // Clear play request
      case 'clear-request': {
        const { code, trackId } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        if (session.playRequests) {
          session.playRequests = session.playRequests.filter(r => r.track.id !== trackId);
        }

        await saveSession(code, session);

        return res.json({
          success: true,
          requests: session.playRequests || []
        });
      }

      // Update session settings (host only)
      case 'updateSettings': {
        const { code, settings } = body;
        
        if (!code || !settings) {
          return res.status(400).json({ error: 'Session code and settings required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        session.settings = { ...session.settings, ...settings };
        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          settings: session.settings
        });
      }

      // End session (host only)
      case 'end': {
        const { code } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const deleted = await deleteSession(code);
        
        return res.json({
          success: deleted,
          message: deleted ? 'Session ended' : 'Session not found'
        });
      }

      // Leave session (guest)
      case 'leave': {
        const { code, guestId } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = await getSession(code);
        
        if (!session) {
          // Session already ended, that's fine
          return res.json({ success: true, message: 'Session already ended' });
        }

        session.guests = session.guests.filter(g => g.id !== guestId);
        session.lastActivity = Date.now();
        await saveSession(code, session);

        return res.json({
          success: true,
          guestCount: session.guests.length
        });
      }

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Session error:', error);
    return res.status(500).json({ error: 'Session operation failed', details: error.message });
  }
};
