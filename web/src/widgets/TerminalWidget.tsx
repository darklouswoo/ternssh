import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { TerminalWidgetProps } from "./types";
import "@xterm/xterm/css/xterm.css";

function decodeWsPayload(data: string | Blob | ArrayBuffer): string | Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function parseControlMessage(data: string): {
  kind: "ignore" | "error" | "ready";
  message?: string;
} | null {
  if (!data.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(data) as { type?: string; message?: string };
    if (parsed.type === "error") {
      return { kind: "error", message: parsed.message ?? "连接失败" };
    }
    if (
      parsed.type === "status" &&
      (parsed.message?.includes("Shell 已就绪") ||
        parsed.message?.includes("认证成功"))
    ) {
      return { kind: "ready" };
    }
    return { kind: "ignore" };
  } catch {
    return null;
  }
}

export function TerminalWidget({
  sessionWsUrl,
  context,
  onStatusChange,
}: TerminalWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#f5f5f5",
        cursor: "#72d4a8",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const ws = wsRef.current;
      const term = terminalRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!sessionWsUrl) {
      setStatus("idle");
      setError(null);
      wsRef.current?.close();
      wsRef.current = null;
      terminal?.clear();
      return;
    }
    if (!terminal) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${sessionWsUrl}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    setStatus("connecting");
    setError(null);
    terminal.reset();
    terminal.writeln("正在连接 SSH 会话...");

    const sendResize = () => {
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fitAddon || !term) return;
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      }
    };

    ws.onopen = () => {
      setStatus("open");
      sendResize();
    };

    ws.onclose = () => {
      setStatus("closed");
      terminal.writeln("\r\n会话已断开。");
    };

    ws.onerror = () => {
      setStatus("closed");
      setError("WebSocket 连接失败");
      terminal.writeln("\r\nWebSocket 连接失败。");
    };

    let ready = false;
    ws.onmessage = (event) => {
      void (async () => {
        const data = await decodeWsPayload(event.data);
        const control = parseControlMessage(data);
        if (control) {
          if (control.kind === "error") {
            setError(control.message ?? "连接失败");
            terminal.writeln(`\r\n${control.message ?? "连接失败"}`);
            return;
          }
          if (control.kind === "ready" && !ready) {
            ready = true;
            terminal.reset();
            sendResize();
            return;
          }
          return;
        }
        terminal.write(data);
      })();
    };

    const onData = terminal.onData((input) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(input);
      }
    });

    return () => {
      onData.dispose();
      ws.close();
      wsRef.current = null;
    };
  }, [sessionWsUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      {!context.selectedServerId && !sessionWsUrl && (
        <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">
          选择服务器并点击连接以打开会话。
        </p>
      )}
      {error && (
        <p className="mb-2 text-sm text-red-400">{error}</p>
      )}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden bg-[#0a0a0a] p-1"
      />
    </div>
  );
}
