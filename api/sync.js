// Synchronized playback for all participants
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;
  
  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  
  const { tokens, trackUri, position } = body;

  // tokens should be an array of all participants' access tokens
  // Example: ["token1", "token2", "token3"]

  if (!tokens || !Array.isArray(tokens)) {
    return res.status(400).json({ error: 'Tokens array required' });
  }

  console.log(`Sync API: action=${action}, tokens count=${tokens.length}`);

  try {
    switch (action) {
      case 'play-sync':
        // Play the same track on all devices at the same position
        if (!trackUri) {
          return res.status(400).json({ error: 'Track URI required' });
        }

        console.log(`Playing ${trackUri} on ${tokens.length} devices`);

        const playPromises = tokens.map(async (token, index) => {
          try {
            const response = await fetch('https://api.spotify.com/v1/me/player/play', {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                uris: [trackUri],
                position_ms: position || 0
              })
            });

            let errorInfo = null;
            if (!response.ok) {
              try {
                errorInfo = await response.json();
              } catch (e) {
                errorInfo = await response.text();
              }
              console.error(`Device ${index} failed (${response.status}):`, errorInfo);
            } else {
              console.log(`Device ${index}: success`);
            }

            return { 
              success: response.ok, 
              status: response.status,
              error: errorInfo?.error?.message || errorInfo?.error?.reason || null
            };
          } catch (error) {
            console.error(`Device ${index} error:`, error.message);
            return { success: false, error: error.message };
          }
        });

        const playResults = await Promise.all(playPromises);
        const successCount = playResults.filter(r => r.success).length;
        
        return res.json({ 
          success: successCount > 0, 
          results: playResults,
          message: `Synced playback to ${successCount}/${tokens.length} devices`
        });

      case 'pause-sync':
        // Pause all devices
        const pausePromises = tokens.map(async (token, index) => {
          try {
            const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            return { success: response.ok, status: response.status };
          } catch (error) {
            return { success: false, error: error.message };
          }
        });

        const pauseResults = await Promise.all(pausePromises);
        return res.json({ 
          success: true, 
          results: pauseResults,
          message: `Paused ${pauseResults.filter(r => r.success).length}/${tokens.length} devices`
        });

      case 'resume-sync':
        // Resume all devices
        const resumePromises = tokens.map(async (token) => {
          try {
            const response = await fetch('https://api.spotify.com/v1/me/player/play', {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            return { success: response.ok, status: response.status };
          } catch (error) {
            return { success: false, error: error.message };
          }
        });

        const resumeResults = await Promise.all(resumePromises);
        return res.json({ 
          success: true, 
          results: resumeResults,
          message: `Resumed ${resumeResults.filter(r => r.success).length}/${tokens.length} devices`
        });

      case 'seek-sync':
        // Seek to same position on all devices
        if (position === undefined) {
          return res.status(400).json({ error: 'Position required' });
        }

        const seekPromises = tokens.map(async (token) => {
          try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${position}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            return { success: response.ok };
          } catch (error) {
            return { success: false, error: error.message };
          }
        });

        const seekResults = await Promise.all(seekPromises);
        return res.json({ 
          success: true, 
          results: seekResults,
          message: `Synced position on ${seekResults.filter(r => r.success).length}/${tokens.length} devices`
        });

      case 'get-states':
        // Get playback state from all devices to check sync
        const statePromises = tokens.map(async (token, index) => {
          try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (response.status === 204) {
              return { user: index, playing: false };
            }

            const data = await response.json();
            return {
              user: index,
              playing: data.is_playing,
              trackId: data.item?.id,
              trackName: data.item?.name,
              position: data.progress_ms,
              timestamp: data.timestamp
            };
          } catch (error) {
            return { user: index, error: error.message };
          }
        });

        const states = await Promise.all(statePromises);
        
        // Calculate sync drift
        const positions = states.filter(s => s.position !== undefined).map(s => s.position);
        const maxDrift = positions.length > 0 
          ? Math.max(...positions) - Math.min(...positions)
          : 0;

        return res.json({ 
          states,
          syncQuality: maxDrift < 1000 ? 'excellent' : maxDrift < 3000 ? 'good' : 'poor',
          driftMs: maxDrift
        });

      case 'skip-sync':
        // Skip to next track on all devices
        const skipPromises = tokens.map(async (token) => {
          try {
            const response = await fetch('https://api.spotify.com/v1/me/player/next', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            return { success: response.ok };
          } catch (error) {
            return { success: false, error: error.message };
          }
        });

        const skipResults = await Promise.all(skipPromises);
        return res.json({ 
          success: true, 
          results: skipResults,
          message: `Skipped on ${skipResults.filter(r => r.success).length}/${tokens.length} devices`
        });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Sync operation failed' });
  }
};
