# ADR-003: Nominal ID Branding for Graph Entities

## Status
**Accepted**

## Context
In graph canvas and visual node-link applications, components manage multiple interrelated identifier strings: Node IDs, Relationship/Edge IDs, Port IDs, and Graph IDs. In standard TypeScript, typing these as generic `string` allows catastrophic bugs where a `portId` is passed to a function expecting a `nodeId` or `relationshipId`, leading to silent referential integrity corruption.

## Decision
We enforce **TypeScript Nominal Type Branding** across all shared domain entities:
```typescript
export type NodeId = string & { readonly __brand: 'NodeId' };
export type RelationshipId = string & { readonly __brand: 'RelationshipId' };
export type PortId = string & { readonly __brand: 'PortId' };
export type GraphId = string & { readonly __brand: 'GraphId' };
```
Explicit factory and casting functions (`asNodeId`, `asRelationshipId`, `asPortId`, `asGraphId`) are required at ingestion boundaries (e.g. Zod parsing and user input), ensuring downstream domain functions (`addNode`, `addRelationship`, `removeNode`) operate with mathematical type safety.

## Consequences
### Positive
- Compile-time prevention of identifier transpositions and cross-assignment bugs.
- Clear structural intent across all domain operations and canvas reducers.
- Zero runtime performance overhead (nominal brands exist solely during compilation).

### Negative / Trade-offs
- Requires explicit casting functions when hydrating IDs from JSON or DTO payloads.

## Compliance
Verified via `src/shared/canvas/entities.ts` and `src/workspace/canvas/domain/ids.ts`.
