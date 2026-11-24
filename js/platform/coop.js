// ==========================================
// FILE: coop.js
// ==========================================
// Main-process co-op link between two copies of the game. The host's game runs the shop; the
// friend's game sends its controls and draws what the host sends back (see js/coop/).
//
// Two ways to connect:
// - Steam: the host makes a friends-only lobby and invites through the Steam overlay. Accepting
//   the invite joins the lobby, and messages travel over Steam's peer-to-peer relay.
// - Direct: the host also listens on a local network port, so two copies on one PC (or one
//   network) can play without Steam. Used for testing.
//
// The renderer sees one message stream either way: text messages through `coop:message`, and
// connection changes through `coop:status`.
import net from "net";
import os from "os";

export const COOP_PORT = 27555;
const STEAM_LOBBY_FRIENDS_ONLY = 1;
const STEAM_SEND_RELIABLE = 2;
const STEAM_CALLBACK = Object.freeze({ LOBBY_CHAT_UPDATE: 5, P2P_SESSION_REQUEST: 6, GAME_LOBBY_JOIN_REQUESTED: 8 });
const STEAM_MEMBER_LEFT = new Set([1, 2, 3, 4]);
const STEAM_POLL_MS = 4;
// Steam's reliable packets top out at 1 MB, so long messages (pictures) go in pieces.
export const STEAM_CHUNK_BYTES = 512 * 1024;
const CHUNK_MORE = 1;
const CHUNK_LAST = 2;
// No message from the other game for this long ends the session.
const SILENCE_TIMEOUT_MS = 15000;

/**
 * Split a message into Steam packets: one flag byte (more to come / last piece), then text.
 * @param {string} text
 * @param {number} [chunkBytes]
 * @returns {Buffer[]}
 */
export function chunkMessage(text, chunkBytes = STEAM_CHUNK_BYTES) {
  const bytes = Buffer.from(text, "utf8");
  const packets = [];
  for (let start = 0; start < bytes.length || packets.length === 0; start += chunkBytes) {
    const piece = bytes.subarray(start, start + chunkBytes);
    const last = start + chunkBytes >= bytes.length;
    packets.push(Buffer.concat([Buffer.from([last ? CHUNK_LAST : CHUNK_MORE]), piece]));
  }
  return packets;
}

/** Reassembles packets from chunkMessage, in order. */
export class ChunkAssembler {
  constructor() {
    this.pieces = [];
  }

  /**
   * @param {Buffer} packet
   * @returns {string | null} the full message once its last piece arrives
   */
  push(packet) {
    this.pieces.push(packet.subarray(1));
    if (packet[0] !== CHUNK_LAST) return null;
    const text = Buffer.concat(this.pieces).toString("utf8");
    this.pieces = [];
    return text;
  }
}

/**
 * Direct connections frame each message as a 4-byte length, then the text.
 * @param {string} text
 */
export function frameMessage(text) {
  const body = Buffer.from(text, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} data
   * @returns {string[]} every message completed by this data
   */
  push(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) break;
      messages.push(this.buffer.subarray(4, 4 + length).toString("utf8"));
      this.buffer = this.buffer.subarray(4 + length);
    }
    return messages;
  }
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

/**
 * @param {object} options
 * @param {import("electron").IpcMain} options.ipcMain
 * @param {() => import("electron").BrowserWindow[]} options.getWindows
 * @param {any} [options.steam] - the steamworks.js client, when Steam is running
 */
