// Session Management - Serverless Function with In-Memory Store
// Note: For production, use Redis or a database like MongoDB/Supabase

// In-memory session store (works for single instance)
// For Vercel, we'll use a simple approach with KV store simulation
const sessions = new Map();

// Generate unique session code
function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Clean old sessions (older than 24 hours)
function cleanOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  for (const [code, session] of sessions.entries()) {
    if (now - session.createdAt > maxAge) {
      sessions.delete(code);
    }
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
  const body = req.body || {};

  // Clean old sessions periodically
  cleanOldSessions();

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
          createdAt: Date.now(),
          lastActivity: Date.now(),
          settings: {
            allowVoting: true,
            allowGuestRemove: false,
            autoPlay: true
          }
        };

        sessions.set(code, session);
        
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

      // Join an existing session (Guest)
      case 'join': {
        const { code, guestName, guestId } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Add guest if not already in
        const existingGuest = session.guests.find(g => g.id === guestId);
        if (!existingGuest) {
          session.guests.push({
            id: guestId || `guest_${Date.now()}`,
            name: guestName || `Guest ${session.guests.length + 1}`,
            joinedAt: Date.now()
          });
        }

        session.lastActivity = Date.now();

        return res.json({
          success: true,
          session: {
            code: session.code,
            hostName: session.hostName,
            queue: session.queue,
            guests: session.guests,
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

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        return res.json({
          success: true,
          session: {
            code: session.code,
            hostName: session.hostName,
            hostToken: session.hostToken, // Only return to validate host
            queue: session.queue,
            guests: session.guests,
            settings: session.settings,
            lastActivity: session.lastActivity
          }
        });
      }

      // Add track to queue
      case 'addTrack': {
        const { code, track, addedBy } = body;
        
        if (!code || !track) {
          return res.status(400).json({ error: 'Session code and track required' });
        }

        const session = sessions.get(code.toUpperCase());
        
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
          addedAt: Date.now(),
          votes: 1,
          votedBy: [addedBy || 'Guest']
        });

        session.lastActivity = Date.now();

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

        const session = sessions.get(code.toUpperCase());
        
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

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        const trackIndex = session.queue.findIndex(t => t.id === trackId);
        if (trackIndex === -1) {
          return res.status(404).json({ error: 'Track not found' });
        }

        // Only host or track owner can remove (unless guest remove is allowed)
        const track = session.queue[trackIndex];
        if (!isHost && track.addedBy !== requesterId && !session.settings.allowGuestRemove) {
          return res.status(403).json({ error: 'Not authorized to remove this track' });
        }

        session.queue.splice(trackIndex, 1);
        session.lastActivity = Date.now();

        return res.json({
          success: true,
          queue: session.queue
        });
      }

      // Reorder queue (host only)
      case 'reorder': {
        const { code, fromIndex, toIndex } = body;
        
        if (!code || fromIndex === undefined || toIndex === undefined) {
          return res.status(400).json({ error: 'Session code and indices required' });
        }

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        const [movedTrack] = session.queue.splice(fromIndex, 1);
        session.queue.splice(toIndex, 0, movedTrack);
        session.lastActivity = Date.now();

        return res.json({
          success: true,
          queue: session.queue
        });
      }

      // Play next track from queue (host only)
      case 'playNext': {
        const { code } = body;
        
        if (!code) {
          return res.status(400).json({ error: 'Session code required' });
        }

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        if (session.queue.length === 0) {
          return res.status(400).json({ error: 'Queue is empty' });
        }

        // Remove first track and return it
        const nextTrack = session.queue.shift();
        session.lastActivity = Date.now();

        return res.json({
          success: true,
          track: nextTrack,
          queue: session.queue,
          hostToken: session.hostToken
        });
      }

      // Update session settings (host only)
      case 'updateSettings': {
        const { code, settings } = body;
        
        if (!code || !settings) {
          return res.status(400).json({ error: 'Session code and settings required' });
        }

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        session.settings = { ...session.settings, ...settings };
        session.lastActivity = Date.now();

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

        const deleted = sessions.delete(code.toUpperCase());
        
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

        const session = sessions.get(code.toUpperCase());
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        session.guests = session.guests.filter(g => g.id !== guestId);
        session.lastActivity = Date.now();

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
    return res.status(500).json({ error: 'Session operation failed' });
  }
};
