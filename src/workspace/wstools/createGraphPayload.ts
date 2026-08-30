import { randomUUID } from "node:crypto";
import { GraphCanvasDTOSchema, type GraphCanvasDTO } from "@workspace/persistence/graphCanvasDto";

export type CreateGraphPayloadOptions = {
    /** Optional initial nodes to include */
    nodes?: GraphCanvasDTO["graph"]["nodes"];
    /** Optional initial relationships to include */
    relationships?: GraphCanvasDTO["graph"]["relationships"];
    /** Optional initial layout */
    layoutByNodeId?: GraphCanvasDTO["layout"]["layoutByNodeId"];
};

/**
 * Creates a new empty graph canvas payload.
 * @param options Optional initial state for nodes, relationships, and layout.
 * @returns A validated GraphCanvasDTO object.
 */
export function createGraphPayload(options: CreateGraphPayloadOptions = {}): GraphCanvasDTO {
    const {
        nodes = {},
        relationships = {},
        layoutByNodeId = {},
    } = options;

    const payload: GraphCanvasDTO = {
        schemaVersion: 1,
        type: "graph-canvas",
        graph: {
            nodes,
            relationships,
        },
        layout: {
            layoutByNodeId,
        },
        meta: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    };

    return GraphCanvasDTOSchema.parse(payload);
}

/**
 * Generates a unique node ID.
 */
export function generateNodeId(): string {
    return randomUUID();
}

/**
 * Generates a unique relationship ID.
 */
export function generateRelationshipId(): string {
    return `rel-${randomUUID()}`;
}
