# Registering a New Middleware

Middleware in the application intercepts, augments, or monitors the AI agent's logic. Adding a new middleware involves several steps across the UI configurations, runtime definitions, and IPC handlers.

This guide details the procedure for registering a new middleware.

## 1. Define the Middleware Component

First, create the core logic and tool set for your middleware. 

1. Create a new directory or file under `src/deepagents/middleware/`, for example `src/deepagents/middleware/example.ts`.
2. Define the tools and return the completed middleware using the `createMiddleware` approach.
3. Export your middleware from `src/deepagents/middleware/index.ts`.

## 2. Update Shared Configuration & Types

You must register the new middleware in the application's configuration state so it can be enabled or disabled globally.

### A. `src/shared/config/types.ts`
Add your middleware configuration interface to `MiddlewareConfig`:
```typescript
export interface MiddlewareConfig {
  // ... existing middleware
  example: {
    enabled: boolean;
    // Add any specific settings (e.g. source paths, API keys for the middleware)
  };
}
```

### B. `src/shared/config/schemas.ts`
Create the corresponding Zod schema for runtime validation under `MiddlewareConfigSchema`:
```typescript
export const MiddlewareConfigSchema = z.object({
  // ... existing middleware
  example: z.object({
    enabled: z.boolean(),
  }).default({ enabled: false }),
});
```

### C. `src/shared/config/defaults.ts`
Provide a default fallback value in `DEFAULT_CONFIG`'s `middleware` object so new clients don't crash:
```typescript
export const DEFAULT_CONFIG: AppConfig = {
  // ...
  middleware: {
    // ... existing middleware defaults
    example: {
      enabled: false,
    },
  },
};
```

## 3. Integrate with Deep Agent Runtime

You need to ensure the parameters correctly trickle down into the agent's initialization.

### A. `src/deepagents/runtime/agent.ts`
Inside `createDeepAgent`, you can either add a built-in flag (for core middleware) or rely on the `middleware` array for custom ones.

If it's a built-in middleware, add it to `builtInMiddleware`:
```typescript
const builtInMiddleware = [
  // ...
  ...(hasExample ? [createExampleMiddleware()] : []),
] as const;
```

## 4. Hook Up to Main Process Agent Factory

The `AgentFactory` is responsible for reading the configuration and initializing the middleware instances.

### A. `src/main/agents/factory.ts`
In `createAgent`, extract your setting from `config.middleware` and pass it into the `createDeepAgent` call. It is recommended to create the middleware instance in the factory if it requires complex initialization (like filesystem access).

```typescript
// Extract config
const exampleConfig = config.middleware?.example;

// Initialize middleware instance if enabled
const exampleMiddleware = exampleConfig?.enabled 
  ? createExampleMiddleware({
      // pass parameters from config
    })
  : null;

const agent: any = createDeepAgent({
  // ...
  middleware: [
      ...(exampleMiddleware ? [exampleMiddleware] : []),
      // ... other middleware
  ],
});
```

## 5. Expose in Renderer Settings UI

Allow the user to turn the middleware on and off from the Settings window.

**File:** `src/renderer/components/Settings/Settings.tsx`
The settings UI uses a tabbed layout. Decide which tab your middleware belongs to (`general`, `subagents`, `skills`, or `tools`). It is recommended to create a dedicated component for your middleware's settings.

**Example Component:** `src/renderer/components/Settings/ExampleSettings.tsx`
```tsx
export function ExampleSettings({ config, onSave }: Props) {
    const [enabled, setEnabled] = useState(config.middleware?.example?.enabled ?? false);

    const handleToggle = async (newEnabled: boolean) => {
        setEnabled(newEnabled);
        const newConfig = {
            ...config,
            middleware: {
                ...config.middleware,
                example: { enabled: newEnabled },
            },
        };
        await onSave(newConfig);
    };

    return (
        <div className="p-4 bg-white rounded-xl border border-surface-200">
            <h3 className="font-semibold">Example Middleware</h3>
            <label className="relative inline-flex items-center cursor-pointer">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => handleToggle(e.target.checked)}
                    className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-200 rounded-full peer peer-checked:bg-primary"></div>
            </label>
        </div>
    );
}
```

**Integration in `Settings.tsx`:**
```tsx
{activeTab === 'skills' && (
    <div className="space-y-4">
        <SkillsSettings ... />
        <ExampleSettings
            config={config}
            onSave={async (newConfig) => {
                await window.configIPC.save({ config: newConfig });
                await loadConfig();
            }}
        />
    </div>
)}
```

Once saved, restart the electron application and the new middleware will be functional!
