export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Enable CORS for all origins
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    if (url.pathname.startsWith("/ws/")) {
      // Path format: /ws/<role>/<room-id>
      // E.g. /ws/host/ABCDE?name=Player1 or /ws/client/ABCDE?name=Player2
      const parts = url.pathname.split("/");
      if (parts.length < 4) {
        return new Response("Invalid WebSocket path", { status: 400 });
      }
      const role = parts[2];
      const roomId = parts[3].toUpperCase();

      if (role !== "host" && role !== "client") {
        return new Response("Invalid role", { status: 400 });
      }

      // Fetch the Durable Object instance for the room
      const id = env.ROOMS.idFromName(roomId);
      const roomObject = env.ROOMS.get(id);

      // Forward the request to the Durable Object
      return roomObject.fetch(request);
    }

    return new Response("FER GeoGuessr Multiplayer Relay Server is running.", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};

// Durable Object class that manages the room and handles WebSockets
export class MultiplayerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.hostWs = null;
    this.clients = new Map(); // ws -> { id, name }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/");
    const role = parts[2];
    const playerName = url.searchParams.get("name") || "Player";

    // Upgrade the connection to a WebSocket connection
    const [clientWs, serverWs] = Object.values(new WebSocketPair());

    await this.handleSession(serverWs, role, playerName);

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  async handleSession(ws, role, name) {
    ws.accept();

    const id = crypto.randomUUID();

    if (role === "host") {
      if (this.hostWs) {
        // If a host already exists in this Durable Object instance, disconnect it
        try {
          this.hostWs.send(JSON.stringify({ type: "error", message: "Another host connected to this room." }));
          this.hostWs.close(1001, "Host replaced");
        } catch (e) {}
      }
      this.hostWs = ws;
      console.log(`Host connected to room.`);
    } else {
      this.clients.set(ws, { id, name });
      // Notify the host about the new client
      if (this.hostWs) {
        this.hostWs.send(JSON.stringify({
          type: "clientConnected",
          peerId: id,
          name: name
        }));
      }
    }

    ws.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data);

        if (role === "host") {
          // Host broadcasting or sending to a specific client
          if (data.target) {
            for (const [clientWs, client] of this.clients.entries()) {
              if (client.id === data.target) {
                clientWs.send(JSON.stringify({
                  sender: "host",
                  data: data.data
                }));
                break;
              }
            }
          } else {
            // Broadcast to all clients
            const messageStr = JSON.stringify({
              sender: "host",
              data: data
            });
            for (const clientWs of this.clients.keys()) {
              try {
                clientWs.send(messageStr);
              } catch (e) {
                this.removeClient(clientWs);
              }
            }
          }
        } else {
          // Client sending to host
          if (this.hostWs) {
            this.hostWs.send(JSON.stringify({
              sender: id,
              data: data
            }));
          }
        }
      } catch (e) {
        console.error("Error parsing/relaying WebSocket message:", e);
      }
    });

    const cleanup = () => {
      if (role === "host") {
        if (this.hostWs === ws) {
          this.hostWs = null;
          // Notify all clients that host has disconnected
          const messageStr = JSON.stringify({ type: "hostDisconnected" });
          for (const clientWs of this.clients.keys()) {
            try {
              clientWs.send(messageStr);
              clientWs.close(1001, "Host left");
            } catch (e) {}
          }
          this.clients.clear();
        }
      } else {
        this.removeClient(ws);
      }
    };

    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  removeClient(ws) {
    const client = this.clients.get(ws);
    if (client) {
      this.clients.delete(ws);
      if (this.hostWs) {
        this.hostWs.send(JSON.stringify({
          type: "clientDisconnected",
          peerId: client.id
        }));
      }
    }
  }
}
