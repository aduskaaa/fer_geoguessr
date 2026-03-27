
(function () {
    const MAX_ROUNDS = 5;
    const ROUND_TIME = 60; // 60 seconds
    const SCORE_K = 288; // Score coefficient for km distance

    const state = {
        peer: null,
        conn: null,
        connections: [],
        isHost: false,
        roomId: null,
        playerName: "Player",
        players: {},
        currentRound: 0,
        currentPhoto: null,
        gameState: "lobby",
        roundPhotos: [],
        timeLeft: ROUND_TIME,
        timerInterval: null,
        // BUG FIX: Track local guess status strictly by round
        localHasGuessed: false,
        localLastGuessedRound: -1
    };

    // UI Elements
    const el = {
        lobbyModal: document.getElementById('lobby-modal'),
        lobbyRoomDisplay: document.getElementById('lobby-room-display'),
        lobbyRoomId: document.getElementById('lobby-room-id'),
        lobbyInitialControls: document.getElementById('lobby-initial-controls'),
        lobbyWaitingControls: document.getElementById('lobby-waiting-controls'),
        playersListContainer: document.getElementById('players-list-container'),
        btnStartGame: document.getElementById('btn-start-game'),
        clientWaitMsg: document.getElementById('client-wait-msg'),
        inputPlayerName: document.getElementById('input-player-name'),
        inputRoomId: document.getElementById('input-room-id'),
        playerNameDisplay: document.getElementById('player-name-display'),
        roomIdBadge: document.getElementById('room-id-badge'),
        roomIdText: document.getElementById('room-id-text'),
        playersCountBadge: document.getElementById('players-count-badge'),
        playersCountText: document.getElementById('players-count-text'),
        roundInfo: document.getElementById('round-info'),
        timerInfo: document.getElementById('timer-info'),
        photoToGuess: document.getElementById('photo-background'),
        btnSubmit: document.getElementById('btn-submit'),
        btnLeave: document.getElementById('btn-leave'),
        scoreboard: document.getElementById('scoreboard'),
        scoreList: document.getElementById('score-list'),
        hostControls: document.getElementById('host-controls'),
        waitingMsg: document.getElementById('waiting-msg'),
        loadingScreen: document.getElementById('loading-screen')
    };

    window.GeoGuessr = {
        onMarkerPlaced: (coords) => {
            const hasGuessedThisRound = state.localHasGuessed && state.localLastGuessedRound === state.currentRound;
            if (state.gameState === "guessing" && !hasGuessedThisRound) {
                el.btnSubmit.disabled = false;
            }
        },
        canPlaceMarker: () => {
            if (!state.players[state.peer.id]) return false;
            const hasGuessedThisRound = state.localHasGuessed && state.localLastGuessedRound === state.currentRound;
            return state.gameState === "guessing" && !hasGuessedThisRound && !state.players[state.peer.id].hasGuessed;
        }
    };

    let lastRoundSeen = -1;
    let heartbeatInterval = null;

    function generateShortId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function init() {
        if (!window.MapEngine) {
            setTimeout(init, 100);
            return;
        }
        el.loadingScreen.style.opacity = '0';
        setTimeout(() => el.loadingScreen.style.display = 'none', 800);
        const savedName = localStorage.getItem('fer_geoguessr_name');
        if (savedName) el.inputPlayerName.value = savedName;
        window.MapEngine.setGuessingMode(true);
    }

    window.copyRoomCode = function () {
        const code = el.roomIdText.innerText;
        if (!code || code === '-' || code === 'CONNECTING...') return;
        navigator.clipboard.writeText(code).then(() => {
            const copyStatus = document.getElementById('copy-status');
            if (copyStatus) {
                const originalText = copyStatus.innerText;
                copyStatus.innerText = "COPIED!";
                setTimeout(() => copyStatus.innerText = originalText, 2000);
            }
        });
    };

    window.createRoom = function () {
        if (state.peer) return;
        const name = el.inputPlayerName.value.trim() || "Host";
        state.playerName = name;
        localStorage.setItem('fer_geoguessr_name', name);
        state.isHost = true;

        const attemptCreate = (id) => {
            setupPeer(id, () => {
                el.lobbyRoomDisplay.style.display = 'block';
                el.lobbyInitialControls.style.display = 'none';
                el.lobbyWaitingControls.style.display = 'block';
                el.btnLeave.style.display = 'block';
                el.lobbyRoomId.innerText = state.peer.id;
                el.roomIdText.innerText = state.peer.id;
                addPlayer(state.peer.id, state.playerName);
            }, (err) => {
                if (err.type === 'unavailable-id') {
                    attemptCreate(generateShortId());
                } else {
                    console.error("Peer Error:", err);
                    alert("Failed to create room: " + err.type);
                    location.reload();
                }
            });
        };
        attemptCreate(generateShortId());
    };

    window.joinRoom = function () {
        if (state.peer) return;
        const name = el.inputPlayerName.value.trim() || "Player";
        const roomIdInput = el.inputRoomId.value.trim().toUpperCase();
        if (!roomIdInput) return alert("Please enter a Room ID");
        state.playerName = name;
        localStorage.setItem('fer_geoguessr_name', name);
        state.isHost = false;
        state.roomId = roomIdInput;
        
        el.lobbyInitialControls.style.display = 'none';
        el.lobbyRoomDisplay.style.display = 'block';
        el.lobbyRoomId.innerText = "CONNECTING...";
        el.lobbyRoomId.style.color = "#f1c40f";

        setupPeer(null, (myId) => {
            console.log("[LOBBY] My client ID is:", myId);
            console.log("[LOBBY] Attempting to connect to host:", state.roomId);
            
            // Peer.connect uses the default reliable WebRTC data channel
            state.conn = state.peer.connect(state.roomId);
            setupConnection(state.conn);
            
            // Connection Timeout for Join
            const connTimeout = setTimeout(() => {
                if (!state.conn || !state.conn.open) {
                    console.error("[LOBBY] Connection timeout to host:", state.roomId);
                    alert("Could not connect to room " + state.roomId + ". Check code or host status.");
                    location.reload();
                }
            }, 12000);

            state.conn.on('open', () => {
                clearTimeout(connTimeout);
                console.log("[LOBBY] Connected to host successfully.");
                el.lobbyWaitingControls.style.display = 'block';
                el.btnStartGame.style.display = 'none';
                el.clientWaitMsg.style.display = 'block';
                el.btnLeave.style.display = 'block';
                el.lobbyRoomId.innerText = state.roomId;
                el.lobbyRoomId.style.color = "var(--accent)";
                el.roomIdText.innerText = state.roomId;
            });

            state.conn.on('error', (err) => {
                clearTimeout(connTimeout);
                console.error("[LOBBY] Connection error:", err);
                alert("Failed to join room: " + err.message);
                location.reload();
            });
        }, (err) => {
            console.error("[LOBBY] Peer setup error:", err);
            alert("Peer setup error: " + err.type);
            location.reload();
        });
    };

    window.hostStartGame = function () {
        if (state.isHost) startNewGame();
    };

    function setupPeer(id, onReady, onError) {
        // Explicitly defining a small set of high-performance STUN servers.
        // Keeping it under 5 to avoid discovery delays as noted by the browser.
        const options = {
            debug: 1,
            config: {
                'iceServers': [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ],
                'iceCandidatePoolSize': 10
            }
        };

        try {
            state.peer = id ? new Peer(id, options) : new Peer(options);
        } catch (e) {
            console.error("[PEER] PeerJS Constructor Error:", e);
            state.peer = new Peer({ debug: 1 });
        }
        
        state.peer.on('open', (id) => {
            console.log("[PEER] Peer object opened. ID:", id);
            onReady(id);
        });
        
        state.peer.on('connection', (conn) => { 
            if (state.isHost) {
                console.log("[PEER] Host received connection request from:", conn.peer);
                setupConnection(conn); 
            }
        });

        state.peer.on('error', (err) => {
            console.error("[PEER] Global Peer Error:", err.type, err);
            if (onError) onError(err);
            else {
                alert("Network Error: " + err.type);
                location.reload();
            }
        });

        // Fast heartbeat (3s) to keep connections alive through NATs
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (state.isHost) {
                broadcast({ type: 'heartbeat' });
            } else if (state.conn && state.conn.open) {
                sendToHost({ type: 'heartbeat' });
            }
        }, 3000);
    }

    function setupConnection(conn) {
        console.log("[PEER] Initializing connection handshake for:", conn.peer);
        
        // Increased timeout (25s) for ICE gathering and WebRTC negotiation.
        // Some networks/firewalls take longer to establish the P2P data channel.
        const handshakeTimeout = setTimeout(() => {
            if (!conn.open) {
                console.warn("[PEER] Handshake timeout (25s) for:", conn.peer, ". Closing stale connection.");
                conn.close();
            }
        }, 25000);

        conn.on('open', () => {
            clearTimeout(handshakeTimeout);
            console.log("[PEER] Data channel successfully OPEN with:", conn.peer);
            if (state.isHost) {
                // Remove any existing connection for this peer to avoid duplicates
                state.connections = state.connections.filter(c => c.peer !== conn.peer);
                state.connections.push(conn);
                
                conn.send({
                    type: 'gameState',
                    state: {
                        players: state.players, currentRound: state.currentRound,
                        currentPhoto: state.currentPhoto, gameState: state.gameState, timeLeft: state.timeLeft
                    }
                });
            } else {
                console.log("[PEER] Sending join request to host...");
                sendToHost({ type: 'join', name: state.playerName });
            }
        });

        conn.on('data', (data) => {
            if (data.type !== 'heartbeat') console.log("[PEER] Data from", conn.peer, ":", data.type);
            handleMessage(data, conn);
        });

        conn.on('close', () => {
            console.log("[PEER] Connection CLOSED with:", conn.peer);
            if (state.isHost) {
                delete state.players[conn.peer];
                state.connections = state.connections.filter(c => c.peer !== conn.peer);
                broadcastState();
            } else {
                alert("Host disconnected.");
                location.reload();
            }
            updateUI();
        });

        conn.on('error', (err) => {
            console.error("[PEER] Connection-level error with:", conn.peer, err);
            conn.close();
        });
    }

    function handleMessage(data, conn) {
        switch (data.type) {
            case 'heartbeat':
                // Just to keep connection alive
                break;
            case 'join':
                if (state.isHost) { 
                    addPlayer(conn.peer, data.name); 
                    broadcastState(); 
                }
                break;
            case 'gameState':
                updateFromState(data.state);
                break;
            case 'timerTick':
                state.timeLeft = data.timeLeft;
                updateUI();
                break;
            case 'guess':
                if (state.isHost) handlePlayerGuess(conn.peer, data.coords);
                break;
            case 'nextRound':
                if (state.isHost) startNextRound();
                break;
        }
    }

    function sendToHost(data) { if (state.conn && state.conn.open) state.conn.send(data); }
    function broadcast(data) { state.connections.forEach(c => { if (c.open) c.send(data); }); }

    function broadcastState() {
        broadcast({
            type: 'gameState',
            state: {
                players: state.players, currentRound: state.currentRound,
                currentPhoto: state.currentPhoto, gameState: state.gameState, timeLeft: state.timeLeft
            }
        });
        updateUI();
    }

    function broadcastTimer() { broadcast({ type: 'timerTick', timeLeft: state.timeLeft }); updateUI(); }

    function startTimer() {
        if (state.timerInterval) clearInterval(state.timerInterval);
        state.timeLeft = ROUND_TIME;
        broadcastState();
        state.timerInterval = setInterval(() => {
            if (!state.isHost) return;
            state.timeLeft--;
            if (state.timeLeft <= 0) { clearInterval(state.timerInterval); finishRound(); }
            else { broadcastTimer(); }
        }, 1000);
    }

    function finishRound() {
        Object.keys(state.players).forEach(id => {
            if (!state.players[id].hasGuessed) handlePlayerGuess(id, { lon: 0, lat: 0 });
        });
        state.gameState = "results";
        broadcastState();
    }

    function addPlayer(id, name) {
        state.players[id] = { id: id, name: name, score: 0, totalScore: 0, hasGuessed: false, currentGuess: null };
        updateUI();
    }

    function startNewGame() {
        state.currentRound = 0;
        Object.values(state.players).forEach(p => { p.score = 0; p.totalScore = 0; p.hasGuessed = false; p.currentGuess = null; });
        const sourceData = window.streetview_data
            ? window.streetview_data.map(sv => ({
                name: "Streetview #" + sv.id,
                lon: sv.lon,
                lat: sv.lat,
                photo: "https://raw.githubusercontent.com/aduskaaa/aduskaaa/main/imgs/streetview/" + sv.file
            }))
            : [...window.USER_PHOTOS];
        const photos = [...sourceData];
        for (let i = photos.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [photos[i], photos[j]] = [photos[j], photos[i]];
        }
        state.roundPhotos = photos.slice(0, MAX_ROUNDS);
        startNextRound();
    }

    function startNextRound() {
        state.currentRound++;
        Object.values(state.players).forEach(p => { p.hasGuessed = false; p.currentGuess = null; p.score = 0; });
        if (state.currentRound > MAX_ROUNDS) {
            state.gameState = "finished";
            if (state.timerInterval) clearInterval(state.timerInterval);
        } else {
            state.gameState = "guessing";
            state.currentPhoto = state.roundPhotos[state.currentRound - 1];
            startTimer();
        }
        broadcastState();
    }

    function updateFromState(newState) {
        state.players = newState.players;
        state.currentRound = newState.currentRound;
        state.currentPhoto = newState.currentPhoto;
        state.gameState = newState.gameState;
        state.timeLeft = newState.timeLeft;
        updateUI();
    }

    function updateUI() {
        if (state.gameState === "lobby") {
            el.playersListContainer.innerHTML = '';
            const playerIds = Object.keys(state.players);
            if (playerIds.length === 0 && !state.isHost) {
                el.playersListContainer.innerHTML = '<div style="color:#666; font-size:10px;">WAITING FOR PLAYER LIST...</div>';
            }
            Object.values(state.players).forEach(p => {
                const pBadge = document.createElement('div');
                pBadge.className = 'player-badge';
                if (p.id === (state.peer ? state.peer.id : null)) pBadge.style.color = 'var(--accent)';
                pBadge.innerText = p.name.toUpperCase();
                el.playersListContainer.appendChild(pBadge);
            });
            return;
        }

        if (!state.players[state.peer.id]) return;
        el.playerNameDisplay.innerText = `PLAYER: ${state.playerName.toUpperCase()}`;
        el.roundInfo.innerText = `ROUND ${state.currentRound} / ${MAX_ROUNDS}`;
        el.playersCountText.innerText = Object.keys(state.players).length;
        const mins = Math.floor(state.timeLeft / 60);
        const secs = state.timeLeft % 60;
        el.timerInfo.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        if (state.timeLeft <= 10 && state.gameState === "guessing") el.timerInfo.classList.add('timer-low');
        else el.timerInfo.classList.remove('timer-low');

        if (state.gameState === "lobby") {
            el.playersListContainer.innerHTML = '';
            Object.values(state.players).forEach(p => {
                const pBadge = document.createElement('div');
                pBadge.className = 'player-badge';
                if (p.id === state.peer.id) pBadge.style.color = 'var(--accent)';
                pBadge.innerText = p.name.toUpperCase();
                el.playersListContainer.appendChild(pBadge);
            });
            return;
        }

        el.lobbyModal.style.display = 'none';
        el.roomIdBadge.style.display = 'block';
        el.playersCountBadge.style.display = 'block';
        el.timerInfo.style.display = (state.gameState === "guessing") ? 'block' : 'none';
        el.roundInfo.style.display = 'block';

        if (state.currentRound !== lastRoundSeen) {
            window.MapEngine.initRound();
            lastRoundSeen = state.currentRound;
            state.localHasGuessed = false; // RESET LOCAL LOCK

            if (state.currentPhoto) {
                document.getElementById('photo-loader').style.display = 'flex';
                el.photoToGuess.style.opacity = '0';
                el.photoToGuess.src = state.currentPhoto.photo;

                // Check if this is a streetview photo
                if (state.currentPhoto.photo.includes('streetview')) {
                    const svIdMatch = state.currentPhoto.name.match(/#(\d+)/);
                    if (svIdMatch && window.MapEngine && window.MapEngine.findBestStreetViewOptions) {
                        renderStreetViewOverlay(parseInt(svIdMatch[1]), state.currentPhoto.lon, state.currentPhoto.lat);
                    }
                } else {
                    clearStreetViewOverlay();
                }
            }
        }

        if (state.gameState === "guessing") {
            el.scoreboard.style.display = 'none';
            el.btnSubmit.style.display = 'block';
            const hasGuessedThisRound = state.localHasGuessed && state.localLastGuessedRound === state.currentRound;
            const serverSaysGuessed = state.players[state.peer.id].hasGuessed;

            if (hasGuessedThisRound || serverSaysGuessed) {
                el.btnSubmit.disabled = true;
                el.btnSubmit.innerText = "Guessed!";
                el.btnSubmit.style.background = "#333";
            } else {
                el.btnSubmit.innerText = "Submit Guess";
                el.btnSubmit.style.background = "";
                const curGuess = window.MapEngine.getGuess();
                el.btnSubmit.disabled = (curGuess === null);
            }
            if (!window.MapEngine.isGuessingMode()) window.MapEngine.setGuessingMode(true);
        } else if (state.gameState === "results" || state.gameState === "finished") {
            showScoreboard();
            window.MapEngine.setActualLocation(state.currentPhoto.lon, state.currentPhoto.lat);
            window.MapEngine.setPlayerGuesses(state.players);
        }
    }

    window.submitGuess = function () {
        const guess = window.MapEngine.getGuess();
        if (!guess || state.localHasGuessed) return;
        state.localHasGuessed = true;
        state.localLastGuessedRound = state.currentRound;
        if (state.isHost) handlePlayerGuess(state.peer.id, guess);
        else {
            sendToHost({ type: 'guess', coords: guess });
            updateUI();
        }
    };

    function handlePlayerGuess(id, coords) {
        const player = state.players[id];
        if (!player || player.hasGuessed) return;
        player.currentGuess = coords;
        player.hasGuessed = true;
        if (coords && coords.lon !== 0) {
            const dist = getHaversineDistance(coords.lon, coords.lat, state.currentPhoto.lon, state.currentPhoto.lat);
            player.score = calculateScore(dist);
            player.lastDist = dist;
        } else { player.score = 0; player.lastDist = 9999; }
        player.totalScore += player.score;
        const allGuessed = Object.values(state.players).every(p => p.hasGuessed);
        if (allGuessed) {
            state.gameState = "results";
            if (state.timerInterval) clearInterval(state.timerInterval);
            broadcastState();
        } else broadcastState();
    }

    function calculateScore(dist) {
        if (dist < 0.05) return 5000;
        return Math.max(0, Math.round(5000 * Math.exp(-dist / SCORE_K)));
    }

    function getHaversineDistance(lon1, lat1, lon2, lat2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function showScoreboard() {
        el.scoreboard.style.display = 'block';
        el.scoreList.innerHTML = '';
        const sorted = Object.values(state.players).sort((a, b) => b.totalScore - a.totalScore);
        sorted.forEach((p, idx) => {
            const row = document.createElement('div');
            row.className = 'score-row';
            if (idx === 0 && state.gameState === "finished") row.style.color = "#f1c40f";
            let sc = (p.score === 0) ? `<span style="color:#e74c3c">MISS</span>` : `+${p.score}`;
            row.innerHTML = `<span>${idx + 1}. ${p.name} ${idx === 0 && state.gameState === "finished" ? '👑' : ''}</span>
                             <span>${sc} <span style="font-size:10px;opacity:0.7">(${p.lastDist ? p.lastDist.toFixed(1) : '-'} km)</span> <strong>${p.totalScore}</strong></span>`;
            el.scoreList.appendChild(row);
        });
        if (state.isHost) {
            el.hostControls.style.display = 'block';
            el.waitingMsg.style.display = 'none';
            el.hostControls.innerHTML = '';
            const btn = document.createElement('button');
            btn.className = 'btn'; btn.style.width = '100%';
            if (state.gameState === "finished") {
                document.getElementById('scoreboard-title').innerText = "FINAL RESULTS";
                btn.innerText = 'Start New Game';
                btn.onclick = () => startNewGame();
            } else {
                document.getElementById('scoreboard-title').innerText = "ROUND RESULTS";
                btn.innerText = 'Next Round';
                btn.onclick = () => hostNextRound();
            }
            el.hostControls.appendChild(btn);
        } else {
            el.hostControls.style.display = 'none';
            if (state.gameState !== "finished") el.waitingMsg.style.display = 'block';
            el.waitingMsg.innerText = state.gameState === "finished" ? "Waiting for host to restart..." : "WAITING FOR HOST...";
        }
    }

    // --- STREETVIEW OVERLAY ENGINE ---
    let svOverlayContainer = null;
    function getOrCreateSVOverlay() {
        if (!svOverlayContainer) {
            svOverlayContainer = document.createElement('div');
            svOverlayContainer.id = 'geoguessr-sv-overlay';
            svOverlayContainer.style.position = 'absolute';
            svOverlayContainer.style.inset = '0';
            svOverlayContainer.style.pointerEvents = 'none';
            svOverlayContainer.style.zIndex = '500'; // above photo, below map
            document.getElementById('map-root').appendChild(svOverlayContainer);
        }
        return svOverlayContainer;
    }

    function clearStreetViewOverlay() {
        if (svOverlayContainer) {
            svOverlayContainer.innerHTML = '';
        }
    }

    function renderStreetViewOverlay(svId, lon, lat, currentRotation = null) {
        if (!window.streetview_data) return;
        const svNode = window.streetview_data.find(s => s.id === svId);
        if (!svNode) return;

        const overlay = getOrCreateSVOverlay();
        overlay.innerHTML = ''; // clear previous

        // Get navigation logic from the map engine
        const svCurrentRotation = currentRotation !== null ? currentRotation : (svNode.truck_rotation * Math.PI * 2);
        const navData = window.MapEngine.findBestStreetViewOptions(svId, lon, lat, svCurrentRotation);
        if (!navData) return;

        const bestOptions = navData.bestOptions;
        const taBestIndex = navData.taBestIndex;

        // Construct the 3D-perspective ground navigation cluster
        const clusterWrap = document.createElement('div');
        clusterWrap.style.cssText = `
            position: absolute;
            bottom: 15%;
            left: 50%;
            width: 0px;
            height: 0px;
            transform: translateX(-50%) perspective(800px) rotateX(65deg);
            pointer-events: none;
        `;

        // Turn Around Button in exact center
        const centerTa = document.createElement('div');
        centerTa.style.cssText = `
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 80px; height: 80px;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255,255,255,0.7);
            border-radius: 50%;
            pointer-events: auto;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-size: 32px; font-weight: bold;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 10px 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(255,255,255,0.2);
        `;
        centerTa.innerHTML = '&#x21bb;';
        centerTa.onclick = () => {
            if (taBestIndex !== -1) navigateToStreetView(taBestIndex);
        };
        centerTa.onmouseover = () => { centerTa.style.transform = 'translate(-50%, -50%) scale(1.15)'; centerTa.style.background = 'rgba(255,255,255,0.3)'; };
        centerTa.onmouseout = () => { centerTa.style.transform = 'translate(-50%, -50%) scale(1)'; centerTa.style.background = 'rgba(0,0,0,0.6)'; };
        clusterWrap.appendChild(centerTa);

        // Sleek Map-style ground chevron
        const modernIcon = `<svg width="50" height="50" viewBox="0 0 100 100" style="filter: drop-shadow(0 -5px 15px rgba(255,255,255,0.8)) drop-shadow(0 5px 5px rgba(0,0,0,0.9));"><path d="M10,80 L50,15 L90,80 L50,60 Z" fill="rgba(255,255,255,1)" stroke="rgba(0,0,0,0.4)" stroke-width="2"/></svg>`;

        ['forward', 'left', 'right', 'backward'].forEach(dir => {
            if (bestOptions[dir].index !== -1) {
                let rotRad = bestOptions[dir].angle;
                let rotDeg = rotRad * 180 / Math.PI;

                const pathLine = document.createElement('div');
                pathLine.style.cssText = `
                    position: absolute;
                    bottom: 50%; left: 50%;
                    width: 8px; height: 180px;
                    background: linear-gradient(to top, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 100%);
                    transform-origin: bottom center;
                    transform: translateX(-50%) rotate(${rotDeg}deg) translateY(-50px);
                    border-radius: 4px;
                    box-shadow: 0 0 20px rgba(0,0,0,0.8);
                    opacity: 0.6;
                    transition: all 0.3s ease;
                    pointer-events: none;
                `;
                clusterWrap.appendChild(pathLine);

                const arrowContainer = document.createElement('div');
                arrowContainer.style.cssText = `
                    position: absolute; 
                    top: 50%; left: 50%;
                    cursor: pointer; 
                    pointer-events: auto; 
                    opacity: 0.9; 
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
                    display: inline-flex; 
                    transform: translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-235px);
                `;
                arrowContainer.innerHTML = modernIcon;

                arrowContainer.onmouseover = () => {
                    arrowContainer.style.opacity = '1';
                    arrowContainer.style.transform = `translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-235px) scale(1.4)`;
                    pathLine.style.opacity = '1';
                    pathLine.style.background = 'linear-gradient(to top, rgba(255,215,0,0) 0%, rgba(255,215,0,0.9) 100%)';
                    pathLine.style.boxShadow = '0 0 25px rgba(255,215,0,0.9)';
                };
                arrowContainer.onmouseout = () => {
                    arrowContainer.style.opacity = '0.9';
                    arrowContainer.style.transform = `translate(-50%, -50%) rotate(${rotDeg}deg) translateY(-235px) scale(1)`;
                    pathLine.style.opacity = '0.6';
                    pathLine.style.background = 'linear-gradient(to top, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 100%)';
                    pathLine.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';
                };

                arrowContainer.onclick = () => {
                    // Current rotation of this node plus the relative angle of the arrow gives the true world bearing we clicked
                    const moveBearing = svCurrentRotation + bestOptions[dir].angle;
                    navigateToStreetView(bestOptions[dir].index, moveBearing);
                };

                clusterWrap.appendChild(arrowContainer);
            }
        });

        overlay.appendChild(clusterWrap);
    }

    function navigateToStreetView(index, targetBearing) {
        if (!window.MapEngine || !window.MapEngine.getStreetViewData) return;
        const svData = window.MapEngine.getStreetViewData(index);
        if (!svData) return;

        // Visual fade
        document.getElementById('photo-loader').style.display = 'flex';
        el.photoToGuess.style.opacity = '0';

        setTimeout(() => {
            el.photoToGuess.src = `https://raw.githubusercontent.com/aduskaaa/aduskaaa/main/imgs/streetview/${svData.properties.file}`;
            const newLon = svData.geometry.coordinates[0];
            const newLat = svData.geometry.coordinates[1];

            // Pass the bearing we wanted to look at, so the new node bases its "forward" relative to that bearing
            renderStreetViewOverlay(svData.properties.id, newLon, newLat, targetBearing);
        }, 150);
    }

    window.hostNextRound = function () { if (state.isHost) startNextRound(); };
    init();
})();
