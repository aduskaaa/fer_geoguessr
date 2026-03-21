(function() {
    const MAX_ROUNDS = 5;
    const ROUND_TIME = 60; // 60 seconds
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
        roundPhotos: [],
        timeLeft: ROUND_TIME,
        timerInterval: null
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
            if (state.gameState === "guessing" && !state.players[state.peer.id].hasGuessed) {
                el.btnSubmit.disabled = false;
            }
        },
        canPlaceMarker: () => {
            if (!state.players[state.peer.id]) return false;
            return state.gameState === "guessing" && !state.players[state.peer.id].hasGuessed;
        }
    };

    let lastRoundSeen = -1;
    function init() {
        if (!window.MapEngine) {
            setTimeout(init, 100);
            return;
        }
        
        // Hide initial loader
        el.loadingScreen.style.opacity = '0';
        setTimeout(() => el.loadingScreen.style.display = 'none', 800);

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
                setTimeout(() => {
                    copyStatus.innerText = originalText;
                }, 2000);
            }
        });
    };

    window.createRoom = function() {
        if (state.peer) return; // Safeguard
        
        const name = el.inputPlayerName.value.trim() || "Host";
        state.playerName = name;
        localStorage.setItem('fer_geoguessr_name', name);
        state.isHost = true;
        
        setupPeer(() => {
            el.lobbyRoomDisplay.style.display = 'block';
            el.lobbyInitialControls.style.display = 'none';
            el.lobbyWaitingControls.style.display = 'block';
            el.btnLeave.style.display = 'block';
            
            el.lobbyRoomId.innerText = state.peer.id;
            el.roomIdText.innerText = state.peer.id;
            
            addPlayer(state.peer.id, state.playerName);
            console.log("Room Created. ID:", state.peer.id);
        });
    };

    window.joinRoom = function() {
        if (state.peer) return; // Safeguard
        
        const name = el.inputPlayerName.value.trim() || "Player";
        const roomId = el.inputRoomId.value.trim();
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
            state.conn = state.peer.connect(roomId, { reliable: true });
            setupConnection(state.conn);
            
            el.lobbyWaitingControls.style.display = 'block';
            el.btnStartGame.style.display = 'none';
            el.clientWaitMsg.style.display = 'block';
            el.btnLeave.style.display = 'block';
            
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
        state.peer = new Peer({
            debug: 3,
            config: {
                'iceServers': [
                    { url: 'stun:stun.l.google.com:19302' },
                    { url: 'stun:stun1.l.google.com:19302' },
                ]
            }
        });

        state.peer.on('open', (id) => onReady());

        state.peer.on('connection', (conn) => {
            if (state.isHost) {
                setupConnection(conn);
            }
        });

        state.peer.on('error', (err) => {
            console.error('Peer error:', err);
            const errMsg = el.lobbyRoomId;
            if (errMsg) {
                errMsg.innerText = "ERROR: " + err.type.toUpperCase();
                errMsg.style.color = "#e74c3c";
            }
            alert("Connection error: " + err.type);
            location.reload();
        });
    }

    function setupConnection(conn) {
        conn.on('open', () => {
            if (state.isHost) {
                state.connections.push(conn);
            } else {
                sendToHost({ type: 'join', name: state.playerName });
            }
        });

        conn.on('data', (data) => handleMessage(data, conn));

        conn.on('close', () => {
            if (state.isHost) {
                delete state.players[conn.peer];
                state.connections = state.connections.filter(c => c.peer !== conn.peer);
                broadcastState();
            }
            updateUI();
        });
    }

    function handleMessage(data, conn) {
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
            case 'timerTick':
                state.timeLeft = data.timeLeft;
                updateUI();
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
                gameState: state.gameState,
                timeLeft: state.timeLeft
            }
        });
        updateUI();
    }

    function broadcastTimer() {
        broadcast({ type: 'timerTick', timeLeft: state.timeLeft });
        updateUI();
    }

    function startTimer() {
        if (state.timerInterval) clearInterval(state.timerInterval);
        state.timeLeft = ROUND_TIME;
        broadcastState();

        state.timerInterval = setInterval(() => {
            if (!state.isHost) return;
            state.timeLeft--;
            if (state.timeLeft <= 0) {
                clearInterval(state.timerInterval);
                finishRound();
            } else {
                broadcastTimer();
            }
        }, 1000);
    }

    function finishRound() {
        Object.keys(state.players).forEach(id => {
            if (!state.players[id].hasGuessed) {
                handlePlayerGuess(id, {lon: 0, lat: 0});
            }
        });
        state.gameState = "results";
        broadcastState();
    }

    function addPlayer(id, name) {
        state.players[id] = {
            id: id, name: name, score: 0,
            totalScore: 0, hasGuessed: false, currentGuess: null
        };
        updateUI();
    }

    function startNewGame() {
        state.currentRound = 0;
        state.roundPhotos = [];
        Object.values(state.players).forEach(p => {
            p.score = 0; p.totalScore = 0; p.hasGuessed = false; p.currentGuess = null;
        });
        const photos = [...window.USER_PHOTOS];
        for (let i = photos.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [photos[i], photos[j]] = [photos[j], photos[i]];
        }
        state.roundPhotos = photos.slice(0, MAX_ROUNDS);
        startNextRound();
    }

    function startNextRound() {
        state.currentRound++;
        Object.values(state.players).forEach(p => {
            p.hasGuessed = false; p.currentGuess = null; p.score = 0;
        });
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
        const myId = state.peer.id;
        const wasGuessedLocally = state.players[myId] ? state.players[myId].hasGuessed : false;
        state.players = newState.players;
        if (wasGuessedLocally && state.players[myId]) {
            state.players[myId].hasGuessed = true;
        }
        state.currentRound = newState.currentRound;
        state.currentPhoto = newState.currentPhoto;
        state.gameState = newState.gameState;
        state.timeLeft = newState.timeLeft;
        updateUI();
    }

    function updateUI() {
        if (!state.players[state.peer.id]) return;

        el.playerNameDisplay.innerText = `PLAYER: ${state.playerName.toUpperCase()}`;
        el.roundInfo.innerText = `ROUND ${state.currentRound} / ${MAX_ROUNDS}`;
        el.playersCountText.innerText = Object.keys(state.players).length;

        const minutes = Math.floor(state.timeLeft / 60);
        const seconds = state.timeLeft % 60;
        el.timerInfo.innerText = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

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
        el.timerInfo.style.display = 'block';
        el.roundInfo.style.display = 'block';

        if (state.currentRound !== lastRoundSeen) {
            window.MapEngine.initRound();
            lastRoundSeen = state.currentRound;
        }

        if (state.currentPhoto && el.photoToGuess.src !== state.currentPhoto.photo) {
            document.getElementById('photo-loader').style.display = 'flex';
            el.photoToGuess.style.opacity = '0';
            el.photoToGuess.src = state.currentPhoto.photo;
        }

        if (state.gameState === "guessing") {
            el.scoreboard.style.display = 'none';
            el.btnSubmit.style.display = 'block';
            const me = state.players[state.peer.id];
            if (me && me.hasGuessed) {
                el.btnSubmit.disabled = true;
                el.btnSubmit.innerText = "Guessed!";
                el.btnSubmit.style.background = "#333";
            } else {
                el.btnSubmit.innerText = "Submit Guess";
                el.btnSubmit.style.background = "";
                const currentGuess = window.MapEngine.getGuess();
                el.btnSubmit.disabled = (currentGuess === null);
            }
            if (window.MapEngine.isGuessingMode() === false) window.MapEngine.setGuessingMode(true);
        } else if (state.gameState === "results" || state.gameState === "finished") {
            showScoreboard();
            window.MapEngine.setActualLocation(state.currentPhoto.lon, state.currentPhoto.lat);
            window.MapEngine.setPlayerGuesses(state.players);
        }
    }

    window.submitGuess = function() {
        const guess = window.MapEngine.getGuess();
        if (!guess) return;
        if (state.isHost) {
            handlePlayerGuess(state.peer.id, guess);
        } else {
            state.players[state.peer.id].hasGuessed = true;
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
        } else { broadcastState(); }
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
        sortedPlayers.forEach((p, index) => {
            const row = document.createElement('div');
            row.className = 'score-row';
            if (index === 0 && state.gameState === "finished") {
                row.style.color = "#f1c40f"; row.style.fontWeight = "bold";
            }
            let scoreChange = `+${p.score}`;
            if (p.score === 0) scoreChange = `<span style="color:#e74c3c">MISS</span>`;
            row.innerHTML = `
                <span>${index + 1}. ${p.name} ${index === 0 && state.gameState === "finished" ? '👑' : ''}</span>
                <span>${scoreChange} <span style="font-size:10px; opacity:0.7">(${p.lastDist ? p.lastDist.toFixed(1) : '-'} km)</span> <strong>${p.totalScore}</strong></span>
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
                el.hostControls.innerHTML = '';
                const restartBtn = document.createElement('button');
                restartBtn.className = 'btn';
                restartBtn.style.width = '100%';
                restartBtn.innerText = 'Start New Game';
                restartBtn.onclick = () => startNewGame();
                el.hostControls.appendChild(restartBtn);
            } else { el.waitingMsg.innerText = "Waiting for host to start a new game..."; }
        } else {
             document.getElementById('scoreboard-title').innerText = "ROUND RESULTS";
             if (state.isHost) {
                 el.hostControls.innerHTML = '<button class="btn" style="width: 100%;" onclick="hostNextRound()">Next Round</button>';
             }
        }
    }

    window.hostNextRound = function() {
        if (state.isHost) startNextRound();
    };

    init();
})();
