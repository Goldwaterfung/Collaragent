# Workspace Middleware Implementation Summaries (COMPLETED)

## 1. Current Middleware Configuration Flow

Understanding the existing data flow is crucial for integrating the new Workspace Middleware. The configuration system relies on a unidirectional flow from the frontend settings to the backend agent factory.

### 1.1 Data Structure (Shared Types)

The "Truth" of what middleware is available is defined in `src/shared/config/types.ts`.
Currently, it holds configurations for `todoList` and `filesystem`:

```typescript
export interface MiddlewareConfig {
  todoList: {
    enabled: boolean
    systemPrompt?: string
  }
  filesystem: {
    enabled: boolean
  }
  // Workspace config will be added here
}
```

### 1.2 Frontend Control (Renderer)

The User Interface in `src/renderer/components/Settings/Settings.tsx` allows users to toggle these features.

1. **Load**: `window.configIPC.get({})` retrieves the full JSON config.
2. **Interact**: User toggles a checkbox.
3. **Save**: `window.configIPC.save({ config: newConfig })` sends the entire updated object back to the main process.

### 1.3 IPC Bridge

The Electron `preload/index.ts` script bridges the gap:

- Exposes `configIPC` to `window`.
- Routes calls to `ipcRenderer.invoke('config:save', ...)`.

### 1.4 Backend Persistence (Main Process)

1. **Handler**: `src/main/handlers/config.ts` receives the save request.
2. **Manager**: `ConfigManager.ts` validates the schema checks and writes to `config.json`.

### 1.5 Runtime Injection (Agent Construction)

This is where the configuration takes effect.

1. **AgentFactory**: `src/main/agents/factory.ts` reads the config when `createAgent()` is called.
2. **DeepAgent Wrapper**: It calls `createDeepAgent` inside `@deepagents/agent.ts`, passing flags like `hasTodoList`.
3. **Middleware Selection**: Inside `createDeepAgent`, the boolean flags determine if the middleware functions (e.g., `todoListMiddleware()`) are added to the agent's middleware stack.

---

## 2. Workspace Middleware Design

The `workspaceMiddleware` will be responsible for injecting workspace-related tools (`readDocument`, `createDocument`, `writeGraph`, etc.) into the agent's context dynamically. We will use the `wrapModelCall` hook to append these tools to the model request.

### 2.1 Implementation Logic

We will create a new middleware factory function using `createMiddleware`.

**Key Features:**

- **Tools**: Register the workspace tools (`readDocument`, `createDocument`, etc.) directly in the middleware definition.
- **Configurability**: Optionally allow read-only access by filtering out "write" tools based on configuration.

### 2.2 Proposed Code Structure

```typescript
import { createMiddleware } from 'langchain'
import { type StructuredTool } from '@langchain/core/tools'
import {
  readDocument,
  createDocument,
  editDocument,
  deleteBlock,
  listWorkspaceItems
} from '@workspace/wstools/manageDocument'
import { readGraph, writeGraph } from '@workspace/wstools/manageGraph'

interface WorkspaceMiddlewareConfig {
  readOnly?: boolean
}

export const createWorkspaceMiddleware = (config: WorkspaceMiddlewareConfig = {}) => {
  // Define tool sets
  const readTools = [readDocument, listWorkspaceItems, readGraph]
  const writeTools = [createDocument, editDocument, deleteBlock, writeGraph]

  // Determine active tools
  const activeTools = config.readOnly ? [...readTools] : [...readTools, ...writeTools]

  return createMiddleware({
    name: 'WorkspaceMiddleware',

    // CRITICAL: Tools must be registered explicitly here.
    // The middleware system will automatically make these available to the agent.
    tools: activeTools
  })
}
```

---

## 3. Implementation Phases

We will execute this implementation in 5 distinct phases to ensure all parts of the system (Types, UI, Backend, Runtime) are synchronized.

### Phase 1: Shared Configuration Types

**Goal**: Update the data contract to include Workspace settings.

**Target File**: `src/shared/config/types.ts`
**Action**:

1.  Extend `MiddlewareConfig` interface.

```typescript
export interface MiddlewareConfig {
  todoList: { enabled: boolean; ... };
  filesystem: { enabled: boolean; };
  // Add this:
  workspace: {
    enabled: boolean;
    readOnly: boolean; // Option to restrict agent to reading only
  };
}
```

