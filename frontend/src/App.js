import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// Generate unique user ID
const getUserId = () => {
  let userId = localStorage.getItem('vibesync_user_id');
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('vibesync_user_id', userId);
  }
  return userId;
};

// Format duration
const formatDuration = (ms) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

function App() {
  // Auth state
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  
  // Session state
  const [sessionCode, setSessionCode] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [session, setSession] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [guestName, setGuestName] = useState('');
  
  // UI state
  const [view, setView] = useState('landing'); // landing, lobby, session
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showDevices, setShowDevices] = useState(false);
  const [volume, setVolume] = useState(50);
  const [progress, setProgress] = useState(0);

  const userId = getUserId();

  // Show notification
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Get token from URL after auth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('token');
    const refreshToken = params.get('refresh');
    
    if (accessToken) {
      setToken(accessToken);
      localStorage.setItem('spotifyToken', accessToken);
      localStorage.setItem('spotifyRefreshToken', refreshToken);
      window.history.replaceState({}, document.title, '/');
    } else {
      const savedToken = localStorage.getItem('spotifyToken');
      if (savedToken) {
        setToken(savedToken);
      }
    }

    // Check for saved session
    const savedSession = localStorage.getItem('vibesync_session');
    const savedIsHost = localStorage.getItem('vibesync_isHost');
    if (savedSession) {
      setSessionCode(savedSession);
      setIsHost(savedIsHost === 'true');
      setView('session');
    }
  }, []);

  // Fetch user profile
  useEffect(() => {
    if (!token) return;
    
    const fetchUser = async () => {
      try {
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setUser(data);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      }
    };
    
    fetchUser();
  }, [token]);

  // Handle leaving/ending session
  const handleLeaveSession = useCallback(async () => {
    if (sessionCode && !isHost) {
      try {
        await fetch('/api/session?action=leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: sessionCode, guestId: userId })
        });
      } catch (error) {
        console.error('Error leaving session:', error);
      }
    }

    if (sessionCode && isHost) {
      try {
        await fetch('/api/session?action=end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: sessionCode })
        });
      } catch (error) {
        console.error('Error ending session:', error);
      }
    }

    setSessionCode(null);
    setSession(null);
    setIsHost(false);
    setView(token ? 'lobby' : 'landing');
    setSearchResults([]);
    localStorage.removeItem('vibesync_session');
    localStorage.removeItem('vibesync_isHost');
  }, [sessionCode, isHost, userId, token]);

  // Poll session state
  useEffect(() => {
    if (!sessionCode) return;

    const pollSession = async () => {
      try {
        const response = await fetch(`/api/session?action=get&code=${sessionCode}`);
        if (response.ok) {
          const data = await response.json();
          setSession(data.session);
        } else if (response.status === 404) {
          // Session ended
          handleLeaveSession();
          showNotification('Session has ended', 'warning');
        }
      } catch (error) {
        console.error('Error polling session:', error);
      }
    };

    pollSession();
    const interval = setInterval(pollSession, 2000);
    return () => clearInterval(interval);
  }, [sessionCode, showNotification, handleLeaveSession]);

  // Poll current track (host only)
  useEffect(() => {
    if (!token || !isHost) return;

    const getCurrentTrack = async () => {
      try {
        const response = await fetch(`/api/playback?action=current&token=${token}`);
        const data = await response.json();
        setCurrentTrack(data);
        if (data.track) {
          setProgress(data.track.progress || 0);
        }
      } catch (error) {
        console.error('Error fetching current track:', error);
      }
    };

    getCurrentTrack();
    const interval = setInterval(getCurrentTrack, 3000);
    return () => clearInterval(interval);
  }, [token, isHost]);

  // Progress bar update
  useEffect(() => {
    if (!currentTrack?.isPlaying) return;
    
    const interval = setInterval(() => {
      setProgress(prev => Math.min(prev + 1000, currentTrack.track?.duration || 0));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [currentTrack]);

  // Get devices (host only)
  const fetchDevices = async () => {
    if (!token) return;
    try {
      const response = await fetch(`/api/playback?action=devices&token=${token}`);
      const data = await response.json();
      setDevices(data.devices || []);
      if (data.devices?.length > 0) {
        const activeDevice = data.devices.find(d => d.is_active) || data.devices[0];
        setSelectedDevice(activeDevice);
      }
    } catch (error) {
      console.error('Error fetching devices:', error);
    }
  };

  // Auth handlers
  const handleLogin = () => {
    window.location.href = '/api/auth?action=login';
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('spotifyToken');
    localStorage.removeItem('spotifyRefreshToken');
    handleLeaveSession();
  };

  // Session handlers
  const handleCreateSession = async () => {
    if (!token || !user) {
      showNotification('Please login first', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/session?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostToken: token,
          hostName: user.display_name,
          hostId: user.id
        })
      });

      const data = await response.json();
      if (data.success) {
        setSessionCode(data.session.code);
        setIsHost(true);
        setView('session');
        localStorage.setItem('vibesync_session', data.session.code);
        localStorage.setItem('vibesync_isHost', 'true');
        fetchDevices();
        showNotification('Session created! Share the code with friends', 'success');
      }
    } catch (error) {
      console.error('Error creating session:', error);
      showNotification('Failed to create session', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinSession = async () => {
    if (!joinCode.trim()) {
      showNotification('Please enter a session code', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/session?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: joinCode.toUpperCase(),
          guestName: guestName || (user?.display_name || `Guest_${userId.slice(-4)}`),
          guestId: userId
        })
      });

      const data = await response.json();
      if (data.success) {
        setSessionCode(joinCode.toUpperCase());
        setSession(data.session);
        setIsHost(false);
        setView('session');
        localStorage.setItem('vibesync_session', joinCode.toUpperCase());
        localStorage.setItem('vibesync_isHost', 'false');
        showNotification(`Joined ${data.session.hostName}'s session!`, 'success');
      } else {
        showNotification(data.error || 'Session not found', 'error');
      }
    } catch (error) {
      console.error('Error joining session:', error);
      showNotification('Failed to join session', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Search handler
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Use host's token for search
    const searchToken = isHost ? token : session?.hostToken;
    if (!searchToken) {
      showNotification('Unable to search', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}&token=${searchToken}`);
      const data = await response.json();
      setSearchResults(data.tracks || []);
    } catch (error) {
      console.error('Search error:', error);
      showNotification('Search failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Queue handlers
  const handleAddToQueue = async (track) => {
    if (!sessionCode) return;

    try {
      const response = await fetch('/api/session?action=addTrack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: sessionCode,
          track,
          addedBy: user?.display_name || guestName || `Guest_${userId.slice(-4)}`
        })
      });

      const data = await response.json();
      if (data.success) {
        showNotification(`Added "${track.name}" to queue`, 'success');
        // Clear from search results to indicate it's added
        setSearchResults(prev => prev.filter(t => t.id !== track.id));
      } else {
        showNotification(data.error || 'Failed to add track', 'error');
      }
    } catch (error) {
      console.error('Error adding track:', error);
      showNotification('Failed to add track', 'error');
    }
  };

  const handleVote = async (trackId) => {
    if (!sessionCode) return;

    try {
      await fetch('/api/session?action=vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: sessionCode,
          trackId,
          voterId: userId
        })
      });
    } catch (error) {
      console.error('Error voting:', error);
    }
  };

  const handleRemoveTrack = async (trackId) => {
    if (!sessionCode) return;

    try {
      await fetch('/api/session?action=removeTrack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: sessionCode,
          trackId,
          requesterId: userId,
          isHost
        })
      });
      showNotification('Track removed', 'success');
    } catch (error) {
      console.error('Error removing track:', error);
    }
  };

  // Playback handlers (host only)
  const handlePlayFromQueue = async () => {
    if (!isHost || !session?.queue?.length) return;

    try {
      // Get next track from queue
      const response = await fetch('/api/session?action=playNext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: sessionCode })
      });

      const data = await response.json();
      if (data.success && data.track) {
        // Play the track
        await fetch(`/api/playback?action=play&token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [data.track.uri] })
        });
        showNotification(`Now playing: ${data.track.name}`, 'success');
      }
    } catch (error) {
      console.error('Error playing from queue:', error);
      showNotification('Failed to play track', 'error');
    }
  };

  const handlePlaybackControl = async (action) => {
    if (!isHost || !token) return;

    try {
      await fetch(`/api/playback?action=${action}&token=${token}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Playback control error:', error);
    }
  };

  const handleVolumeChange = async (newVolume) => {
    setVolume(newVolume);
    if (!isHost || !token) return;

    try {
      await fetch(`/api/playback?action=volume&token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume_percent: newVolume })
      });
    } catch (error) {
      console.error('Volume control error:', error);
    }
  };

  // Copy session code
  const copySessionCode = () => {
    if (sessionCode) {
      navigator.clipboard.writeText(sessionCode);
      showNotification('Code copied!', 'success');
    }
  };

  // Generate QR code URL (using QR code API)
  const getQRCodeUrl = () => {
    const joinUrl = `${window.location.origin}?join=${sessionCode}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}&bgcolor=191414&color=1DB954`;
  };

  // Check for join code in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinFromUrl = params.get('join');
    if (joinFromUrl && !sessionCode) {
      setJoinCode(joinFromUrl);
      setView('lobby');
      window.history.replaceState({}, document.title, '/');
    }
  }, [sessionCode]);

  // Render Landing Page
  if (view === 'landing' && !token) {
    return (
      <div className="App">
        <div className="landing">
          <div className="hero">
            <div className="logo-container">
              <span className="logo-icon">VS</span>
              <h1>VibeSync</h1>
            </div>
            <p className="tagline">One Premium. Infinite Vibes.</p>
            <p className="description">
              Turn your Spotify Premium into a shared experience.<br />
              Create a session, share the code, and let everyone<br />
              add songs to one collaborative, real-time queue.
            </p>
            
            <button onClick={handleLogin} className="login-btn">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              Login with Spotify
            </button>
            
            <div className="features-preview">
              <div className="feature-item">
                <span className="feature-icon">*</span>
                <span>Host needs Premium</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">+</span>
                <span>Guests join free</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">~</span>
                <span>Real-time sync</span>
              </div>
            </div>
          </div>

          <div className="how-it-works">
            <h2>How It Works</h2>
            <div className="steps">
              <div className="step">
                <div className="step-number">1</div>
                <h3>Start a Session</h3>
                <p>Login with your Spotify Premium account and create a new session with a unique code.</p>
              </div>
              <div className="step">
                <div className="step-number">2</div>
                <h3>Invite Friends</h3>
                <p>Share the code or QR—friends can join instantly from any device, no app needed.</p>
              </div>
              <div className="step">
                <div className="step-number">3</div>
                <h3>Vibe Together</h3>
                <p>Everyone adds songs, votes on favorites, and enjoys the music together in perfect sync.</p>
              </div>
            </div>
          </div>

          <div className="why-vibesync">
            <h2>Why VibeSync?</h2>
            <div className="benefits">
              <div className="benefit">
                <span className="benefit-icon">01</span>
                <h4>No App Required</h4>
                <p>Works in any browser</p>
              </div>
              <div className="benefit">
                <span className="benefit-icon">02</span>
                <h4>Real-Time Updates</h4>
                <p>Instant sync across devices</p>
              </div>
              <div className="benefit">
                <span className="benefit-icon">03</span>
                <h4>Democratic Queue</h4>
                <p>Vote on favorite tracks</p>
              </div>
              <div className="benefit">
                <span className="benefit-icon">04</span>
                <h4>Host Control</h4>
                <p>Full playback control</p>
              </div>
            </div>
          </div>

          <footer className="landing-footer">
            <p>© 2025 VibeSync. Built for music lovers.</p>
            <p className="disclaimer">Not affiliated with Spotify AB</p>
          </footer>
        </div>

        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        )}
      </div>
    );
  }

  // Render Lobby (choose create or join)
  if (view === 'lobby' || (token && !sessionCode)) {
    return (
      <div className="App">
        <header className="main-header">
          <div className="header-left">
            <span className="logo-small">VS</span>
            <h1>VibeSync</h1>
          </div>
          <div className="header-right">
            {user && (
              <div className="user-info">
                {user.images?.[0]?.url && (
                  <img src={user.images[0].url} alt={user.display_name} className="user-avatar" />
                )}
                <span>{user.display_name}</span>
              </div>
            )}
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>
        </header>

        <div className="lobby">
          <div className="lobby-card create-card">
            <div className="card-icon">+</div>
            <h2>Start a Session</h2>
            <p>Create a new music session and invite your friends to join.</p>
            <button 
              onClick={handleCreateSession} 
              className="primary-btn"
              disabled={isLoading}
            >
              {isLoading ? 'Creating...' : 'Create Session'}
            </button>
            <span className="card-note">Requires Spotify Premium</span>
          </div>

          <div className="divider">
            <span>OR</span>
          </div>

          <div className="lobby-card join-card">
            <div className="card-icon">#</div>
            <h2>Join a Session</h2>
            <p>Enter a session code to join an existing music party.</p>
            <div className="join-form">
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="code-input"
              />
              {!token && (
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="name-input"
                />
              )}
              <button 
                onClick={handleJoinSession} 
                className="secondary-btn"
                disabled={isLoading || !joinCode.trim()}
              >
                {isLoading ? 'Joining...' : 'Join Session'}
              </button>
            </div>
            <span className="card-note">No Premium required</span>
          </div>
        </div>

        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        )}
      </div>
    );
  }

  // Render Session View
  return (
    <div className="App session-view">
      <header className="session-header">
        <div className="header-left">
          <button onClick={handleLeaveSession} className="back-btn">
            ← Leave
          </button>
          <span className="logo-small">VS</span>
          <h1>VibeSync</h1>
        </div>
        <div className="session-info">
          <div className="session-code" onClick={copySessionCode}>
            <span className="code-label">Session Code:</span>
            <span className="code-value">{sessionCode}</span>
            <span className="copy-icon">Copy</span>
          </div>
          {isHost && (
            <span className="host-badge">Host</span>
          )}
        </div>
        <div className="header-right">
          <div className="guest-count">
            <span className="guest-icon">Users:</span>
            <span>{(session?.guests?.length || 0) + 1}</span>
          </div>
        </div>
      </header>

      <div className="session-content">
        {/* Left Panel - Queue & Search */}
        <div className="left-panel">
          {/* Search Section */}
          <div className="search-section">
            <h2>Add Songs</h2>
            <form onSubmit={handleSearch}>
              <input
                type="text"
                placeholder="Search for songs, artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" disabled={isLoading}>
                {isLoading ? '...' : 'Search'}
              </button>
            </form>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="search-results">
              <h3>Search Results</h3>
              <div className="results-list">
                {searchResults.map((track) => (
                  <div key={track.id} className="track-item search-item">
                    <img src={track.albumArt} alt={track.album} />
                    <div className="track-details">
                      <h4>{track.name}</h4>
                      <p>{track.artists}</p>
                    </div>
                    <span className="track-duration">{formatDuration(track.duration)}</span>
                    <button 
                      onClick={() => handleAddToQueue(track)}
                      className="add-btn"
                      title="Add to queue"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queue */}
          <div className="queue-section">
            <div className="queue-header">
              <h2>Queue</h2>
              <span className="queue-count">{session?.queue?.length || 0} songs</span>
            </div>
            
            {session?.queue?.length > 0 ? (
              <div className="queue-list">
                {session.queue.map((track, index) => (
                  <div key={track.id} className="track-item queue-item">
                    <span className="queue-position">{index + 1}</span>
                    <img src={track.albumArt} alt={track.album} />
                    <div className="track-details">
                      <h4>{track.name}</h4>
                      <p>{track.artists}</p>
                      <span className="added-by">Added by {track.addedBy}</span>
                    </div>
                    <div className="track-actions">
                      <button 
                        onClick={() => handleVote(track.id)}
                        className={`vote-btn ${track.votedBy?.includes(userId) ? 'voted' : ''}`}
                      >
                        <span className="vote-icon">▲</span>
                        <span className="vote-count">{track.votes || 0}</span>
                      </button>
                      {(isHost || track.addedBy === (user?.display_name || guestName)) && (
                        <button 
                          onClick={() => handleRemoveTrack(track.id)}
                          className="remove-btn"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-queue">
                <span className="empty-icon">--</span>
                <p>Queue is empty</p>
                <p className="empty-hint">Search and add some songs!</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Now Playing & Controls */}
        <div className="right-panel">
          {/* Share Section */}
          <div className="share-section">
            <h2>Invite Friends</h2>
            <div className="qr-container">
              <img src={getQRCodeUrl()} alt="QR Code" className="qr-code" />
            </div>
            <p className="share-text">Scan to join or share code:</p>
            <div className="share-code" onClick={copySessionCode}>
              <span className="big-code">{sessionCode}</span>
              <button className="copy-btn">Copy</button>
            </div>
          </div>

          {/* Now Playing (Host Only) */}
          {isHost && (
            <div className="now-playing-section">
              <h2>Now Playing</h2>
              
              {currentTrack?.track ? (
                <div className="now-playing-card">
                  <img 
                    src={currentTrack.track.albumArt} 
                    alt="Album art" 
                    className="album-art"
                  />
                  <div className="track-info">
                    <h3>{currentTrack.track.name}</h3>
                    <p>{currentTrack.track.artists}</p>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="progress-container">
                    <span className="time-current">{formatDuration(progress)}</span>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${(progress / currentTrack.track.duration) * 100}%` }}
                      />
                    </div>
                    <span className="time-total">{formatDuration(currentTrack.track.duration)}</span>
                  </div>

                  {/* Playback Controls */}
                  <div className="playback-controls">
                    <button onClick={() => handlePlaybackControl('previous')} className="control-btn">
                      ⏮
                    </button>
                    <button 
                      onClick={() => handlePlaybackControl(currentTrack.isPlaying ? 'pause' : 'play')} 
                      className="control-btn play-btn"
                    >
                      {currentTrack.isPlaying ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => handlePlaybackControl('next')} className="control-btn">
                      ⏭
                    </button>
                  </div>

                  {/* Volume Control */}
                  <div className="volume-control">
                    <span className="volume-icon">Vol</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                      className="volume-slider"
                    />
                    <span className="volume-value">{volume}%</span>
                  </div>
                </div>
              ) : (
                <div className="no-track">
                  <span className="no-track-icon">--</span>
                  <p>No track playing</p>
                </div>
              )}

              {/* Play from Queue Button */}
              {session?.queue?.length > 0 && (
                <button onClick={handlePlayFromQueue} className="play-queue-btn">
                  Play Next from Queue
                </button>
              )}

              {/* Device Selector */}
              <div className="device-section">
                <button onClick={() => { fetchDevices(); setShowDevices(!showDevices); }} className="device-toggle">
                  Device: {selectedDevice?.name || 'Select Device'}
                </button>
                {showDevices && devices.length > 0 && (
                  <div className="device-list">
                    {devices.map(device => (
                      <div 
                        key={device.id} 
                        className={`device-item ${device.is_active ? 'active' : ''}`}
                        onClick={() => setSelectedDevice(device)}
                      >
                        <span>{device.type}</span>
                        <span>{device.name}</span>
                        {device.is_active && <span className="active-badge">Active</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Guest View - Current Track */}
          {!isHost && currentTrack?.track && (
            <div className="guest-now-playing">
              <h2>Now Playing</h2>
              <div className="now-playing-card">
                <img src={currentTrack.track.albumArt} alt="Album art" className="album-art" />
                <h3>{currentTrack.track.name}</h3>
                <p>{currentTrack.track.artists}</p>
                <p className="host-playing">Playing on {session?.hostName}'s Spotify</p>
              </div>
            </div>
          )}

          {/* Guests List */}
          <div className="guests-section">
            <h2>In This Session</h2>
            <div className="guests-list">
              <div className="guest-item host">
                <span className="guest-avatar">H</span>
                <span className="guest-name">{session?.hostName || 'Host'}</span>
                <span className="role-badge">Host</span>
              </div>
              {session?.guests?.map((guest, index) => (
                <div key={guest.id || index} className="guest-item">
                  <span className="guest-avatar">G</span>
                  <span className="guest-name">{guest.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}

export default App;