export function installCoop({ ipcMain, getWindows, steam = null }) {
  const localName = steam?.localplayer.getName() ?? os.userInfo().username ?? "Player";
  /** @type {{ role: null | "host" | "friend", connected: boolean, peerName: string | null, via: null | "steam" | "direct", lobbyId: string | null, error: string | null }} */
  const status = { role: null, connected: false, peerName: null, via: null, lobbyId: null, error: null };
  let link = null;
  let tcpServer = null;
  let lobby = null;
  let lastHeard = 0;
  const steamAssemblers = new Map();

  const broadcast = (channel, payload) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  const publicStatus = () => ({
    ...status,
    localName,
    steam: Boolean(steam),
    addresses: status.role === "host" && tcpServer ? localAddresses().map((ip) => `${ip}:${COOP_PORT}`) : [],
  });
  const sendStatus = () => broadcast("coop:status", publicStatus());

  const receive = (text) => {
    lastHeard = Date.now();
    if (!status.connected) {
      status.connected = true;
      status.error = null;
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message?.t === "hello") {
      status.peerName = String(message.name ?? "Friend").slice(0, 40);
      sendStatus();
      // The friend introduces itself first; the host answers so the friend learns its name.
      if (status.role === "host") link?.send(JSON.stringify({ t: "hello", name: localName }));
      return;
    }
    if (message?.t === "bye") {
      endLink("left");
      return;
    }
    broadcast("coop:message", text);
  };

  // The other game went away; the host keeps hosting, the friend's session is over.
  const endLink = (reason) => {
    const hadLink = Boolean(link);
    link?.close();
    link = null;
    status.connected = false;
    status.peerName = null;
    status.error = hadLink ? reason : status.error;
    if (status.role === "friend") stopAll(reason);
    else sendStatus();
  };

  const stopAll = (reason = null) => {
    link?.close();
    link = null;
    tcpServer?.close();
    tcpServer = null;
    try {
      lobby?.leave();
    } catch (error) {
      console.error("Could not leave the Steam lobby:", error);
    }
    lobby = null;
    steamAssemblers.clear();
    Object.assign(status, { role: null, connected: false, peerName: null, via: null, lobbyId: null, error: reason });
    sendStatus();
  };

  // --- Direct connections ---

  const socketLink = (socket) => {
    const reader = new FrameReader();
    socket.setNoDelay(true);
    socket.on("data", (data) => reader.push(data).forEach(receive));
    const thisLink = {
      send: (text) => {
        if (!socket.destroyed) socket.write(frameMessage(text));
      },
      close: () => socket.destroy(),
    };
    socket.on("close", () => {
      if (link === thisLink) endLink("lost");
    });
    socket.on("error", (error) => console.error("Co-op connection error:", error.message));
    return thisLink;
  };

  const listenDirect = () => new Promise((resolve) => {
    const server = net.createServer((socket) => {
      if (link) {
        socket.destroy();
        return;
      }
      status.via = "direct";
      link = socketLink(socket);
    });
    server.once("error", (error) => {
      console.error("Co-op direct port unavailable:", error.message);
      resolve(null);
    });
    server.listen(COOP_PORT, () => resolve(server));
  });

  const joinDirect = (address) => new Promise((resolve, reject) => {
    const [host, port] = String(address).trim().split(":");
    if (!host) {
      reject(new Error("Type your friend's address first."));
      return;
    }
    stopAll();
    const socket = net.connect({ host, port: Number(port) || COOP_PORT });
    const timer = setTimeout(() => socket.destroy(new Error("No game answered at that address.")), 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      Object.assign(status, { role: "friend", via: "direct", error: null });
      link = socketLink(socket);
      lastHeard = Date.now();
      link.send(JSON.stringify({ t: "hello", name: localName }));
      sendStatus();
      resolve(publicStatus());
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.message.includes("ECONNREFUSED") ? "No game answered at that address." : error.message));
    });
  });

  // --- Steam ---

  const steamLink = (steamId64) => ({
    send: (text) => {
      for (const packet of chunkMessage(text)) {
        steam.networking.sendP2PPacket(steamId64, STEAM_SEND_RELIABLE, packet);
      }
    },
    close: () => {},
    steamId64,
  });

  if (steam) {
    steam.callback.register(STEAM_CALLBACK.P2P_SESSION_REQUEST, ({ remote }) => {
      if (status.role === "host" && (!link || link.steamId64 === remote)) steam.networking.acceptP2PSession(remote);
    });
    steam.callback.register(STEAM_CALLBACK.LOBBY_CHAT_UPDATE, ({ lobby: lobbyId, user_changed: user, member_state_change: change }) => {
      if (!lobby || lobby.id !== lobbyId || !STEAM_MEMBER_LEFT.has(change)) return;
      if (link?.steamId64 === user) endLink("left");
    });
    steam.callback.register(STEAM_CALLBACK.GAME_LOBBY_JOIN_REQUESTED, ({ lobby_steam_id: lobbyId }) => {
      void joinSteamLobby(lobbyId).catch((error) => {
        console.error("Could not join the Steam lobby:", error);
        stopAll("join-failed");
      });
    });
    setInterval(() => {
      let size = steam.networking.isP2PPacketAvailable();
      while (size > 0) {
        const packet = steam.networking.readP2PPacket(size);
        const sender = packet.steamId.steamId64;
        if (status.role === "host" && !link) {
          status.via = "steam";
          link = steamLink(sender);
        }
        if (link?.steamId64 === sender) {
          if (!steamAssemblers.has(sender)) steamAssemblers.set(sender, new ChunkAssembler());
          const text = steamAssemblers.get(sender).push(packet.data);
          if (text !== null) receive(text);
        }
        size = steam.networking.isP2PPacketAvailable();
      }
    }, STEAM_POLL_MS).unref();
  }

  const joinSteamLobby = async (lobbyId) => {
    stopAll();
    lobby = await steam.matchmaking.joinLobby(lobbyId);
    const owner = lobby.getOwner().steamId64;
    Object.assign(status, { role: "friend", via: "steam", lobbyId: String(lobby.id), error: null });
    link = steamLink(owner);
    lastHeard = Date.now();
    link.send(JSON.stringify({ t: "hello", name: localName }));
    sendStatus();
  };

  setInterval(() => {
    if (link && status.connected && Date.now() - lastHeard > SILENCE_TIMEOUT_MS) endLink("lost");
    else if (link && !status.connected && status.role === "friend" && Date.now() - lastHeard > SILENCE_TIMEOUT_MS) {
      stopAll("no-answer");
    }
  }, 1000).unref();

  // --- Renderer requests ---

  ipcMain.handle("coop:status", () => publicStatus());
  ipcMain.handle("coop:host", async () => {
    if (status.role === "host") return publicStatus();
    stopAll();
    status.role = "host";
    tcpServer = await listenDirect();
    if (steam) {
      try {
        lobby = await steam.matchmaking.createLobby(STEAM_LOBBY_FRIENDS_ONLY, 2);
        status.lobbyId = String(lobby.id);
      } catch (error) {
        console.error("Could not create a Steam lobby:", error);
      }
    }
    sendStatus();
    return publicStatus();
  });
  ipcMain.handle("coop:invite", () => {
    if (!steam || !lobby) return false;
    steam.overlay.activateInviteDialog(lobby.id);
    return true;
  });
  ipcMain.handle("coop:join-address", (_event, address) => joinDirect(address));
  ipcMain.handle("coop:leave", () => {
    link?.send(JSON.stringify({ t: "bye" }));
    stopAll();
    return true;
  });
  ipcMain.on("coop:send", (_event, text) => {
    if (typeof text === "string") link?.send(text);
  });

  return {
    status: publicStatus,
    shutdown: () => {
      link?.send(JSON.stringify({ t: "bye" }));
      stopAll();
    },
  };
}
