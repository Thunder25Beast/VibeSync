// Control Spotify playback - Serverless Function
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, token } = req.query;
  let body = req.body;
  
  // Parse body if it's a string
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  
  console.log(`Playback API: action=${action}, method=${req.method}, body=`, body);

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    let spotifyResponse;

    switch (action) {
      case 'play':
        // Play specific tracks or resume
        console.log('Playing with body:', JSON.stringify(body));
        
        // If body has uris, play those tracks
        const playBody = body?.uris ? { uris: body.uris } : {};
        
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers,
          body: Object.keys(playBody).length > 0 ? JSON.stringify(playBody) : undefined
        });
        
        console.log('Spotify play response status:', spotifyResponse.status);
        break;

      case 'pause':
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers
        });
        break;

      case 'next':
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/next', {
          method: 'POST',
          headers
        });
        break;

      case 'previous':
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/previous', {
          method: 'POST',
          headers
        });
        break;

      case 'volume':
        // body should contain { volume_percent: 0-100 }
        const volume = body?.volume_percent || 50;
        spotifyResponse = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`, {
          method: 'PUT',
          headers
        });
        break;

      case 'current':
        // Get currently playing track
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers
        });
        
        if (spotifyResponse.status === 204) {
          return res.json({ isPlaying: false, track: null });
        }
        
        const currentData = await spotifyResponse.json();
        return res.json({
          isPlaying: currentData.is_playing,
          track: {
            id: currentData.item?.id,
            name: currentData.item?.name,
            artists: currentData.item?.artists.map(a => a.name).join(', '),
            albumArt: currentData.item?.album.images[0]?.url,
            duration: currentData.item?.duration_ms,
            progress: currentData.progress_ms
          }
        });

      case 'devices':
        // Get available devices
        spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/devices', {
          headers
        });
        const devicesData = await spotifyResponse.json();
        return res.json(devicesData);

      case 'queue':
        // Add track to queue
        const uri = body?.uri;
        if (!uri) {
          return res.status(400).json({ error: 'Track URI required' });
        }
        spotifyResponse = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, {
          method: 'POST',
          headers
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    // Handle response for most actions (which return 204 No Content)
    if (spotifyResponse.status === 204 || spotifyResponse.status === 200) {
      return res.json({ success: true });
    } else {
      const errorData = await spotifyResponse.json();
      return res.status(spotifyResponse.status).json({ error: errorData });
    }

  } catch (error) {
    console.error('Playback error:', error);
    return res.status(500).json({ error: 'Playback control failed' });
  }
};