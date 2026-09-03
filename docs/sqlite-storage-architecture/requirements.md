# Requirements & Invariants: SQLite Storage & Migration Architecture

## 1. Executive Summary & Core Objectives

CollarAgent is a local-first desktop IDE combining an infinite visual canvas, scholarly Lexical document editing, and a LangGraph ReAct co-pilot. This document defines the functional requirements, non-functional performance requirements (NFRs), and system integrity invariants for transitioning CollarAgent's storage engine from a sharded ZIP archive format (V3) to a **single-file embedded SQLite database (V4)** operating in Write-Ahead Logging (WAL) mode.

---

## 2. Functional Requirements (FRs)

### FR-01: Native Single-File Portability

- **FR-01.1**: The project database must exist as a self-contained, single file on disk maintaining the `.cagent` file extension (e.g., `research_paper.cagent`).
- **FR-01.2**: Users must be able to copy, move, rename, email, or AirDrop the `.cagent` file across workstations running macOS, Windows, or Linux without losing canvas states, document history, chat sessions, or agent checkpoints.
- **FR-01.3**: The database must require zero ambient system services, background database daemons, or user credential configuration.

### FR-02: Unified Heterogeneous Entity Storage

- **FR-02.1**: The `.cagent` database must store all four primary system domains transactionally:
  1. **Project & Instance Metadata:** Global project settings, canvas card schemas, and document metadata.
  2. **Content Payloads:** Binary MessagePack payloads for Lexical document JSON trees and Graph Canvas DTOs.
  3. **Chat Sessions & Messages:** Human-readable conversation history, reasoning blocks, and structured tool invocations.
  4. **LangGraph Runtime State:** Execution checkpoint graphs, channel version blobs, task writes, and restore heads.

### FR-03: Zero-Overhead Lifecycle Operations

- **FR-03.1**: Opening a project must connect directly to the existing database file without extracting files to disk.
- **FR-03.2**: Closing the application or exporting must flush pending WAL transactions and close the database handle without executing compression algorithms (e.g., `archiver`/`zlib`).

### FR-04: Automated Non-Destructive Migration

- **FR-04.1**: The storage engine must automatically detect legacy archive formats (V2 monolithic JSON and V3 sharded ZIP) via magic-byte inspection upon project open.
- **FR-04.2**: The engine must execute an automated, atomic ETL pipeline that migrates legacy structures into the SQLite schema.
- **FR-04.3**: A pre-migration safety backup (`<filename>.cagent.v3.bak`) must be created prior to any file mutation.
- **FR-04.4**: In the event of migration failure, the engine must fail closed, restore the original archive, and emit a structured diagnostic report.

---

## 3. Non-Functional Requirements (NFRs) & Performance Budgets

| Metric ID  | Scenario / Operation                            | V3 Sharded ZIP Baseline                              | V4 SQLite Performance Budget                   | Validation Method           |
| :--------- | :---------------------------------------------- | :--------------------------------------------------- | :--------------------------------------------- | :-------------------------- |
| **NFR-01** | Cold Project Open (1,000 checkpoints, 50 cards) | $3,500\text{ms} - 8,000\text{ms}$                    | **$< 15\text{ms}$** ($O(1)$)                   | Benchmark startup timer     |
| **NFR-02** | Window Close / Clean Exit                       | $2,000\text{ms} - 15,000\text{ms}$                   | **$< 10\text{ms}$** ($O(1)$)                   | Process teardown audit      |
| **NFR-03** | LangGraph Checkpoint Read (`getTuple`)          | $50\text{ms} - 250\text{ms}$ ($O(N)$ directory scan) | **$< 1.5\text{ms}$** ($O(\log N)$ point query) | End-to-end turn profiling   |
| **NFR-04** | LangGraph Checkpoint Write (`put`)              | $30\text{ms} - 120\text{ms}$                         | **$< 3\text{ms}$** (Sequential WAL append)     | LangGraph benchmark suite   |
| **NFR-05** | Instance Content Read (10MB Canvas / Doc)       | $45\text{ms} - 150\text{ms}$                         | **$< 8\text{ms}$** (Indexed BLOB streaming)    | Virtualized tab switch test |
| **NFR-06** | Memory Consumption on Workspace Mount           | $O(N)$ (eager loading of all cards)                  | **$< 25\text{MB}$** (lazy metadata-only cache) | Utility process heap dump   |
| **NFR-07** | Database File Compaction Overhead               | N/A (uncontrolled file bloat)                        | Background incremental compaction              | WAL checkpoint daemon test  |

---

## 4. System Invariants

### INV-01: Zero External Server Coupling

The storage layer must run strictly in-process within the Electron `utilityProcess`. No external port binding (other than local-loopback REST endpoints), containerization, or external database software may be introduced as an operational dependency.

### INV-02: Strict Single-Writer Concurrency Confinement

Only one Electron `utilityProcess` may hold write access to a `.cagent` file at any given moment. A companion file lock (`<path>.cagent.lock`) containing `{ pid, timestamp, host }` must enforce single-instance ownership and prevent multi-process database corruption.

### INV-03: Transactional Atomicity Across Agent Turns

A completed LangGraph agent turn must commit its updated conversation message, checkpoint tuple, and associated channel blobs inside a single atomic SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`). No partial turn state may be visible to queries or survive application crashes.

### INV-04: Clean Separation Between Live Engine State and UI Transport

The WebSocket server ([`ws-server.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/ws-server.ts)) and Frontend Renderer must maintain clean contract boundaries. The SQLite storage engine must interface with the application exclusively via the local HTTP REST interface exposed by [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts), guaranteeing zero breaking changes to client synchronizers.

### INV-05: Non-Destructive Migration Fail-Closed Guarantee

Under no circumstances may a legacy `.cagent` file be overwritten or truncated until the new SQLite database passes record-count parity checks, foreign key validation (`PRAGMA foreign_key_check`), and payload checksum verification.
