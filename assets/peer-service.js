// assets/peer-service.js
// This file encapsulates all WebSocket-based communication to the Cloudflare Worker.
// It maintains backward compatibility with the PeerJS interface.

const WEBSOCKET_SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? "ws://127.0.0.1:8787"
    : "wss://fer-geoguessr-multiplayer.aduskaaa.workers.dev";

class PeerService extends EventTarget {
    constructor() {
        super();
        this.ws = null;
        this.isHost = false;
        this.roomId = null;
        this.playerName = "Player";
        this.myPlayerId = null;
        this.connections = []; // Mocked array for compatibility
    }

    // Compatibility getter to check if socket/connection is open
    get peer() {
        return this.ws;
    }

    // Public method to initialize and create a room
    createRoom(playerName) {
        if (this.ws) return;
        this.playerName = playerName;
        this.isHost = true;
        this.roomId = this._generateShortId();

        const wsUrl = `${WEBSOCKET_SERVER_URL}/ws/host/${this.roomId}?name=${encodeURIComponent(playerName)}`;
        this._setupWebSocket(wsUrl);
    }

    // Public method to join an existing room
    joinRoom(playerName, roomId) {
        if (this.ws) return;
        this.playerName = playerName;
        this.isHost = false;
        this.roomId = roomId.toUpperCase();

        const wsUrl = `${WEBSOCKET_SERVER_URL}/ws/client/${this.roomId}?name=${encodeURIComponent(playerName)}`;
        this._setupWebSocket(wsUrl);
    }

    // Public method to leave the current room
    leaveRoom() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isHost = false;
        this.roomId = null;
        this.myPlayerId = null;
        this.connections = [];
        this.dispatchEvent(new CustomEvent('roomLeft'));
    }

    // Public method to send data to the host (client-only)
    sendToHost(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    // Public method to broadcast data to all connected clients (host-only)
    broadcast(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    // Private helper to generate a short room ID
    _generateShortId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Private helper to set up WebSocket connection
    _setupWebSocket(url) {
        console.log("[PEER_SERVICE] Connecting to WebSocket relay:", url);
        try {
            this.ws = new WebSocket(url);
        } catch (err) {
            console.error("[PEER_SERVICE] WebSocket initialization failed:", err);
            this.dispatchEvent(new CustomEvent('error', { detail: err }));
            return;
        }

        const connTimeout = setTimeout(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.error("[PEER_SERVICE] Connection timeout to relay.");
                this.dispatchEvent(new CustomEvent('error', { detail: { type: 'connection-timeout', message: 'Connection timeout.' } }));
                this.leaveRoom();
            }
        }, 12000);

        this.ws.onopen = () => {
            clearTimeout(connTimeout);
            console.log("[PEER_SERVICE] WebSocket connection open.");
            
            if (this.isHost) {
                this.myPlayerId = "host";
                this.dispatchEvent(new CustomEvent('roomCreated', { detail: { roomId: this.roomId, playerId: "host", playerName: this.playerName } }));
            } else {
                this.myPlayerId = "client_" + Math.random().toString(36).substr(2, 9);
                this.dispatchEvent(new CustomEvent('joinedRoom', { detail: { roomId: this.roomId, playerId: this.myPlayerId, playerName: this.playerName } }));
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                if (this.isHost) {
                    // Host system events from relay
                    if (message.type === "clientConnected") {
                        console.log("[PEER_SERVICE] Client connected:", message.peerId);
                        this.connections.push({ peer: message.peerId, open: true });
                        this.dispatchEvent(new CustomEvent('clientConnected', { detail: { peerId: message.peerId } }));
                        return;
                    }
                    if (message.type === "clientDisconnected") {
                        console.log("[PEER_SERVICE] Client disconnected:", message.peerId);
                        this.connections = this.connections.filter(c => c.peer !== message.peerId);
                        this.dispatchEvent(new CustomEvent('clientDisconnected', { detail: { peerId: message.peerId } }));
                        return;
                    }
                    
                    // Normal client data relayed to host
                    if (message.sender && message.data) {
                        this.dispatchEvent(new CustomEvent('dataReceived', { detail: { sender: message.sender, data: message.data } }));
                    }
                } else {
                    // Client system events from relay
                    if (message.type === "hostDisconnected") {
                        console.log("[PEER_SERVICE] Host disconnected.");
                        this.dispatchEvent(new CustomEvent('hostDisconnected'));
                        this.leaveRoom();
                        return;
                    }
                    
                    // Host data relayed to client
                    if (message.sender === "host" && message.data) {
                        this.dispatchEvent(new CustomEvent('dataReceived', { detail: { sender: "host", data: message.data } }));
                    }
                }
            } catch (err) {
                console.error("[PEER_SERVICE] Failed to parse WebSocket message:", err);
            }
        };

        this.ws.onclose = (event) => {
            clearTimeout(connTimeout);
            console.log("[PEER_SERVICE] WebSocket closed:", event);
            if (!this.isHost) {
                this.dispatchEvent(new CustomEvent('hostDisconnected'));
            }
            this.leaveRoom();
        };

        this.ws.onerror = (err) => {
            clearTimeout(connTimeout);
            console.error("[PEER_SERVICE] WebSocket error:", err);
            this.dispatchEvent(new CustomEvent('error', { detail: err }));
        };
    }

    getPeerId() {
        return this.myPlayerId;
    }

    getIsHost() {
        return this.isHost;
    }

    getPlayerName() {
        return this.playerName;
    }

    getRoomId() {
        return this.roomId;
    }
}

export const peerService = new PeerService();
