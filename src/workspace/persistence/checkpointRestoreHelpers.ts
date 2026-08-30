import type {
  InstanceType,
  WorkspaceCommandLogEntry,
} from "@shared/checkpoints/types";
import type { Command, EditorCommand } from "@shared/commands";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "@shared/constants";
import {
  canonicalizeGraphCanvasDTO,
  type GraphCanvasDTO,
} from "./graphCanvasDto";
import { applyEditorCommands } from "../editor/utils/editorCommandReducer";

export function selectWorkspaceCommands(
  entries: WorkspaceCommandLogEntry[],
  snapshotSeq: number,
  targetSeq: number,
): WorkspaceCommandLogEntry[] {
  return entries.filter(
    (entry) => entry.cursor.seq > snapshotSeq && entry.cursor.seq <= targetSeq,
  );
}

export function applyWorkspaceCommands(
  payload: unknown,
  instanceType: InstanceType,
  entries: WorkspaceCommandLogEntry[],
): unknown {
  if (entries.length === 0) return payload;

  if (instanceType === "graph-canvas") {
    return applyCanvasCommands(payload, entries.map((entry) => entry.command as Command));
  }

  if (instanceType === "document") {
    const base = normalizeDocumentPayload(payload);
    return applyEditorCommands(base, entries.map((entry) => entry.command as EditorCommand));
  }

  return payload;
}

function normalizeDocumentPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "blocks" in (payload as any)) {
    return payload as any;
  }
  return { blocks: [{ id: "initial-paragraph", type: "paragraph", content: "" }] } as any;
}

function applyCanvasCommands(payload: unknown, commands: Command[]): GraphCanvasDTO {
  const base = normalizeCanvasPayload(payload);
  const next = cloneCanvasPayload(base);

  for (const command of commands) {
    applyCanvasCommand(next, command);
  }

  return canonicalizeGraphCanvasDTO(next);
}

function normalizeCanvasPayload(payload: unknown): GraphCanvasDTO {
  if (
    payload &&
    typeof payload === "object" &&
    "type" in (payload as any) &&
    (payload as any).type === "graph-canvas"
  ) {
    return canonicalizeGraphCanvasDTO(payload);
  }

  return {
    schemaVersion: 1,
    type: "graph-canvas",
    graph: { nodes: {}, relationships: {} },
    layout: { layoutByNodeId: {} },
    meta: {},
  } as GraphCanvasDTO;
}

function cloneCanvasPayload(payload: GraphCanvasDTO): GraphCanvasDTO {
  if (typeof structuredClone === "function") {
    return structuredClone(payload) as GraphCanvasDTO;
  }
  return JSON.parse(JSON.stringify(payload)) as GraphCanvasDTO;
}

function applyCanvasCommand(payload: GraphCanvasDTO, command: Command): void {
  switch (command.type) {
    case "graph:add_node":
      payload.graph.nodes[command.nodeId] = {
        id: command.nodeId,
        type: command.entity.type || "card",
        name: command.entity.name,
        attrs: command.entity.attrs || {},
      } as any;
      payload.layout.layoutByNodeId[command.nodeId] = {
        x: command.position.x,
        y: command.position.y,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      } as any;
      break;
    case "graph:update_node":
      if (payload.graph.nodes[command.nodeId]) {
        Object.assign(payload.graph.nodes[command.nodeId], command.changes);
      }
      break;
    case "graph:update_node_layout":
      if (!payload.layout.layoutByNodeId[command.nodeId]) {
        payload.layout.layoutByNodeId[command.nodeId] = {
          x: 0,
          y: 0,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
        } as any;
      }
      Object.assign(payload.layout.layoutByNodeId[command.nodeId], command.layout);
      break;
    case "graph:remove_node":
      delete payload.graph.nodes[command.nodeId];
      delete payload.layout.layoutByNodeId[command.nodeId];
      break;
    case "graph:add_relationship":
      payload.graph.relationships[command.relationshipId] = command.relationship as any;
      break;
    case "graph:update_relationship":
      if (payload.graph.relationships[command.relationshipId]) {
        const rel = payload.graph.relationships[command.relationshipId] as any;
        Object.assign(rel, command.changes);
      }
      break;
    case "graph:remove_relationship":
      delete payload.graph.relationships[command.relationshipId];
      break;
    default:
      break;
  }
}
