import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';

// API base URL
const API_BASE = '/api';

function App() {
  // Auth state
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  
  // Session state
  const [sessionCode, setSessionCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  
  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notification, setNotification] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState('idle');
  const [reactions, setReactions] = useState([]);

  // Available reactions
  const REACTIONS = ['🔥', '❤️', '🎉', '👏', '🙌', '💃', '🕺', '✨'];

  // Show notification
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Handle leaving session
  const handleLeaveSession = useCallback(async () => {
    if (sessionCode) {
      try {
        if (isHost) {
          await axios.post(`${API_BASE}/session?action=end`, { code: sessionCode });
        } else {
          await axios.post(`${API_BASE}/session?action=leave`, { 
            code: sessionCode, 
            guestId: userId 
          });
        }
      } catch (error) {
        console.error('Error leaving session:', error);
      }
    }
    setSessionCode('');
    setSessionData(null);
    setIsHost(false);
    localStorage.removeItem('vibesync_sessionCode');
    localStorage.removeItem('vibesync_isHost');
  }, [sessionCode, isHost, userId]);

  // Get token from URL after auth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('token');
    
    if (accessToken) {
      setToken(accessToken);
      localStorage.setItem('spotifyToken', accessToken);
      window.history.replaceState({}, document.title, '/');
    } else {
      const savedToken = localStorage.getItem('spotifyToken');
      if (savedToken) setToken(savedToken);
    }

    // Restore session
    const savedSession = localStorage.getItem('vibesync_sessionCode');
    const savedIsHost = localStorage.getItem('vibesync_isHost') === 'true';
    if (savedSession) {
      setSessionCode(savedSession);
      setIsHost(savedIsHost);
    }
  }, []);

  // Get user profile
  useEffect(() => {
    if (!token) return;

    const fetchProfile = async () => {
      try {
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 401) {
          // Token expired
          localStorage.removeItem('spotifyToken');
          setToken(null);
          return;
        }
        
        const data = await response.json();
        setUserName(data.display_name || 'User');
        setUserId(data.id);
      } catch (error) {
        console.error('Error fetching profile:', error);
      }
    };

    fetchProfile();
  }, [token]);

  // Poll session state
  useEffect(() => {
    if (!sessionCode || !token) return;

    const pollSession = async () => {
      try {
        const response = await axios.get(`${API_BASE}/session?action=get&code=${sessionCode}`);
        
        if (response.data.success) {
          setSessionData(response.data.session);
          setReactions(response.data.session.reactions || []);
        }
      } catch (error) {
        if (error.response?.status === 404) {
          // Session ended
          showNotification('Session has ended', 'error');
          handleLeaveSession();
        }
      }
    };

    pollSession();
    const interval = setInterval(pollSession, 2000);
    return () => clearInterval(interval);
  }, [sessionCode, token, handleLeaveSession, showNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionCode && !isHost) {
        axios.post(`${API_BASE}/session?action=leave`, { 
          code: sessionCode, 
          guestId: userId 
        }).catch(() => {});
      }
    };
  }, [sessionCode, isHost, userId]);

  // Login handler
  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth?action=login`;
  };

  // Logout handler
  const handleLogout = () => {
    handleLeaveSession();
    localStorage.removeItem('spotifyToken');
    setToken(null);
    setUserName('');
    setUserId(null);
  };

  // Create session (Host)
  const handleCreateSession = async () => {
    try {
      const response = await axios.post(`${API_BASE}/session?action=create`, {
        hostToken: token,
        hostName: userName,
        hostId: userId
      });

      if (response.data.success) {
        const code = response.data.session.code;
        setSessionCode(code);
        setIsHost(true);
        localStorage.setItem('vibesync_sessionCode', code);
        localStorage.setItem('vibesync_isHost', 'true');
        showNotification(`Session created! Code: ${code}`, 'success');
      }
    } catch (error) {
      console.error('Error creating session:', error);
      showNotification('Failed to create session', 'error');
    }
  };

  // Join session (Guest)
  const handleJoinSession = async () => {
    if (!inputCode.trim()) {
      showNotification('Please enter a session code', 'error');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/session?action=join`, {
        code: inputCode.toUpperCase(),
        guestName: userName,
        guestId: userId,
        guestToken: token // Send token for sync!
      });

      if (response.data.success) {
        setSessionCode(inputCode.toUpperCase());
        setIsHost(false);
        setSessionData(response.data.session);
        localStorage.setItem('vibesync_sessionCode', inputCode.toUpperCase());
        localStorage.setItem('vibesync_isHost', 'false');
        showNotification(`Joined ${response.data.session.hostName}'s session!`, 'success');
      }
    } catch (error) {
      console.error('Error joining session:', error);
      showNotification(error.response?.data?.error || 'Failed to join session', 'error');
    }
  };

  // Search for tracks
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await axios.get(
        `${API_BASE}/search?query=${encodeURIComponent(searchQuery)}&token=${token}`
      );
      setSearchResults(response.data.tracks || []);
    } catch (error) {
      console.error('Search error:', error);
      showNotification('Search failed', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // Add track to queue
  const handleAddToQueue = async (track) => {
    try {
      const response = await axios.post(`${API_BASE}/session?action=addTrack`, {
        code: sessionCode,
        track: {
          id: track.id,
          name: track.name,
          artists: track.artists,
          album: track.album,
          albumArt: track.albumArt,
          duration: track.duration,
          uri: track.uri
        },
        addedBy: userName,
        addedById: userId
      });

      if (response.data.success) {
        setSessionData(prev => ({ ...prev, queue: response.data.queue }));
        showNotification('Added to queue!', 'success');
      }
    } catch (error) {
      console.error('Error adding to queue:', error);
      showNotification(error.response?.data?.error || 'Failed to add', 'error');
    }
  };

  // Vote for track
  const handleVote = async (trackId) => {
    try {
      const response = await axios.post(`${API_BASE}/session?action=vote`, {
        code: sessionCode,
        trackId,
        voterId: userId
      });

      if (response.data.success) {
        setSessionData(prev => ({ ...prev, queue: response.data.queue }));
      }
    } catch (error) {
      console.error('Error voting:', error);
    }
  };

  // Remove track from queue
  const handleRemoveTrack = async (trackId) => {
    try {
      const response = await axios.post(`${API_BASE}/session?action=removeTrack`, {
        code: sessionCode,
        trackId,
        requesterId: userId,
        isHost
      });

      if (response.data.success) {
        setSessionData(prev => ({ ...prev, queue: response.data.queue }));
        showNotification('Removed from queue', 'success');
      }
    } catch (error) {
      console.error('Error removing track:', error);
      showNotification(error.response?.data?.error || 'Cannot remove', 'error');
    }
  };

  // Play synced for everyone (Host only)
  const handlePlaySynced = async (track) => {
    setSyncStatus('syncing');
    try {
      // Get all tokens
      const tokensResponse = await axios.get(
        `${API_BASE}/session?action=get-all-tokens&code=${sessionCode}`
      );

      if (!tokensResponse.data.tokens?.length) {
        throw new Error('No tokens available');
      }

      // Play on all devices
      const syncResponse = await axios.post(`${API_BASE}/sync?action=play-sync`, {
        tokens: tokensResponse.data.tokens,
        trackUri: track.uri,
        position: 0
      });

      if (syncResponse.data.success) {
        // Update session current track
        await axios.post(`${API_BASE}/session?action=update-track`, {
          code: sessionCode,
          track
        });

        setSyncStatus('synced');
        showNotification(
          `Playing for ${tokensResponse.data.participantCount} people!`, 
          'success'
        );

        // Remove from queue if it was in queue
        const inQueue = sessionData?.queue?.find(t => t.id === track.id);
        if (inQueue) {
          await handleRemoveTrack(track.id);
        }
      }
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');
      showNotification('Sync failed - make sure everyone has Spotify open!', 'error');
    }
    
    setTimeout(() => setSyncStatus('idle'), 3000);
  };

  // Play next from queue (Host only)
  const handlePlayNext = async () => {
    if (!sessionData?.queue?.length) {
      showNotification('Queue is empty', 'error');
      return;
    }

    setSyncStatus('syncing');
    try {
      const response = await axios.post(`${API_BASE}/session?action=playNext`, {
        code: sessionCode
      });

      if (response.data.success && response.data.track) {
        // Play on all devices
        const syncResponse = await axios.post(`${API_BASE}/sync?action=play-sync`, {
          tokens: response.data.tokens,
          trackUri: response.data.track.uri,
          position: 0
        });

        if (syncResponse.data.success) {
          setSessionData(prev => ({
            ...prev,
            queue: response.data.queue,
            currentTrack: response.data.track,
            history: response.data.history
          }));

          setSyncStatus('synced');
          showNotification(
            `Now playing: ${response.data.track.name}`, 
            'success'
          );
        }
      }
    } catch (error) {
      console.error('Play next error:', error);
      setSyncStatus('error');
      showNotification(error.response?.data?.error || 'Failed to play', 'error');
    }

    setTimeout(() => setSyncStatus('idle'), 3000);
  };

  // Pause everyone (Host only)
  const handlePauseSynced = async () => {
    try {
      const tokensResponse = await axios.get(
        `${API_BASE}/session?action=get-all-tokens&code=${sessionCode}`
      );

      await axios.post(`${API_BASE}/sync?action=pause-sync`, {
        tokens: tokensResponse.data.tokens
      });

      showNotification('Paused for everyone', 'success');
    } catch (error) {
      console.error('Pause error:', error);
      showNotification('Failed to pause', 'error');
    }
  };

  // Resume everyone (Host only)
  const handleResumeSynced = async () => {
    try {
      const tokensResponse = await axios.get(
        `${API_BASE}/session?action=get-all-tokens&code=${sessionCode}`
      );

      await axios.post(`${API_BASE}/sync?action=resume-sync`, {
        tokens: tokensResponse.data.tokens
      });

      showNotification('Resumed for everyone', 'success');
    } catch (error) {
      console.error('Resume error:', error);
      showNotification('Failed to resume', 'error');
    }
  };

  // Request to play (Guest feature)
  const handleRequestPlay = async (track) => {
    try {
      const response = await axios.post(`${API_BASE}/session?action=request-play`, {
        code: sessionCode,
        track,
        requestedBy: userName,
        requestedById: userId
      });

      if (response.data.success) {
        showNotification('Request sent to host!', 'success');
      }
    } catch (error) {
      console.error('Request error:', error);
      showNotification(error.response?.data?.error || 'Request failed', 'error');
    }
  };

  // Handle play request (Host accepts)
  const handleAcceptRequest = async (track) => {
    await handlePlaySynced(track);
    // Clear the request
    try {
      await axios.post(`${API_BASE}/session?action=clear-request`, {
        code: sessionCode,
        trackId: track.id
      });
    } catch (error) {
      console.error('Error clearing request:', error);
    }
  };

  // Dismiss request (Host rejects)
  const handleDismissRequest = async (trackId) => {
    try {
      await axios.post(`${API_BASE}/session?action=clear-request`, {
        code: sessionCode,
        trackId
      });
      showNotification('Request dismissed', 'info');
    } catch (error) {
      console.error('Error dismissing request:', error);
    }
  };

  // Send reaction
  const handleSendReaction = async (emoji) => {
    try {
      await axios.post(`${API_BASE}/session?action=react`, {
        code: sessionCode,
        emoji,
        userName,
        userId
      });
    } catch (error) {
      console.error('Reaction error:', error);
    }
  };

  // Add & Play Instantly (Host feature)
  const handleAddAndPlay = async (track) => {
    await handleAddToQueue(track);
    await handlePlaySynced(track);
  };

  // Format duration
  const formatDuration = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Copy session code
  const copySessionCode = () => {
    navigator.clipboard.writeText(sessionCode);
    showNotification('Code copied!', 'success');
  };

  // ==================== RENDER ====================

  // Not logged in - Landing page
  if (!token) {
    return (
      <div className="App">
        <div className="landing">
          <div className="hero">
            <h1>VibeSync</h1>
            <p className="tagline">Jam Together. Anywhere.</p>
            <p className="description">
              Distance doesn't matter anymore.<br />
              Everyone hears the same song at the same time.<br />
              Create a session, share the code, and vibe together in perfect sync.
            </p>
            <button onClick={handleLogin} className="login-btn">
              Login with Spotify
            </button>
            <p className="note">Free and Premium accounts welcome</p>
            
            <div className="features-preview">
              <div className="feature">
                <span className="feature-icon">🎵</span>
                <span>Synchronized Playback</span>
              </div>
              <div className="feature">
                <span className="feature-icon">👥</span>
                <span>Collaborative Queue</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🗳️</span>
                <span>Democratic Voting</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Logged in but no session
  if (!sessionCode) {
    return (
      <div className="App">
        <div className="landing">
          <div className="hero">
            <h1>VibeSync</h1>
            <p className="welcome">Welcome, {userName}!</p>
            
            <div className="session-options">
              <div className="option-card">
                <h3>Host a Session</h3>
                <p>Start a new listening party and invite friends</p>
                <button onClick={handleCreateSession} className="action-btn primary">
                  Create Session
                </button>
              </div>

              <div className="divider">OR</div>

              <div className="option-card">
                <h3>Join a Session</h3>
                <p>Enter the code shared by the host</p>
                <input
                  type="text"
                  placeholder="Enter code (e.g., ABC123)"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="code-input"
                />
                <button onClick={handleJoinSession} className="action-btn secondary">
                  Join Session
                </button>
              </div>
            </div>

            <button onClick={handleLogout} className="logout-link">
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  // In session view
  return (
    <div className="App">
      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Floating reactions */}
      <div className="reactions-display">
        {reactions.map((r, i) => (
          <div key={i} className="floating-reaction" style={{
            left: `${Math.random() * 80 + 10}%`,
            animationDelay: `${i * 0.1}s`
          }}>
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-user">{r.userName}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1>VibeSync</h1>
        </div>
        <div className="header-center">
          <div className="session-badge" onClick={copySessionCode}>
            <span className="badge-label">Session</span>
            <span className="badge-code">{sessionCode}</span>
            <span className="copy-icon">📋</span>
          </div>
          <div className={`role-badge ${isHost ? 'host' : 'guest'}`}>
            {isHost ? 'Host' : 'Guest'}
          </div>
        </div>
        <div className="header-right">
          <span className="user-name">{userName}</span>
          <button onClick={handleLeaveSession} className="leave-btn">
            Leave
          </button>
        </div>
      </header>

      {/* Participants */}
      <div className="participants-bar">
        <span className="participants-label">
          {(sessionData?.guests?.length || 0) + 1} listening:
        </span>
        <div className="participants-list">
          <span className="participant host-name">
            {sessionData?.hostName || 'Host'} (Host)
          </span>
          {sessionData?.guests?.map((guest, i) => (
            <span key={i} className="participant">
              {guest.name}
            </span>
          ))}
        </div>
      </div>

      <main className="main-content">
        {/* Left Column - Now Playing & Controls */}
        <div className="left-column">
          {/* Now Playing */}
          <section className="now-playing-section">
            <h2>Now Playing</h2>
            {sessionData?.currentTrack ? (
              <div className="now-playing-card">
                <img 
                  src={sessionData.currentTrack.albumArt} 
                  alt={sessionData.currentTrack.album}
                  className="now-playing-art"
                />
                <div className="now-playing-info">
                  <h3>{sessionData.currentTrack.name}</h3>
                  <p>{sessionData.currentTrack.artists}</p>
                  <div className={`sync-indicator ${syncStatus}`}>
                    {syncStatus === 'synced' && 'Synced with everyone'}
                    {syncStatus === 'syncing' && 'Syncing...'}
                    {syncStatus === 'error' && 'Sync failed'}
                    {syncStatus === 'idle' && 'Playing'}
                  </div>
                </div>
                {isHost && (
                  <div className="playback-controls">
                    <button onClick={handlePauseSynced} className="control-btn">
                      ⏸️
                    </button>
                    <button onClick={handleResumeSynced} className="control-btn">
                      ▶️
                    </button>
                    <button onClick={handlePlayNext} className="control-btn primary">
                      ⏭️
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <p>No track playing</p>
                {isHost && sessionData?.queue?.length > 0 && (
                  <button onClick={handlePlayNext} className="action-btn primary">
                    Play from Queue
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Reactions */}
          <section className="reactions-section">
            <h3>Send Reaction</h3>
            <div className="reaction-buttons">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleSendReaction(emoji)}
                  className="reaction-btn"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>

          {/* Play Requests (Host only) */}
          {isHost && sessionData?.playRequests?.length > 0 && (
            <section className="requests-section">
              <h3>Play Requests</h3>
              <div className="requests-list">
                {sessionData.playRequests.map((req, i) => (
                  <div key={i} className="request-item">
                    <img src={req.track.albumArt} alt={req.track.album} />
                    <div className="request-info">
                      <span className="request-track">{req.track.name}</span>
                      <span className="request-by">from {req.requestedBy}</span>
                    </div>
                    <div className="request-actions">
                      <button 
                        onClick={() => handleAcceptRequest(req.track)}
                        className="accept-btn"
                      >
                        Play
                      </button>
                      <button 
                        onClick={() => handleDismissRequest(req.track.id)}
                        className="dismiss-btn"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* History Toggle */}
          <button 
            onClick={() => setShowHistory(!showHistory)} 
            className="history-toggle"
          >
            {showHistory ? 'Hide' : 'Show'} History
          </button>

          {/* History */}
          {showHistory && sessionData?.history?.length > 0 && (
            <section className="history-section">
              <h3>Recently Played</h3>
              <div className="history-list">
                {sessionData.history.slice().reverse().map((track, i) => (
                  <div key={i} className="history-item">
                    <img src={track.albumArt} alt={track.album} />
                    <div className="history-info">
                      <span className="history-track">{track.name}</span>
                      <span className="history-artist">{track.artists}</span>
                    </div>
                    {isHost && (
                      <button 
                        onClick={() => handlePlaySynced(track)}
                        className="replay-btn"
                      >
                        Replay
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column - Search & Queue */}
        <div className="right-column">
          {/* Search */}
          <section className="search-section">
            <h2>Search Songs</h2>
            <form onSubmit={handleSearch} className="search-form">
              <input
                type="text"
                placeholder="Search for songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              <button type="submit" disabled={isSearching} className="search-btn">
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((track) => (
                  <div key={track.id} className="track-card">
                    <img src={track.albumArt} alt={track.album} />
                    <div className="track-info">
                      <span className="track-name">{track.name}</span>
                      <span className="track-artist">{track.artists}</span>
                      <span className="track-duration">{formatDuration(track.duration)}</span>
                    </div>
                    <div className="track-actions">
                      <button 
                        onClick={() => handleAddToQueue(track)}
                        className="add-btn"
                        title="Add to Queue"
                      >
                        +
                      </button>
                      {isHost ? (
                        <button 
                          onClick={() => handleAddAndPlay(track)}
                          className="play-now-btn"
                          title="Play Now for Everyone"
                        >
                          ▶
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleRequestPlay(track)}
                          className="request-btn"
                          title="Request to Play"
                        >
                          🙋
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Queue */}
          <section className="queue-section">
            <div className="queue-header">
              <h2>Queue ({sessionData?.queue?.length || 0})</h2>
              {isHost && sessionData?.queue?.length > 0 && (
                <button onClick={handlePlayNext} className="play-next-btn">
                  Play Next
                </button>
              )}
            </div>

            {sessionData?.queue?.length > 0 ? (
              <div className="queue-list">
                {sessionData.queue.map((track, index) => (
                  <div key={track.id} className="queue-item">
                    <span className="queue-position">{index + 1}</span>
                    <img src={track.albumArt} alt={track.album} />
                    <div className="queue-info">
                      <span className="queue-track">{track.name}</span>
                      <span className="queue-artist">{track.artists}</span>
                      <span className="queue-added">Added by {track.addedBy}</span>
                    </div>
                    <div className="queue-voting">
                      <button 
                        onClick={() => handleVote(track.id)}
                        className={`vote-btn ${track.votedBy?.includes(userId) ? 'voted' : ''}`}
                      >
                        👍 {track.votes || 0}
                      </button>
                    </div>
                    <div className="queue-actions">
                      {isHost && (
                        <button 
                          onClick={() => handlePlaySynced(track)}
                          className="queue-play-btn"
                          title="Play Now"
                        >
                          ▶
                        </button>
                      )}
                      {(isHost || track.addedById === userId) && (
                        <button 
                          onClick={() => handleRemoveTrack(track.id)}
                          className="queue-remove-btn"
                          title="Remove"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-queue">
                <p>Queue is empty</p>
                <p className="empty-hint">Search for songs to add!</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Info banner for guests */}
      {!isHost && (
        <div className="info-banner">
          Everyone hears the same music in sync. Make sure Spotify is open on your device!
        </div>
      )}
    </div>
  );
}

export default App;
