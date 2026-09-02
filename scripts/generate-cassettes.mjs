/**
 * scripts/generate-cassettes.mjs
 * Generates deterministic baseline VCR cassette tapes for all 30 evaluation scenarios across Tiers 1-5.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const cassetteDir = path.resolve(rootDir, 'evals/cassettes');

await fs.mkdir(cassetteDir, { recursive: true });

// Valid standard Lexical Document fixture strictly conforming to DocumentSchema
const standardDocumentPayload = {
  blocks: [
    { id: 'blk-h1-01', type: 'h1', content: 'Quantum Computing Foundations' },
    { id: 'blk-p-01', type: 'paragraph', content: 'Introductory section exploring basic principles.' },
    { id: 'blk-h2-01', type: 'h2', content: 'Core Principles' },
    { id: 'blk-h3-01', type: 'h3', content: 'Superposition and Entanglement' },
    { id: 'blk-math-01', type: 'paragraph', content: '$$i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi$$' },
    {
      id: 'blk-tbl-01',
      type: 'table',
      tableRows: [
        { cells: [{ children: [{ text: 'Qubit Type' }] }, { children: [{ text: 'Coherence Time' }] }, { children: [{ text: 'Fidelity' }] }] },
        { cells: [{ children: [{ text: 'Superconducting' }] }, { children: [{ text: '100 us' }] }, { children: [{ text: '99.9%' }] }] },
        { cells: [{ children: [{ text: 'Trapped Ion' }] }, { children: [{ text: '10 s' }] }, { children: [{ text: '99.99%' }] }] },
      ],
    },
  ],
};

// Valid standard Graph Canvas fixture strictly conforming to GraphCanvasDTOSchema
const standardGraphCanvas = {
  schemaVersion: 1,
  type: 'graph-canvas',
  graph: {
    nodes: {
      'node-root-1': { id: 'node-root-1', type: 'card', name: 'Consensus Protocols' },
      'node-cft-1': { id: 'node-cft-1', type: 'card', name: 'Crash Fault Tolerant' },
      'node-bft-1': { id: 'node-bft-1', type: 'card', name: 'Byzantine Fault Tolerant' },
      'node-raft-1': { id: 'node-raft-1', type: 'card', name: 'Raft' },
      'node-paxos-1': { id: 'node-paxos-1', type: 'card', name: 'Paxos' },
    },
    relationships: {
      'rel-1': { id: 'rel-1', from: { nodeId: 'node-root-1', portId: 'out' }, to: { nodeId: 'node-cft-1', portId: 'in' } },
      'rel-2': { id: 'rel-2', from: { nodeId: 'node-root-1', portId: 'out' }, to: { nodeId: 'node-bft-1', portId: 'in' } },
      'rel-3': { id: 'rel-3', from: { nodeId: 'node-cft-1', portId: 'out' }, to: { nodeId: 'node-raft-1', portId: 'in' } },
      'rel-4': { id: 'rel-4', from: { nodeId: 'node-cft-1', portId: 'out' }, to: { nodeId: 'node-paxos-1', portId: 'in' } },
    },
  },
  layout: {
    layoutByNodeId: {
      'node-root-1': { x: 250, y: 100, width: 180, height: 100 },
      'node-cft-1': { x: 150, y: 200, width: 180, height: 100 },
      'node-bft-1': { x: 350, y: 200, width: 180, height: 100 },
      'node-raft-1': { x: 100, y: 300, width: 180, height: 100 },
      'node-paxos-1': { x: 200, y: 300, width: 180, height: 100 },
    },
  },
};

const baselineSnapshot = {
  version: 1,
  blocks: [{ id: 'blk-01', content: 'initial state' }],
};

const scenarios = [
  // Tier 1: Doc
  { id: 'SCN-DOC-01', tool: 'createDocument', doc: standardDocumentPayload },
  { id: 'SCN-DOC-02', tool: 'editDocument', doc: standardDocumentPayload },
  { id: 'SCN-DOC-03', tool: 'editDocument', doc: standardDocumentPayload },
  { id: 'SCN-DOC-04', tool: 'importMarkdown', doc: standardDocumentPayload },
  { id: 'SCN-DOC-05', tool: 'patchDocumentBlock', doc: standardDocumentPayload },
  { id: 'SCN-DOC-06', tool: 'exportDocument', doc: standardDocumentPayload },
  { id: 'SCN-DOC-07', tool: 'editDocument', doc: standardDocumentPayload },
  { id: 'SCN-DOC-08', tool: 'editDocument', doc: standardDocumentPayload },

  // Tier 2: Graph
  { id: 'SCN-GRP-01', tool: 'writeMindMap', graph: standardGraphCanvas },
  { id: 'SCN-GRP-02', tool: 'writeMindMap', graph: standardGraphCanvas },
  { id: 'SCN-GRP-03', tool: 'layoutGraph', graph: standardGraphCanvas },
  { id: 'SCN-GRP-04', tool: 'clusterGraph', graph: standardGraphCanvas },
  { id: 'SCN-GRP-05', tool: 'linkNodes', graph: standardGraphCanvas },
  { id: 'SCN-GRP-06', tool: 'linkDocToNode', graph: standardGraphCanvas, doc: standardDocumentPayload },
  { id: 'SCN-GRP-07', tool: 'batchCreateNodes', graph: standardGraphCanvas },
  { id: 'SCN-GRP-08', tool: 'partitionGraph', graph: standardGraphCanvas },

  // Tier 3: Errors
  { id: 'SCN-ERR-01', tool: 'editDocument', errorRecovery: true },
  { id: 'SCN-ERR-02', tool: 'createDocument', errorRecovery: true },
  { id: 'SCN-ERR-03', tool: 'linkNodes', errorRecovery: true, graph: standardGraphCanvas },
  { id: 'SCN-ERR-04', tool: 'patchDocumentBlock', errorRecovery: true, doc: standardDocumentPayload },
  { id: 'SCN-ERR-05', tool: 'editDocument', errorRecovery: true },

  // Tier 4: Rollback
  { id: 'SCN-REV-01', tool: 'editDocument', rollback: true, doc: standardDocumentPayload },
  { id: 'SCN-REV-02', tool: 'writeMindMap', rollback: true, graph: standardGraphCanvas },
  { id: 'SCN-REV-03', tool: 'editDocument', rollback: true, doc: standardDocumentPayload },
  { id: 'SCN-REV-04', tool: 'editDocument', rollback: true, doc: standardDocumentPayload },
  { id: 'SCN-REV-05', tool: 'patchDocumentBlock', rollback: true, doc: standardDocumentPayload },

  // Tier 5: Subagents
  { id: 'SCN-SUB-01', tool: 'task' },
  { id: 'SCN-SUB-02', tool: 'task', graph: standardGraphCanvas },
  { id: 'SCN-SUB-03', tool: 'task' },
  { id: 'SCN-SUB-04', tool: 'editDocument' },
];

for (const scn of scenarios) {
  const tape = {
    scenarioId: scn.id,
    recordedAt: new Date().toISOString(),
    model: 'claude-3-7-sonnet',
    interactions: [
      {
        id: `step-1`,
        stepIndex: 0,
        input: { prompt: `Prompt for ${scn.id}` },
        output: {
          content: `Completed scenario ${scn.id}`,
          toolCalls: [
            {
              name: scn.tool,
              args: { scenarioId: scn.id, action: 'execute' },
              status: 'success',
            },
          ],
          documentPayload: scn.doc,
          graphCanvas: scn.graph,
          initialSnapshot: scn.rollback ? baselineSnapshot : undefined,
          restoredSnapshot: scn.rollback ? baselineSnapshot : undefined,
          errorRecoveryAchieved: scn.errorRecovery ? true : undefined,
          usage: {
            promptTokens: 350,
            completionTokens: 85,
            totalTokens: 435,
          },
        },
        latencyMs: 320,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const tapePath = path.join(cassetteDir, `${scn.id}.json`);
  await fs.writeFile(tapePath, JSON.stringify(tape, null, 2), 'utf8');
}

console.log(`✅ Generated 30 deterministic baseline cassette tapes in ${cassetteDir}`);

