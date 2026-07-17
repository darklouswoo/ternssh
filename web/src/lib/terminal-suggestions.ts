import type { Terminal } from "@xterm/xterm";

const STORAGE_KEY = "ternssh-terminal-history";
const MAX_HISTORY = 200;
const MAX_SUGGESTIONS = 8;

const COMMON_COMMANDS = [
  "ls",
  "cd",
  "pwd",
  "cat",
  "grep",
  "tail",
  "head",
  "chmod",
  "chown",
  "mkdir",
  "rm",
  "mv",
  "cp",
  "ps",
  "top",
  "htop",
  "df",
  "du",
  "free",
  "systemctl",
  "journalctl",
  "docker",
  "docker ps",
  "docker compose ps",
  "kubectl",
  "git status",
  "git pull",
  "npm install",
  "curl",
  "wget",
  "ssh",
  "scp",
  "tar",
  "zip",
  "unzip",
  "nano",
  "vim",
  "sudo",
  "su",
  "exit",
  "clear",
  "history",
];

type HistoryStore = Record<string, string[]>;

function readStore(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HistoryStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: HistoryStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getTerminalHistory(serverId: string): string[] {
  return readStore()[serverId] ?? [];
}

export function pushTerminalHistory(serverId: string, command: string): void {
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith(" ") || /[$#>❯➜λ]\s*$/.test(trimmed)) return;

  const store = readStore();
  const existing = store[serverId] ?? [];
  const next = [trimmed, ...existing.filter((item) => item !== trimmed)].slice(
    0,
    MAX_HISTORY,
  );
  store[serverId] = next;
  writeStore(store);
}

function readLineTextToCursor(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const row = buffer.getLine(buffer.baseY + buffer.cursorY);
  if (!row) return "";

  let text = "";
  for (let x = 0; x < buffer.cursorX; x++) {
    text += row.getCell(x)?.getChars() ?? "";
  }
  return text.replace(/\s+$/g, "");
}

function extractCommandTail(line: string): string {
  const markers = [
    "$ ",
    "# ",
    "% ",
    "> ",
    "❯ ",
    "➜ ",
    "λ ",
    "] ",
    "» ",
    "› ",
    "✗ ",
    "✔ ",
  ];
  let start = 0;
  for (const marker of markers) {
    const index = line.lastIndexOf(marker);
    if (index >= start) {
      start = index + marker.length;
    }
  }

  // Prompts like root@host:~# often omit the trailing space after $ or #.
  const endPrompt = line.match(/[$#%](?:\s*)?$/);
  if (endPrompt?.index !== undefined) {
    const cut = endPrompt.index + endPrompt[0].length;
    if (cut > start) {
      start = cut;
    }
  }

  return line.slice(start);
}

export function readTerminalPartialCommand(terminal: Terminal): string {
  return extractCommandTail(readLineTextToCursor(terminal));
}

function stripBracketedPaste(input: string): string {
  if (input.startsWith("\x1b[200~")) {
    return input.slice("\x1b[200~".length).replace(/\x1b\[201~[\s\S]*$/, "");
  }
  if (input.includes("\x1b[201~")) {
    return input.replace(/\x1b\[201~[\s\S]*$/, "");
  }
  return input;
}

/** Apply a single onData payload to the local input draft (echo may arrive later). */
export function applyInputToDraft(draft: string, input: string): string {
  const text = stripBracketedPaste(input);
  if (text.includes("\r") || text === "\n") return "";
  if (text === "\x7f" || text === "\x08") return draft.slice(0, -1);
  if (text === "\x15" || text === "\x03") return "";
  if (text.startsWith("\x1b") || text === "\t") return draft;
  if (/[\x00-\x1f\x7f]/.test(text)) return draft;
  return draft + text;
}

function splitPartial(partial: string): { head: string; token: string } {
  const trimmed = partial.trimEnd();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace < 0) {
    return { head: "", token: trimmed };
  }
  return {
    head: trimmed.slice(0, lastSpace + 1),
    token: trimmed.slice(lastSpace + 1),
  };
}

function getLastToken(partial: string): string {
  return splitPartial(partial).token;
}

function suggestionScore(partial: string, suggestion: string): number {
  const partialLower = partial.toLowerCase();
  const suggestionLower = suggestion.toLowerCase();
  if (suggestionLower.startsWith(partialLower)) {
    return 3;
  }

  const token = getLastToken(partial);
  if (!token) {
    return suggestionLower.includes(partialLower) ? 1 : 0;
  }

  const tokenLower = token.toLowerCase();
  const { head } = splitPartial(partial);
  const headLower = head.toLowerCase();

  if (head && suggestionLower.startsWith(headLower)) {
    const tail = suggestionLower.slice(headLower.length);
    if (tail.startsWith(tokenLower)) {
      return 2;
    }
  }

  if (suggestionLower.startsWith(tokenLower)) {
    return 2;
  }

  return 0;
}

export function findTerminalSuggestions(
  serverId: string,
  partial: string,
  extraCommands: string[] = [],
): string[] {
  const normalized = partial.trimStart();
  const pool = [
    ...new Set([
      ...getTerminalHistory(serverId),
      ...extraCommands,
      ...COMMON_COMMANDS,
    ]),
  ];

  if (!normalized) {
    return [];
  }

  return pool
    .map((item) => ({ item, score: suggestionScore(normalized, item) }))
    .filter(
      ({ score, item }) =>
        score > 0 && completionSuffix(normalized, item).length > 0,
    )
    .sort((left, right) => right.score - left.score || left.item.localeCompare(right.item))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ item }) => item);
}

function sharesPrefix(value: string, prefix: string): boolean {
  if (prefix.length > value.length) return false;
  return value.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

function limitCompletionSegment(text: string): string {
  let end = text.length;
  const slash = text.indexOf("/");
  const space = text.indexOf(" ");
  if (slash >= 0) end = Math.min(end, slash);
  if (space >= 0) end = Math.min(end, space);
  return text.slice(0, end);
}

export function completionSuffix(partial: string, suggestion: string): string {
  if (!suggestion) return "";

  if (sharesPrefix(suggestion, partial)) {
    const limitedSuggestion =
      suggestion.slice(0, partial.length) +
      limitCompletionSegment(suggestion.slice(partial.length));
    return limitedSuggestion.slice(partial.length);
  }

  const { head, token } = splitPartial(partial);
  if (!token) return "";

  if (head && sharesPrefix(suggestion, head)) {
    const tail = limitCompletionSegment(suggestion.slice(head.length));
    if (sharesPrefix(tail, token)) {
      return tail.slice(token.length);
    }
  }

  const limited = limitCompletionSegment(suggestion);
  if (sharesPrefix(limited, token)) {
    return limited.slice(token.length);
  }

  return "";
}

function completedTail(partial: string, suggestion: string): string {
  const { head, token } = splitPartial(partial);
  if (!token) return limitCompletionSegment(suggestion);

  if (head && sharesPrefix(suggestion, head)) {
    return limitCompletionSegment(suggestion.slice(head.length));
  }

  if (sharesPrefix(suggestion, token)) {
    return limitCompletionSegment(suggestion);
  }

  return limitCompletionSegment(suggestion);
}

/**
 * Build bytes to send for Tab completion. Prefer appending a suffix over
 * backspaces so network lag and shell readline state stay in sync.
 */
export function buildCompletionPayload(
  partial: string,
  suggestion: string,
): { payload: string; nextDraft: string } | null {
  if (!suggestion) return null;

  const partialTrimmed = partial.trimStart();

  if (sharesPrefix(suggestion, partialTrimmed)) {
    const limitedSuggestion =
      suggestion.slice(0, partialTrimmed.length) +
      limitCompletionSegment(suggestion.slice(partialTrimmed.length));
    const suffix = limitedSuggestion.slice(partialTrimmed.length);
    if (!suffix) return null;
    return {
      payload: suffix,
      nextDraft: partialTrimmed + suffix,
    };
  }

  const suffix = completionSuffix(partialTrimmed, suggestion);
  if (!suffix) return null;

  const { head, token } = splitPartial(partialTrimmed);
  const tail = completedTail(partialTrimmed, suggestion);

  if (sharesPrefix(tail, token)) {
    const appendSuffix = tail.slice(token.length);
    if (!appendSuffix) return null;
    return {
      payload: appendSuffix,
      nextDraft: head + tail,
    };
  }

  return {
    payload: "\x7f".repeat(token.length) + tail,
    nextDraft: head + tail,
  };
}
