
(function() {
    const MAX_ROUNDS = 5;
    const SCORE_K = 288; // Score coefficient for km distance

    const state = {
        peer: null,
        conn: null, // If client, connection to host. If host, null (uses connections array)
        connections: [], // Only for host
        isHost: false,
        roomId: null,
        playerName: "Player",
        players: {}, // id: { name, score, currentGuess, hasGuessed, totalScore }
        currentRound: 0,
        currentPhoto: null,
        gameState: "lobby", // lobby, guessing, results, finished
        roundPhotos: []
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
        inputPlayerName: document.getElementById('input-player-name'),
        inputRoomId: document.getElementById('input-room-id'),
        playerNameDisplay: document.getElementById('player-name-display'),
        roomIdBadge: document.getElementById('room-id-badge'),
        roomIdText: document.getElementById('room-id-text'),
        playersCountBadge: document.getElementById('players-count-badge'),
        playersCountText: document.getElementById('players-count-text'),
        roundInfo: document.getElementById('round-info'),
        photoToGuess: document.getElementById('photo-background'),
        btnSubmit: document.getElementById('btn-submit'),
        scoreboard: document.getElementById('scoreboard'),
        scoreList: document.getElementById('score-list'),
        hostControls: document.getElementById('host-controls'),
        waitingMsg: document.getElementById('waiting-msg')
    };

    window.GeoGuessr = {
        onMarkerPlaced: (coords) => {
            if (state.gameState === "guessing" && !state.players[state.peer.id].hasGuessed) {
                el.btnSubmit.disabled = false;
            }
        }
    };

    function init() {
        if (!window.MapEngine) {
            setTimeout(init, 100);
            return;
        }
        // Load player name from local storage
        const savedName = localStorage.getItem('fer_geoguessr_name');
        if (savedName) el.inputPlayerName.value = savedName;

        window.MapEngine.setGuessingMode(true);
    }

    window.copyRoomCode = function() {
        const code = el.roomIdText.innerText;
        if (!code || code === '-') return;

        navigator.clipboard.writeText(code).then(() => {
            const copyStatus = document.getElementById('copy-status');
            if (copyStatus) {
                const originalText = copyStatus.innerText;
                copyStatus.innerText = "COPIED!";
                copyStatus.style.color = "#2ecc71";
                setTimeout(() => {
                    copyStatus.innerText = originalText;
                    copyStatus.style.color = "";
                }, 2000);
            }
        });
    };

    window.createRoom = function() {
        const name = el.inputPlayerName.value.trim() || "Host";
        state.playerName = name;
        localStorage.setItem('fer_geoguessr_name', name);
        state.isHost = true;
        
        setupPeer(() => {
            el.lobbyRoomDisplay.style.display = 'block';
            el.lobbyInitialControls.style.display = 'none';
            el.lobbyWaitingControls.style.display = 'block';
            
            el.lobbyRoomId.innerText = state.peer.id;
            el.roomIdText.innerText = state.peer.id;
            
            addPlayer(state.peer.id, state.playerName);
            console.log("Room Created. ID:", state.peer.id);
        });
    };

    window.joinRoom = function() {
        const name = el.inputPlayerName.value.trim() || "Player";
        const roomId = el.inputRoomId.value.trim(); // Removed .toUpperCase()
        if (!roomId) return alert("Please enter a Room ID");

        state.playerName = name;
        localStorage.setItem('fer_geoguessr_name', name);
        state.isHost = false;
        state.roomId = roomId;

        el.lobbyInitialControls.style.display = 'none';
        el.lobbyRoomDisplay.style.display = 'block';
        el.lobbyRoomId.innerText = "CONNECTING...";
        el.lobbyRoomId.style.color = "#f1c40f";

        setupPeer(() => {
            console.log("Peer ready, connecting to:", roomId);
            state.conn = state.peer.connect(roomId, {
                reliable: true
            });
            setupConnection(state.conn);
            
            el.lobbyWaitingControls.style.display = 'block';
            el.btnStartGame.style.display = 'none';
            el.lobbyRoomId.innerText = state.roomId;
            el.lobbyRoomId.style.color = "var(--accent)";
            el.roomIdText.innerText = state.roomId;
        });
    };

    window.hostStartGame = function() {
        if (state.isHost) {
            startNewGame();
        }
    };

    function setupPeer(onReady) {
        // Explicitly set for HTTPS environment (like GitHub Pages)
        state.peer = new Peer({
            debug: 3, // Full debug info in console
            config: {
                'iceServers': [
                    { url: 'stun:stun.l.google.com:19302' },
                    { url: 'stun:stun1.l.google.com:19302' },
                ]
            }
        });

        state.peer.on('open', (id) => {
            console.log('Peer ID Opened:', id);
            onReady();
        });

        state.peer.on('connection', (conn) => {
            if (state.isHost) {
                console.log('New connection from:', conn.peer);
                setupConnection(conn);
            }
        });

        state.peer.on('error', (err) => {
            console.error('Peer error:', err);
            const errMsg = document.getElementById('lobby-room-id');
            if (errMsg) {
                errMsg.innerText = "ERROR: " + err.type.toUpperCase();
                errMsg.style.color = "#e74c3c";
            }
            alert("Connection error: " + err.type + "\nMake sure you copied the ID correctly.");
        });
    }

    function setupConnection(conn) {
        conn.on('open', () => {
            console.log("Connection Established:", conn.peer);
            if (state.isHost) {
                state.connections.push(conn);
                // Host doesn't know player name yet, will get it in 'join' message
            } else {
                console.log("Sending join request as:", state.playerName);
                sendToHost({ type: 'join', name: state.playerName });
                
                // Show the room code clearly when connected
                el.lobbyRoomId.innerText = state.roomId;
                el.lobbyRoomId.style.color = "var(--accent)";
            }
        });

        conn.on('data', (data) => {
            handleMessage(data, conn);
        });

        conn.on('close', () => {
            console.warn('Player disconnected:', conn.peer);
            delete state.players[conn.peer];
            if (state.isHost) {
                state.connections = state.connections.filter(c => c.peer !== conn.peer);
                broadcastState();
            }
            updateUI();
        });
    }

    function handleMessage(data, conn) {
        console.log('Received Message:', data.type, data);
        switch (data.type) {
            case 'join':
                if (state.isHost) {
                    addPlayer(conn.peer, data.name);
                    broadcastState();
                }
                break;
            case 'gameState':
                updateFromState(data.state);
                break;
            case 'guess':
                if (state.isHost) {
                    handlePlayerGuess(conn.peer, data.coords);
                }
                break;
            case 'nextRound':
                if (state.isHost) {
                    startNextRound();
                }
                break;
        }
    }

    function sendToHost(data) {
        if (state.conn) state.conn.send(data);
    }

    function broadcast(data) {
        state.connections.forEach(c => c.send(data));
    }

    function broadcastState() {
        broadcast({
            type: 'gameState',
            state: {
                players: state.players,
                currentRound: state.currentRound,
                currentPhoto: state.currentPhoto,
                gameState: state.gameState
            }
        });
        updateUI();
    }

    function addPlayer(id, name) {
        state.players[id] = {
            id: id,
            name: name,
            score: 0,
            totalScore: 0,
            hasGuessed: false,
            currentGuess: null
        };
        updateUI();
    }

    function startNewGame() {
        state.currentRound = 0;
        state.roundPhotos = [];
        // Pick 5 random photos
        const photos = [...window.USER_PHOTOS];
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const idx = Math.floor(Math.random() * photos.length);
            state.roundPhotos.push(photos.splice(idx, 1)[0]);
        }
        startNextRound();
    }

    function startNextRound() {
        state.currentRound++;
        if (state.currentRound > MAX_ROUNDS) {
            state.gameState = "finished";
        } else {
            state.gameState = "guessing";
            state.currentPhoto = state.roundPhotos[state.currentRound - 1];
            // Reset player round state
            Object.values(state.players).forEach(p => {
                p.hasGuessed = false;
                p.currentGuess = null;
                p.score = 0;
            });
        }
        broadcastState();
        updateUI();
    }

    function updateFromState(newState) {
        state.players = newState.players;
        state.currentRound = newState.currentRound;
        state.currentPhoto = newState.currentPhoto;
        state.gameState = newState.gameState;
        updateUI();
    }

    function updateUI() {
        el.playerNameDisplay.innerText = `PLAYER: ${state.playerName.toUpperCase()}`;
        el.roundInfo.innerText = `ROUND ${state.currentRound} / ${MAX_ROUNDS}`;
        el.playersCountText.innerText = Object.keys(state.players).length;

        if (state.gameState === "lobby") {
            el.playersListContainer.innerHTML = '';
            Object.values(state.players).forEach(p => {
                const pBadge = document.createElement('div');
                pBadge.className = 'room-badge';
                pBadge.style.background = 'rgba(39, 174, 96, 0.2)';
                pBadge.style.borderColor = 'var(--accent)';
                pBadge.innerText = p.name.toUpperCase();
                el.playersListContainer.appendChild(pBadge);
            });
            return;
        }

        // Hide lobby when game starts
        el.lobbyModal.style.display = 'none';
        el.roomIdBadge.style.display = 'block';
        el.playersCountBadge.style.display = 'block';

        if (state.currentPhoto) {
            el.photoToGuess.src = state.currentPhoto.photo;
        }

        if (state.gameState === "guessing") {
            el.scoreboard.style.display = 'none';
            el.btnSubmit.style.display = 'block';
            el.btnSubmit.disabled = true;
            window.MapEngine.setGuessingMode(true);
            
            // If already guessed, disable submit
            if (state.players[state.peer.id] && state.players[state.peer.id].hasGuessed) {
                el.btnSubmit.disabled = true;
                el.btnSubmit.innerText = "Guessed!";
            } else {
                el.btnSubmit.innerText = "Submit Guess";
            }
        } else if (state.gameState === "results" || state.gameState === "finished") {
            showScoreboard();
            window.MapEngine.setActualLocation(state.currentPhoto.lon, state.currentPhoto.lat);
        }
    }

    window.submitGuess = function() {
        const guess = window.MapEngine.getGuess();
        if (!guess) return;

        if (state.isHost) {
            handlePlayerGuess(state.peer.id, guess);
        } else {
            sendToHost({ type: 'guess', coords: guess });
            state.players[state.peer.id].hasGuessed = true;
            updateUI();
        }
    };

    function handlePlayerGuess(id, coords) {
        const player = state.players[id];
        if (!player || player.hasGuessed) return;

        player.currentGuess = coords;
        player.hasGuessed = true;

        const dist = getHaversineDistance(coords.lon, coords.lat, state.currentPhoto.lon, state.currentPhoto.lat);
        player.score = calculateScore(dist);
        player.totalScore += player.score;
        player.lastDist = dist;

        // Check if all players guessed
        const allGuessed = Object.values(state.players).every(p => p.hasGuessed);
        if (allGuessed) {
            state.gameState = "results";
        }
        broadcastState();
    }

    function calculateScore(dist) {
        if (dist < 0.05) return 5000;
        let score = 5000 * Math.exp(-dist / SCORE_K);
        return Math.max(0, Math.round(score));
    }

    function getHaversineDistance(lon1, lat1, lon2, lat2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function showScoreboard() {
        el.scoreboard.style.display = 'block';
        el.scoreList.innerHTML = '';
        
        const sortedPlayers = Object.values(state.players).sort((a, b) => b.totalScore - a.totalScore);
        
        sortedPlayers.forEach(p => {
            const row = document.createElement('div');
            row.className = 'score-row';
            row.innerHTML = `
                <span>${p.name}</span>
                <span>+${p.score} (${p.lastDist ? p.lastDist.toFixed(1) : 0} km) <strong>${p.totalScore}</strong></span>
            `;
            el.scoreList.appendChild(row);
        });

        if (state.isHost) {
            el.hostControls.style.display = 'block';
            el.waitingMsg.style.display = 'none';
        } else {
            el.hostControls.style.display = 'none';
            el.waitingMsg.style.display = 'block';
        }

        if (state.gameState === "finished") {
            document.getElementById('scoreboard-title').innerText = "FINAL RESULTS";
            if (state.isHost) {
                el.hostControls.innerHTML = '<button class="btn" style="width: 100%;" onclick="location.reload()">New Game</button>';
            }
        }
    }

    window.hostNextRound = function() {
        if (state.isHost) {
            startNextRound();
        }
    };

    init();
})();
