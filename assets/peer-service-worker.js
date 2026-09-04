// assets/peer-service-worker.js
// WebSocket-based communication connecting to the Cloudflare Worker (worker/src/index.js).
// Supports local development with `npx wrangler dev` (ws://127.0.0.1:8787)
// and production deployment (wss://fer-geoguessr-multiplayer.fareastrussia.workers.dev).

(function () {
    const WEBSOCKET_SERVER_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? "ws://127.0.0.1:8787"
        : "wss://fer-geoguessr-multiplayer.fareastrussia.workers.dev";

    class PeerServiceWorker extends EventTarget {
        constructor() {
            super();
            this.ws = null;
            this.isHost = false;
            this.roomId = null;
            this.playerName = "Player";
            this.myPlayerId = null;
            this.connections = [];
        }

        get peer() {
            return this.ws;
        }

        createRoom(playerName) {
            if (this.ws) return;
            this.playerName = playerName;
            this.isHost = true;
            this.roomId = this._generateShortId();

            const wsUrl = `${WEBSOCKET_SERVER_URL}/ws/host/${this.roomId}?name=${encodeURIComponent(playerName)}`;
            this._setupWebSocket(wsUrl);
        }

        joinRoom(playerName, roomId) {
            if (this.ws) return;
            this.playerName = playerName;
            this.isHost = false;
            this.roomId = (roomId || '').trim().toUpperCase();

            const wsUrl = `${WEBSOCKET_SERVER_URL}/ws/client/${this.roomId}?name=${encodeURIComponent(playerName)}`;
            this._setupWebSocket(wsUrl);
        }

        broadcast(data) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify(data));
        }

        sendToHost(data) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify(data));
        }

        leaveRoom() {
            if (this.ws) {
                try { this.ws.close(); } catch (e) {}
                this.ws = null;
            }
            this.isHost = false;
            this.roomId = null;
            this.myPlayerId = null;
            this.dispatchEvent(new CustomEvent('roomLeft'));
        }

        _setupWebSocket(url) {
            try {
                this.ws = new WebSocket(url);
            } catch (err) {
                console.error("[WORKER_SERVICE] Failed to create WebSocket:", err);
                this.dispatchEvent(new CustomEvent('error', { detail: err }));
                return;
            }

            const connTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                    console.error("[WORKER_SERVICE] Connection timeout to Cloudflare Worker");
                    this.dispatchEvent(new CustomEvent('error', { detail: { message: "Connection timeout to Cloudflare Worker. Ensure worker is running or deployed." } }));
                    this.leaveRoom();
                }
            }, 8000);

            this.ws.onopen = () => {
                clearTimeout(connTimeout);
                console.log("[WORKER_SERVICE] Connected to Cloudflare Worker WebSocket.");
                if (this.isHost) {
                    this.myPlayerId = this.roomId;
                    this.dispatchEvent(new CustomEvent('roomCreated', {
                        detail: { roomId: this.roomId, playerId: this.myPlayerId, playerName: this.playerName }
                    }));
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === "joined") {
                        this.myPlayerId = message.playerId;
                        this.dispatchEvent(new CustomEvent('joinedRoom', {
                            detail: { roomId: this.roomId, playerId: this.myPlayerId, playerName: this.playerName }
                        }));
                        this.sendToHost({ type: 'join', name: this.playerName });
                        return;
                    }
                    if (message.type === "clientConnected") {
                        this.dispatchEvent(new CustomEvent('clientConnected', { detail: { peerId: message.peerId, name: message.name } }));
                        return;
                    }
                    if (message.type === "clientDisconnected") {
                        this.dispatchEvent(new CustomEvent('clientDisconnected', { detail: { peerId: message.peerId } }));
                        return;
                    }
                    if (message.type === "hostDisconnected") {
                        this.dispatchEvent(new CustomEvent('hostDisconnected'));
                        this.leaveRoom();
                        return;
                    }
                    if (this.isHost) {
                        if (message.sender && message.data) {
                            this.dispatchEvent(new CustomEvent('dataReceived', { detail: { sender: message.sender, data: message.data } }));
                        }
                    } else {
                        if (message.sender === "host" && message.data) {
                            this.dispatchEvent(new CustomEvent('dataReceived', { detail: { sender: "host", data: message.data } }));
                        }
                    }
                } catch (err) {
                    console.error("[WORKER_SERVICE] Failed to parse message:", err);
                }
            };

            this.ws.onclose = (event) => {
                clearTimeout(connTimeout);
                if (!this.isHost) {
                    this.dispatchEvent(new CustomEvent('hostDisconnected'));
                }
                this.leaveRoom();
            };

            this.ws.onerror = (err) => {
                clearTimeout(connTimeout);
                console.error("[WORKER_SERVICE] WebSocket error:", err);
                this.dispatchEvent(new CustomEvent('error', { detail: err }));
            };
        }

        _generateShortId() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let id = '';
            for (let i = 0; i < 5; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return id;
        }

        getPeerId() { return this.myPlayerId; }
        getIsHost() { return this.isHost; }
        getPlayerName() { return this.playerName; }
        getRoomId() { return this.roomId; }
    }

    window.PeerServiceWorker = PeerServiceWorker;
})();
