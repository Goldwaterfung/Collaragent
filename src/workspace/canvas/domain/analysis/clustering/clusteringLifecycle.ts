import { serializeCanvas } from '@workspace/persistence/canvasSerialization'
import type { GraphCanvasDTO, NodeLayout } from '@workspace/persistence/graphCanvasDto'
import type { CanvasState, ClusteringProgress } from '@workspace/canvas/types'
import { runHierarchicalLeidenOnDtoInWorker } from './leiden/workerClient'
import { computeClusterAutoLayout } from './clusterLayout'
import type { NodeSpec, EdgeSpec } from '@workspace/wstools/graphSchemaConverter'
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

export type ClusteringMode = 'rearrange' | 'cluster-only'

export interface RunCanvasClusteringOptions {
  state: CanvasState
  mode: ClusteringMode
  signal?: AbortSignal
  onProgress?: (progress: ClusteringProgress) => void
}

export interface CanvasClusteringResult {
  clusterAttrsByNodeId: Record<
    string,
    {
      clusterId?: string
      clusterPath?: string[]
      clusterRunId?: string
      clusterParams?: unknown
    }
  >
  layoutByNodeId?: Record<string, NodeLayout>
  dto: GraphCanvasDTO
}

/**
 * Runs Leiden community detection on the current canvas state, optionally applying
 * two-tier hierarchical auto-layout to neatly separate and arrange detected clusters.
 */
export async function runCanvasClustering(
  options: RunCanvasClusteringOptions
): Promise<CanvasClusteringResult> {
  const { state, mode, signal, onProgress } = options

  if (signal?.aborted) {
    throw new WorkspaceError(WorkspaceErrorCode.WORKSPACE_CLUSTER_ABORTED, 'Clustering aborted')
  }

  const nodes = Object.values(state.domain.graph.nodesById)
  if (nodes.length === 0) {
    const emptyDto = serializeCanvas(state)
    return {
      clusterAttrsByNodeId: {},
      layoutByNodeId: undefined,
      dto: emptyDto
    }
  }

  onProgress?.({
    running: true,
    stage: 'clone',
    message: 'Preparing graph snapshot...'
  })

  const baseDto = serializeCanvas(state)
  const snapshotDto = structuredClone(baseDto)

  let dto: GraphCanvasDTO
  try {
    const workerResult = await runHierarchicalLeidenOnDtoInWorker(
      snapshotDto,
      { signedMode: 'penalty' },
      {
        signal,
        onProgress: (ev) => {
          onProgress?.({
            running: true,
            stage: ev.stage,
            level: 'level' in ev ? ev.level : undefined,
            levelsDone: 'levelsDone' in ev ? ev.levelsDone : undefined
          })
        }
      }
    )
    dto = workerResult.dto
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_CLUSTER_ABORTED,
        'Clustering aborted',
        undefined,
        err instanceof Error ? err : new Error(String(err))
      )
    }
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_CLUSTER_EXECUTION_FAILED,
      `Leiden clustering worker execution failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err instanceof Error ? err : new Error(String(err))
    )
  }

  if (signal?.aborted) {
    throw new WorkspaceError(WorkspaceErrorCode.WORKSPACE_CLUSTER_ABORTED, 'Clustering aborted')
  }

  if (mode === 'rearrange') {
    onProgress?.({
      running: true,
      stage: 'layout',
      message: 'Computing hierarchical cluster layout...'
    })

    const nodeSpecs: NodeSpec[] = Object.values(dto.graph.nodes).map((n) => {
      const layout = dto.layout.layoutByNodeId[n.id]
      const clusterId = typeof n.attrs?.clusterId === 'string' ? n.attrs.clusterId : undefined
      return {
        entity: n.id,
        name: n.name,
        width: layout?.width ?? DEFAULT_NODE_WIDTH,
        height: layout?.height ?? DEFAULT_NODE_HEIGHT,
        group: clusterId,
        attrs: n.attrs
      }
    })

    const edgeSpecs: EdgeSpec[] = Object.values(dto.graph.relationships).map((r) => ({
      from: r.from.nodeId,
      to: r.to.nodeId,
      label: typeof r.attrs?.label === 'string' ? r.attrs.label : undefined
    }))

    try {
      const layoutResult = computeClusterAutoLayout(nodeSpecs, edgeSpecs)
      dto.layout.layoutByNodeId = layoutResult.layoutByNodeId
    } catch (err: unknown) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_LAYOUT_COMPUTATION_FAILED,
        `Hierarchical cluster layout calculation failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err instanceof Error ? err : new Error(String(err))
      )
    }
  } else {
    // In cluster-only mode, retain the original node layout coordinates
    dto.layout.layoutByNodeId = baseDto.layout.layoutByNodeId
  }

  const clusterAttrsByNodeId: Record<
    string,
    {
      clusterId?: string
      clusterPath?: string[]
      clusterRunId?: string
      clusterParams?: unknown
    }
  > = {}

  for (const [id, node] of Object.entries(dto.graph.nodes)) {
    const attrs = node.attrs as Record<string, unknown> | undefined
    clusterAttrsByNodeId[id] = {
      clusterId: typeof attrs?.clusterId === 'string' ? attrs.clusterId : undefined,
      clusterPath: Array.isArray(attrs?.clusterPath) ? (attrs.clusterPath as string[]) : undefined,
      clusterRunId: typeof attrs?.clusterRunId === 'string' ? attrs.clusterRunId : undefined,
      clusterParams: attrs?.clusterParams
    }
  }

  onProgress?.({
    running: false,
    stage: 'done',
    message: 'Clustering complete'
  })

  return {
    clusterAttrsByNodeId,
    layoutByNodeId: mode === 'rearrange' ? dto.layout.layoutByNodeId : undefined,
    dto
  }
}

/**
 * Strips all cluster-related attributes (clusterId, clusterPath, clusterRunId, etc.)
 * from all nodes in the canvas while retaining all layout coordinates and connections.
 */
export function clearCanvasClusters(state: CanvasState): GraphCanvasDTO {
  const baseDto = serializeCanvas(state)
  const nextDto = structuredClone(baseDto)

  for (const node of Object.values(nextDto.graph.nodes)) {
    if (node.attrs) {
      const attrs = { ...node.attrs }
      delete attrs.clusterId
      delete attrs.clusterPath
      delete attrs.clusterRunId
      delete attrs.clusterParams
      delete attrs.group
      node.attrs = Object.keys(attrs).length > 0 ? attrs : undefined
    }
  }

  return nextDto
}
