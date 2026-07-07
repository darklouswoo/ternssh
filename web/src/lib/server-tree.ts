import type { TreeNode } from "@/lib/api";

export interface VisibleTreeRow {
  node: TreeNode;
  depth: number;
  parentId: string | null;
  index: number;
}

export function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  parentId: string | null = null,
  depth = 0,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  nodes.forEach((node, index) => {
    rows.push({ node, depth, parentId, index });

    if (node.type === "group" && expanded.has(node.id)) {
      rows.push(...flattenTree(node.children, expanded, node.id, depth + 1));
    }
  });

  return rows;
}

export function nodeMatchesSearchQuery(node: TreeNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (node.type === "group") {
    return node.name.toLowerCase().includes(q);
  }

  const endpoint = `${node.username}@${node.host}:${node.port}`.toLowerCase();
  return (
    node.name.toLowerCase().includes(q) ||
    node.host.toLowerCase().includes(q) ||
    node.username.toLowerCase().includes(q) ||
    endpoint.includes(q) ||
    String(node.port).includes(q)
  );
}

export function filterTreeBySearch(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const filter = (items: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];

    for (const node of items) {
      if (node.type === "group") {
        if (nodeMatchesSearchQuery(node, q)) {
          result.push(node);
          continue;
        }

        const children = filter(node.children);
        if (children.length > 0) {
          result.push({ ...node, children });
        }
      } else if (nodeMatchesSearchQuery(node, q)) {
        result.push(node);
      }
    }

    return result;
  };

  return filter(nodes);
}

export function findServerInTree(
  nodes: TreeNode[],
  serverId: string,
): Extract<TreeNode, { type: "server" }> | null {
  for (const node of nodes) {
    if (node.type === "server" && node.id === serverId) {
      return node;
    }
    if (node.type === "group") {
      const found = findServerInTree(node.children, serverId);
      if (found) return found;
    }
  }
  return null;
}

export function countTreeNodes(nodes: TreeNode[]): {
  servers: number;
  groups: number;
} {
  let servers = 0;
  let groups = 0;

  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.type === "server") servers += 1;
      else {
        groups += 1;
        walk(item.children);
      }
    }
  };

  walk(nodes);
  return { servers, groups };
}

export function countGroupChildren(nodes: TreeNode[], groupId: string): number {
  const walk = (items: TreeNode[]): number | null => {
    for (const item of items) {
      if (item.type === "group") {
        if (item.id === groupId) return item.children.length;
        const nested = walk(item.children);
        if (nested !== null) return nested;
      }
    }
    return null;
  };

  return walk(nodes) ?? 0;
}

export function collectAllGroupIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.type === "group") {
        ids.push(item.id);
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

export function collectAncestorGroupIds(
  nodes: TreeNode[],
  targetId: string,
  targetType: "server" | "group",
): string[] {
  const path: string[] = [];

  const walk = (items: TreeNode[], ancestors: string[]): boolean => {
    for (const item of items) {
      if (item.type === "group") {
        const next = [...ancestors, item.id];
        if (targetType === "group" && item.id === targetId) {
          path.push(...ancestors);
          return true;
        }
        if (walk(item.children, next)) return true;
      } else if (targetType === "server" && item.id === targetId) {
        path.push(...ancestors);
        return true;
      }
    }
    return false;
  };

  walk(nodes, []);
  return path;
}

export function isGroupDescendant(
  nodes: TreeNode[],
  groupId: string,
  maybeAncestorId: string,
): boolean {
  const walk = (items: TreeNode[], inside: boolean): boolean => {
    for (const item of items) {
      if (item.type !== "group") continue;
      const nextInside = inside || item.id === maybeAncestorId;
      if (nextInside && item.id === groupId) return true;
      if (walk(item.children, nextInside)) return true;
    }
    return false;
  };

  return walk(nodes, false);
}

export function findTreeItemLocation(
  nodes: TreeNode[],
  item: DragItem,
  parentId: string | null = null,
): { parentId: string | null; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === item.type && node.id === item.id) {
      return { parentId, index };
    }
    if (node.type === "group") {
      const nested = findTreeItemLocation(node.children, item, node.id);
      if (nested) return nested;
    }
  }
  return null;
}

export function resolveMoveIndex(
  tree: TreeNode[],
  item: DragItem,
  parentId: string | null,
  targetIndex: number,
): number {
  const location = findTreeItemLocation(tree, item);
  if (
    location &&
    location.parentId === parentId &&
    location.index < targetIndex
  ) {
    return targetIndex - 1;
  }
  return targetIndex;
}

export type DragItem = { type: "server" | "group"; id: string };

export type DropIntent =
  | { kind: "before"; parentId: string | null; index: number }
  | { kind: "into"; groupId: string };

export const DRAG_MIME = "application/x-ternssh-tree-item";

export function readDragItem(dataTransfer: DataTransfer): DragItem | null {
  for (const mime of [DRAG_MIME, "text/plain"]) {
    const raw = dataTransfer.getData(mime);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as DragItem;
      if (
        (parsed.type === "server" || parsed.type === "group") &&
        typeof parsed.id === "string"
      ) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function writeDragItem(dataTransfer: DataTransfer, item: DragItem) {
  const payload = JSON.stringify(item);
  dataTransfer.setData(DRAG_MIME, payload);
  dataTransfer.setData("text/plain", payload);
  dataTransfer.effectAllowed = "move";
}
