# Runtime

## Overview

LangChain's `createAgent` runs on LangGraph's runtime under the hood.

LangGraph exposes a [`Runtime`] object with the following information:

1. **Context**: static information like user id, db connections, or other dependencies for an agent invocation
2. **Store**: a [BaseStore] instance used for [long-term memory](docs/langchain/long-term-memory)
3. **Stream writer**: an object used for streaming information via the `"custom"` stream mode

<Tip>
  The runtime context is how you thread data through your agent. Rather than storing things in global state, you can attach values — like a database connection, user session, or configuration — to the context and access them inside tools and middleware. This keeps things stateless, testable, and reusable.
</Tip>

You can access the runtime information within [tools](#inside-tools) and [middleware](#inside-middleware).

## Access

When creating an agent with `createAgent`, you can specify a `contextSchema` to define the structure of the `context` stored in the agent [`Runtime`].

When invoking the agent, pass the `context` argument with the relevant configuration for the run:

```ts  theme={null}
import * as z from "zod";
import { createAgent } from "langchain";

const contextSchema = z.object({ // [!code highlight]
  userName: z.string(), // [!code highlight]
}); // [!code highlight]

const agent = createAgent({
  model: "gpt-4o",
  tools: [
    /* ... */
  ],
  contextSchema, // [!code highlight]
});

const result = await agent.invoke(
  { messages: [{ role: "user", content: "What's my name?" }] },
  { context: { userName: "John Smith" } } // [!code highlight]
);
```

### Inside tools

You can access the runtime information inside tools to:

* Access the context
* Read or write long-term memory
* Write to the [custom stream](docs/langchain/streaming.md) (ex, tool progress / updates)

Use the `runtime` parameter to access the [`Runtime`] object inside a tool.

```ts  theme={null}
import * as z from "zod";
import { tool } from "langchain";
import { type ToolRuntime } from "@langchain/core/tools"; // [!code highlight]

const contextSchema = z.object({
  userName: z.string(),
});

const fetchUserEmailPreferences = tool(
  async (_, runtime: ToolRuntime<any, typeof contextSchema>) => { // [!code highlight]
    const userName = runtime.context?.userName; // [!code highlight]
    if (!userName) {
      throw new Error("userName is required");
    }

    let preferences = "The user prefers you to write a brief and polite email.";
    if (runtime.store) { // [!code highlight]
      const memory = await runtime.store?.get(["users"], userName); // [!code highlight]
      if (memory) {
        preferences = memory.value.preferences;
      }
    }
    return preferences;
  },
  {
    name: "fetch_user_email_preferences",
    description: "Fetch the user's email preferences.",
    schema: z.object({}),
  }
);
```

### Inside middleware

You can access runtime information in middleware to create dynamic prompts, modify messages, or control agent behavior based on user context.

Use the `runtime` parameter to access the [`Runtime`] object inside middleware.

```ts  theme={null}
import * as z from "zod";
import { createAgent, createMiddleware, SystemMessage } from "langchain";

const contextSchema = z.object({
  userName: z.string(),
});

// Dynamic prompt middleware
const dynamicPromptMiddleware = createMiddleware({
  name: "DynamicPrompt",
  contextSchema,
  beforeModel: (state, runtime) => { // [!code highlight]
    const userName = runtime.context?.userName; // [!code highlight]
    if (!userName) {
      throw new Error("userName is required");
    }

    const systemMsg = `You are a helpful assistant. Address the user as ${userName}.`;
    return {
      messages: [new SystemMessage(systemMsg), ...state.messages],
    };
  },
});

// Logging middleware
const loggingMiddleware = createMiddleware({
  name: "Logging",
  contextSchema,
  beforeModel: (state, runtime) => {  // [!code highlight]
    console.log(`Processing request for user: ${runtime.context?.userName}`);  // [!code highlight]
    return;
  },
  afterModel: (state, runtime) => {  // [!code highlight]
    console.log(`Completed request for user: ${runtime.context?.userName}`);  // [!code highlight]
    return;
  },
});

const agent = createAgent({
  model: "gpt-4o",
  tools: [
    /* ... */
  ],
  middleware: [dynamicPromptMiddleware, loggingMiddleware],  // [!code highlight]
  contextSchema,
});

const result = await agent.invoke(
  { messages: [{ role: "user", content: "What's my name?" }] },
  { context: { userName: "John Smith" } }
);

```
