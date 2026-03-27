// assets/peer-service.js
// This file will encapsulate all PeerJS related logic.
class PeerService extends EventTarget {
    constructor() {
        super();
        this.peer = null;
        this.conn = null; // For client connection to host
        this.connections = []; // For host to connected clients
        this.isHost = false;
        this.roomId = null;
        this.playerName = "Player";
        this.heartbeatInterval = null;
    }

    // Public method to initialize PeerJS and create a room
    createRoom(playerName) {
        if (this.peer) return;
        this.playerName = playerName;
        this.isHost = true;

        const attemptCreate = (id) => {
            this._setupPeer(id, (myId) => {
                this.roomId = myId;
                this.dispatchEvent(new CustomEvent('roomCreated', { detail: { roomId: myId, playerId: myId, playerName: this.playerName } }));
            }, (err) => {
                if (err.type === 'unavailable-id') {
                    attemptCreate(this._generateShortId());
                } else {
                    console.error("Peer Error:", err);
                    this.dispatchEvent(new CustomEvent('error', { detail: err }));
                }
            });
        };
        attemptCreate(this._generateShortId());
    }

    // Public method to join a room
    joinRoom(playerName, roomId) {
        if (this.peer) return;
        this.playerName = playerName;
        this.isHost = false;
        this.roomId = roomId;

        this._setupPeer(null, (myId) => {
            console.log("[PEER_SERVICE] My client ID is:", myId);
            console.log("[PEER_SERVICE] Attempting to connect to host:", this.roomId);
            
            this.conn = this.peer.connect(this.roomId);
            this._setupConnection(this.conn);
            
            // Connection Timeout for Join
            const connTimeout = setTimeout(() => {
                if (!this.conn || !this.conn.open) {
                    console.error("[PEER_SERVICE] Connection timeout to host:", this.roomId);
                    this.dispatchEvent(new CustomEvent('error', { detail: { type: 'connection-timeout', message: 'Could not connect to room.' } }));
                }
            }, 12000);

            this.conn.on('open', () => {
                clearTimeout(connTimeout);
                console.log("[PEER_SERVICE] Connected to host successfully.");
                this.dispatchEvent(new CustomEvent('joinedRoom', { detail: { roomId: this.roomId, playerId: myId, playerName: this.playerName } }));
                this.sendToHost({ type: 'join', name: this.playerName });
            });

            this.conn.on('error', (err) => {
                clearTimeout(connTimeout);
                console.error("[PEER_SERVICE] Connection error:", err);
                this.dispatchEvent(new CustomEvent('error', { detail: err }));
            });
        }, (err) => {
            console.error("[PEER_SERVICE] Peer setup error:", err);
            this.dispatchEvent(new CustomEvent('error', { detail: err }));
        });
    }

    // Public method to leave the current connection/room
    leaveRoom() {
        if (this.peer) {
            this.peer.disconnect();
            this.peer.destroy();
            this.peer = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        this.connections = [];
        this.conn = null;
        this.isHost = false;
        this.roomId = null;
        this.dispatchEvent(new CustomEvent('roomLeft'));
    }

    // Public method to send data to the host (client-only)
    sendToHost(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    // Public method to broadcast data to all connected clients (host-only)
    broadcast(data) {
        this.connections.forEach(c => {
            if (c.open) c.send(data);
        });
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

    // Private helper to set up PeerJS instance
    _setupPeer(id, onReady, onError) {
        const options = { debug: 2, secure: true };
        try {
            this.peer = id ? new Peer(id, options) : new Peer(options);
        } catch (e) {
            console.error("[PEER_SERVICE] PeerJS Constructor Error:", e);
            this.peer = new Peer({ debug: 2 });
        }
        
        this.peer.on('open', (myId) => {
            console.log("[PEER_SERVICE] Peer object opened. ID:", myId);
            onReady(myId);
        });
        
        this.peer.on('connection', (conn) => { 
            if (this.isHost) {
                console.log("[PEER_SERVICE] Host received connection request from:", conn.peer);
                this._setupConnection(conn); 
            }
        });

        this.peer.on('error', (err) => {
            console.error("[PEER_SERVICE] Global Peer Error:", err.type, err);
            onError(err);
        });

        this.peer.on('disconnected', () => {
            console.log("[PEER_SERVICE] Peer disconnected.");
            this.dispatchEvent(new CustomEvent('peerDisconnected'));
        });

        this.peer.on('close', () => {
            console.log("[PEER_SERVICE] Peer closed.");
            this.dispatchEvent(new CustomEvent('peerClosed'));
        });

        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.isHost) {
                this.broadcast({ type: 'heartbeat' });
            } else if (this.conn && this.conn.open) {
                this.sendToHost({ type: 'heartbeat' });
            }
        }, 3000);
    }

    // Private helper to set up a DataConnection
    _setupConnection(conn) {
        console.log("[PEER_SERVICE] Initializing connection handshake for:", conn.peer);
        
        const handshakeTimeout = setTimeout(() => {
            if (!conn.open) {
                console.warn("[PEER_SERVICE] Handshake timeout for:", conn.peer, ". Closing stale connection.");
                conn.close();
            }
        }, 25000);

        conn.on('open', () => {
            clearTimeout(handshakeTimeout);
            console.log("[PEER_SERVICE] Data channel successfully OPEN with:", conn.peer);
            if (this.isHost) {
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                this.connections.push(conn);
                this.dispatchEvent(new CustomEvent('clientConnected', { detail: { peerId: conn.peer } }));
            }
            // The actual gameState or join message is sent after this event is dispatched and handled by main logic
        });

        conn.on('data', (data) => {
            if (data.type !== 'heartbeat') console.log("[PEER_SERVICE] Data from", conn.peer, ":", data.type);
            this.dispatchEvent(new CustomEvent('dataReceived', { detail: { sender: conn.peer, data: data } }));
        });

        conn.on('close', () => {
            console.log("[PEER_SERVICE] Connection CLOSED with:", conn.peer);
            if (this.isHost) {
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                this.dispatchEvent(new CustomEvent('clientDisconnected', { detail: { peerId: conn.peer } }));
            } else {
                this.dispatchEvent(new CustomEvent('hostDisconnected'));
            }
        });

        conn.on('error', (err) => {
            console.error("[PEER_SERVICE] Connection-level error with:", conn.peer, err);
            this.dispatchEvent(new CustomEvent('connectionError', { detail: { peerId: conn.peer, error: err } }));
            conn.close();
        });
    }

    // Getters for current state
    getPeerId() {
        return this.peer ? this.peer.id : null;
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

// Export a singleton instance
export const peerService = new PeerService();
