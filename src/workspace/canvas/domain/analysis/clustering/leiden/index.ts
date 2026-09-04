import type { GraphCanvasDTO, GraphCanvasNodeDTO } from '@workspace/persistence/graphCanvasDto'
import { adaptDtoToMultiplexGraph } from './graphAdapter'
import { buildAggregationLevelHierarchy } from './hierarchy'
import { runLeidenHierarchical } from './leidenCore'
import type { HierarchicalLeidenOptions, HierarchicalLeidenResult } from './types'
import { validateGraphCanvasDtoForClustering } from './validate'

export { mapRelationshipAttrsToScalars } from './scalarMapping'
export { adaptDtoToMultiplexGraph } from './graphAdapter'
export { validateGraphCanvasDtoForClustering } from './validate'
export { runLeidenLocalMoving } from './leidenCore'
export { runLeidenHierarchical } from './leidenCore'

export type LeidenProgressEvent =
  | { stage: 'clone' }
  | { stage: 'validate' }
  | { stage: 'adapt' }
  | { stage: 'run'; level?: number; levelsDone?: number }
  | { stage: 'stamp' }
  | { stage: 'done' }

export type LeidenRunHooks = {
  onProgress?: (ev: LeidenProgressEvent) => void
}

function createClusterRunId(): string {
  const ts = new Date().toISOString()
  const rand = Math.random().toString(16).slice(2)
  return `leiden:${ts}:${rand}`
}

export async function runHierarchicalLeidenOnDto(
  dto: GraphCanvasDTO,
  options: HierarchicalLeidenOptions = {},
  hooks: LeidenRunHooks = {}
): Promise<HierarchicalLeidenResult> {
  const clusterRunId = createClusterRunId()

  hooks.onProgress?.({ stage: 'clone' })

  const nextDto: GraphCanvasDTO =
    typeof structuredClone === 'function'
      ? structuredClone(dto)
      : (JSON.parse(JSON.stringify(dto)) as GraphCanvasDTO)

  const validation = validateGraphCanvasDtoForClustering(nextDto)
  const hasBlockingError = validation.issues.some((i) => i.level === 'error')

  hooks.onProgress?.({ stage: 'validate' })

  const nodesRaw = nextDto.graph?.nodes
  const nodesList: GraphCanvasNodeDTO[] = Array.isArray(nodesRaw)
    ? nodesRaw
    : nodesRaw && typeof nodesRaw === 'object'
      ? Object.values(nodesRaw)
      : []

  // Fast lookup for stamping by id.
  const nodeById = new Map<string, GraphCanvasNodeDTO>()
  for (const node of nodesList) {
    nodeById.set(String(node.id), node)
  }

  if (hasBlockingError) {
    for (const node of nodesList) {
      const attrs = (node.attrs ??= {})
      attrs.clusterRunId = clusterRunId
      attrs.clusterParams = {
        ...options,
        implementation: 'leiden-full',
        status: 'skipped',
        reason: 'validation-error',
        issues: validation.issues
      }
    }

    hooks.onProgress?.({ stage: 'done' })
    return { clusterRunId, dto: nextDto }
  }

  hooks.onProgress?.({ stage: 'adapt' })
  const adapted = adaptDtoToMultiplexGraph(nextDto, { layerWeights: options.layerWeights })

  hooks.onProgress?.({ stage: 'run' })
  const hierarchical = runLeidenHierarchical(
    adapted,
    {
      seed: options.seed,
      signedMode: options.signedMode,
      lambda: options.lambda,
      gamma: options.gamma,
      maxLevels: options.maxLevels
    },
    {
      onLevel: (level) => hooks.onProgress?.({ stage: 'run', level, levelsDone: level + 1 })
    }
  )

  hooks.onProgress?.({ stage: 'stamp' })
  const { clusterIdByNodeIndex, clusterPathByNodeIndex } = buildAggregationLevelHierarchy(
    hierarchical.communityOfByLevel,
    adapted.nodeIdByIndex.length,
    { levelPrefix: 'L' }
  )

  for (let i = 0; i < adapted.nodeIdByIndex.length; i++) {
    const nodeId = String(adapted.nodeIdByIndex[i])
    const node = nodeById.get(nodeId)
    if (!node) continue

    const attrs = (node.attrs ??= {})
    attrs.clusterRunId = clusterRunId
    attrs.clusterParams = {
      ...options,
      implementation: 'leiden-full',
      status: 'ok',
      levels: hierarchical.communityCountByLevel.length,
      communityCountByLevel: hierarchical.communityCountByLevel,
      validation: validation.issues
    }
    attrs.clusterPath = clusterPathByNodeIndex[i]
    attrs.clusterId = clusterIdByNodeIndex[i]
  }

  hooks.onProgress?.({ stage: 'done' })

  return { clusterRunId, dto: nextDto }
}

export type { HierarchicalLeidenOptions, HierarchicalLeidenResult } from './types'
