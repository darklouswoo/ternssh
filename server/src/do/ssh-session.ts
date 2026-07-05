import { DurableObject } from "cloudflare:workers";
import { getCredentialValue, getServer } from "../db/servers";
import { SSHSession } from "../ssh/session";
import type { SSHConnectionConfig } from "../ssh/types";

interface SessionRow {
  id: string;
  user_id: string;
  server_id: string;
  status: string;
}

export class SshSession extends DurableObject<Env> {
  private sessions = new Map<WebSocket, SSHSession>();

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const sessionId = parseSessionId(request.url);
    if (!sessionId) {
      return new Response("Invalid session URL", { status: 400 });
    }

    const session = await this.env.DB.prepare(
      "SELECT id, user_id, server_id, status FROM sessions WHERE id = ?",
    )
      .bind(sessionId)
      .first<SessionRow>();

    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const server = await getServer(this.env.DB, session.user_id, session.server_id);
    if (!server) {
      return new Response("Server not found", { status: 404 });
    }

    const credential = await getCredentialValue(
      this.env.DB,
      session.user_id,
      server.credential_ref,
    );
    if (!credential) {
      return new Response("Credential not found", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, serverWs] = Object.values(pair);
    this.ctx.acceptWebSocket(serverWs);

    const config: SSHConnectionConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.auth_type === "password" ? credential : "",
      authMethod: server.auth_type === "private_key" ? "publickey" : "password",
      privateKey: server.auth_type === "private_key" ? credential : undefined,
      cols: 120,
      rows: 40,
    };

    queueMicrotask(() => {
      void this.startSession(serverWs, config);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const session = this.sessions.get(ws);
    if (session) {
      await session.handleWebSocketMessage(message);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    const session = this.sessions.get(ws);
    session?.close();
    this.sessions.delete(ws);
  }

  private async startSession(
    ws: WebSocket,
    config: SSHConnectionConfig,
  ): Promise<void> {
    try {
      const { connect } = await import("cloudflare:sockets");
      const hostname = config.host.includes(":")
        ? `[${config.host}]`
        : config.host;
      const socket = connect({ hostname, port: config.port });
      await socket.opened;

      const session = new SSHSession(ws, socket, config, false, false);
      this.sessions.set(ws, session);
      await session.startHandshake();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "SSH connection failed";
      try {
        ws.send(JSON.stringify({ type: "error", message: `连接失败: ${message}` }));
        ws.close(1011, message);
      } catch {
        // ignore
      }
    }
  }
}

function parseSessionId(url: string): string | null {
  const match = new URL(url).pathname.match(/\/sessions\/([^/]+)\/ws$/);
  return match?.[1] ?? null;
}
