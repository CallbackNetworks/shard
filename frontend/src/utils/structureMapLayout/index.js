// Structure-map layout algorithms. Split by strategy (ADR-0037 structure map):
// shared geometry in core/ribbon, one module per visual style. Consumers keep
// importing from '../utils/structureMapLayout' — this barrel preserves the
// original flat API.
export { riskColor, taskWeight, computePath } from './core'
export { ribbonPath } from './ribbon'
export { buildMindMapLayout } from './mindmap'
export { buildTreeLayout, treePath } from './tree'
export { networkPath, buildNetworkLayout } from './network'
