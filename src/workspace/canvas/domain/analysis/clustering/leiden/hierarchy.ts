export type HierarchyOptions = {
  /** Prefix for level labels. Default 'L'. */
  levelPrefix?: string;
};

export type ClusterLabels = {
  clusterIdByNodeIndex: string[];
  clusterPathByNodeIndex: string[][];
};

export function buildAggregationLevelHierarchy(
  communityOfByLevel: ArrayLike<ArrayLike<number>>,
  nodeCount: number,
  options: HierarchyOptions = {},
): ClusterLabels {
  const levelPrefix = options.levelPrefix ?? 'L';

  const clusterIdByNodeIndex: string[] = Array.from({ length: nodeCount }, () => '');
  const clusterPathByNodeIndex: string[][] = Array.from({ length: nodeCount }, () => []);

  for (let i = 0; i < nodeCount; i++) {
    const path: string[] = [];
    for (let level = 0; level < communityOfByLevel.length; level++) {
      const cid = `${levelPrefix}${level}:${communityOfByLevel[level][i]}`;
      path.push(cid);
    }
    clusterPathByNodeIndex[i] = path;
    clusterIdByNodeIndex[i] = path[path.length - 1] ?? `${levelPrefix}0:0`;
  }

  return { clusterIdByNodeIndex, clusterPathByNodeIndex };
}
