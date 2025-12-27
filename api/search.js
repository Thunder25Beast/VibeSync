// Search Spotify tracks - Serverless Function
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, token } = req.query;

  if (!query || !token) {
    return res.status(400).json({ error: 'Query and token required' });
  }

  try {
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Spotify search error:', response.status, errorData);
      
      if (response.status === 401 || response.status === 403) {
        return res.status(response.status).json({ 
          error: 'Token expired or invalid. Please log in again.',
          tokenError: true
        });
      }
      
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'Spotify API error'
      });
    }

    const data = await response.json();
    
    // Format tracks for easier use
    const tracks = (data.tracks?.items || []).map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url,
      duration: track.duration_ms,
      uri: track.uri,
      previewUrl: track.preview_url
    }));

    return res.json({ tracks });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed: ' + error.message });
  }
};