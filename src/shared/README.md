# Shared Module

The `shared/` module contains cross-cutting contracts, types, schemas, and utilities that are used across all process layers (`main`, `renderer`, `preload`) and other modules.

## Principles

1.  **Zero Dependencies**: This module must NOT depend on Electron or any process-specific APIs.
2.  **Contract-First**: This is where IPC schemas, service interfaces, and data models live.
3.  **Portability**: Code here should be usable in any JavaScript/TypeScript environment.

## Directory Structure

-   `types/`: General shared TypeScript types and domain entities not tied to a specific module.
-   `ipc/`: IPC schemas, channel definitions, and request/response types.
-   `schemas/`: Validation schemas (e.g., Zod) for data integrity.
-   `agents/`: Shared types and logic related to the agent runtime.
-   `algorithms/`: Generic algorithms and data structures (e.g., Trie).
-   `canvas/`: Types and logic specific to the graph canvas.
-   `checkpoints/`: Shared types for agent checkpoints and diffing.
-   `commands/`: Command patterns and shared command definitions.
-   `config/`: Shared configuration type definitions.
-   `services/`: Shared service interfaces that define the contract between layers.
-   `utils/`: General-purpose utilities (string manipulation, math, etc.).
-   `constants.ts`: System-wide constants.