**Target File**: `src/shared/config/defaults.ts` (implied existence)
**Action**:

1.  Add default values for the new config section (e.g., `enabled: true`, `readOnly: false`).

### Phase 2: Frontend Implementation

**Goal**: Allow users to toggle Workspace tools in the Settings UI.

**Target File**: `src/renderer/components/Settings/Settings.tsx`
**Action**:

1.  Locate the "Middleware" (Advanced) tab logic.
2.  Add a new UI block similar to the TodoList toggle.
3.  Add a main toggle for `enabled`.
4.  Add a secondary checkbox/toggle for `readOnly` mode (nested or adjacent).
5.  Ensure `onChange` handlers correctly update `config.middleware.workspace`.

```tsx
{/* Workspace Middleware Toggle */}
<div className="p-4 sm:p-5 bg-white rounded-xl ...">
    <div className="flex ... justify-between ...">
        <div>
           <h3>Workspace Middleware</h3>
           <p>Enable document and graph editing capabilities.</p>
        </div>
        <Toggle
           checked={config.middleware.workspace.enabled}
           onChange={...}
        />
    </div>
    {/* Read Only Sub-option */}
    {config.middleware.workspace.enabled && (
        <div className="mt-2 ml-2">
            <Checkbox
                label="Read Only Mode"
                checked={config.middleware.workspace.readOnly}
                onChange={...}
            />
        </div>
    )}
</div>
```

### Phase 3: Backend Configuration & Validation

**Goal**: Ensure the backend accepts and validates the new config structure.

**Target File**: `src/shared/config/schemas.ts` (if Zod schemas exist there)
**Action**:

1.  Update the Zod schema for `MiddlewareConfig` to include the `workspace` object.
2.  Ensures `AppConfigSchema.safeParse` in `ConfigManager.ts` succeeds with the new fields.

**Target File**: `src/main/config/ConfigManager.ts`
**Action**:

1.  Verify `loadConfig` merges defaults correctly if the `workspace` key is missing from an old `config.json`.

### Phase 4: Middleware Logic Implementation

**Goal**: Create the actual middleware code.

**Target File**: `@deepagents/middleware/workspace.ts` (New File)
**Action**:

1.  Create the file.
2.  Paste the logic defined in Section 2.2 (`createWorkspaceMiddleware`).
3.  Ensure imports from `@workspace/wstools/manageDocument` are correct (or move tools if necessary).
    - _Note_: Tools in `@workspace/wstools` are the workspace domain operations that should be directly importable.

**Target File**: `@deepagents/middleware/index.ts`
**Action**:

1.  Export `createWorkspaceMiddleware` to make it accessible to `agent.ts`.

### Phase 5: Agent Factory Integration

**Goal**: Wire the middleware into the agent creation loop.

**Target File**: `src/main/agents/factory.ts`
**Action**:

1.  In `createAgent`, extract the workspace config:
    ```typescript
    const workspaceConfig = config.middleware?.workspace ?? { enabled: false, readOnly: false }
    ```
2.  Pass these values to `createDeepAgent`.

**Target File**: `@deepagents/agent.ts` (The definition of `createDeepAgent`)
**Action**:

1.  Update `CreateDeepAgentParams` type to include `hasWorkspace` and `workspaceReadOnly`.
2.  Import `createWorkspaceMiddleware`.
3.  In the `builtInMiddleware` array, conditionaly add the middleware:
    ```typescript
    ...(hasWorkspace
       ? [createWorkspaceMiddleware({ readOnly: workspaceReadOnly })]
       : []
    ),
    ```

### Phase 6: Verification

1.  **Frontend**: Open Settings -> Advanced. Toggle Workspace on. Save.
2.  **Persistence**: Check `~/.collaragent/config.json` to see `workspace: { enabled: true, ... }`.
3.  **Runtime**:
    - Start a new chat.
    - Address the agent: "Create a new document called 'Test Doc'".
    - Agent should have the `createDocument` tool available and succeed.
4.  **Read-Only Test**:
    - Toggle "Read Only" in settings.
    - Ask agent to "Create a document".
    - Agent should fail or say it lacks the tool (depending on visibility), or the tool call should be intercepted. Since we filter tools in `wrapModelCall`, the model won't even see the tool definition, so it won't try to call it (or will hallucinate a call that fails).

This plan provides a complete path from user interface to low-level agent capability injection.
