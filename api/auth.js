// Spotify OAuth Flow - Serverless Function
const querystring = require('querystring');

// Environment variables from Vercel
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Determine redirect URI based on environment
const getRedirectUri = (req) => {
  // Check for Vercel production URL first
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/callback`;
  }
  // For custom domain
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return `${process.env.NEXT_PUBLIC_SITE_URL}/api/callback`;
  }
  // Default to vibesync.vercel.app for production
  return 'https://vibesync.vercel.app/api/callback';
};

const getFrontendUrl = () => {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  return 'https://vibesync.vercel.app';
};

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, code } = req.query;
  const REDIRECT_URI = getRedirectUri(req);

  // Check if credentials are configured
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ 
      error: 'Server configuration error',
      message: 'Spotify credentials not configured. Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to Vercel environment variables.',
      hasClientId: !!CLIENT_ID,
      hasClientSecret: !!CLIENT_SECRET
    });
  }

  // Login - Redirect to Spotify authorization
  if (action === 'login') {
    const scope = [
      'user-read-private',
      'user-read-email',
      'user-modify-playback-state',
      'user-read-playback-state',
      'user-read-currently-playing',
      'streaming',
      'playlist-read-private',
      'playlist-read-collaborative'
    ].join(' ');

    const authUrl = 'https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: scope,
        redirect_uri: REDIRECT_URI,
        show_dialog: true
      });

    return res.redirect(authUrl);
  }

  // Callback - Exchange code for token
  if (action === 'callback' || code) {
    const authCode = code || req.query.code;

    if (!authCode) {
      return res.status(400).json({ error: 'No code provided' });
    }

    try {
      const authOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
        },
        body: querystring.stringify({
          code: authCode,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      };

      const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
      const data = await response.json();

      if (data.access_token) {
        const frontendUrl = getFrontendUrl();
        return res.redirect(`${frontendUrl}?token=${data.access_token}&refresh=${data.refresh_token}`);
      } else {
        console.error('Token error:', data);
        return res.status(400).json({ error: 'Failed to get token', details: data });
      }
    } catch (error) {
      console.error('Auth error:', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  }

  // Refresh token
  if (action === 'refresh') {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'No refresh token provided' });
    }

    try {
      const authOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
        },
        body: querystring.stringify({
          grant_type: 'refresh_token',
          refresh_token: refresh_token
        })
      };

      const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
      const data = await response.json();

      return res.json(data);
    } catch (error) {
      console.error('Refresh error:', error);
      return res.status(500).json({ error: 'Token refresh failed' });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
};