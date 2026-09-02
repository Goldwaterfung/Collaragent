---
title: Sessions
description: Track LLM chat conversations or threads across multiple observations and traces into a single session. Replay the entire interaction to debug or analyze the conversation.
sidebarTitle: Sessions
---

# Sessions

Many interactions with LLM applications span multiple [traces](/docs/observability/data-model#observations-traces-and-sessions). `Sessions` in Langfuse allow you to group traces together and see a simple **session replay** of the entire interaction.

Try this feature using the public [example project](/docs/demo).

_Example session spanning multiple traces_

<Frame fullWidth>![Session view](/images/docs/session.png)</Frame>

In the session view you can:

- Replay the entire interaction to debug or analyze the conversation
- Publish a session to share with others as a public link ([example](https://cloud.langfuse.com/project/clkpwwm0m000gmm094odg11gi/sessions/lf.docs.conversation.TL4KDlo))
- Bookmark a session to easily find it later
- Annotate sessions by adding `scores` via the Langfuse UI to record human-in-the-loop evaluations

## Set up sessions [#set-up-sessions]

Get started by propagating the `sessionId` attribute across observations. The `sessionId` can be any US-ASCII character string less than 200 characters that you use to identify the session. All observations with the same `sessionId` will be grouped together including their enclosing traces. If a session ID exceeds 200 characters, it will be dropped.

<LangTabs items={["Python SDK", "JS/TS SDK", "OpenAI (Python)", "Langchain (Python)", "Langchain (JS/TS)", "Flowise"]}>

<Tab title="Python SDK (v3)">
When using the `@observe()` decorator:

```python /propagate_attributes(session_id="your-session-id")/
from langfuse import observe, propagate_attributes

@observe()
def process_request():
    # Propagate session_id to all child observations
    with propagate_attributes(session_id="your-session-id"):
        # All nested observations automatically inherit session_id
        result = process_chat_message()

        return result
```

When creating observations directly:

```python /propagate_attributes(session_id="chat-session-123")/
from langfuse import get_client, propagate_attributes

langfuse = get_client()

with langfuse.start_as_current_observation(
    as_type="span",
    name="process-chat-message"
) as root_span:
    # Propagate session_id to all child observations
    with propagate_attributes(session_id="chat-session-123"):
        # All observations created here automatically have session_id
        with root_span.start_as_current_observation(
            as_type="generation",
            name="generate-response",
            model="gpt-4o"
        ) as gen:
            # This generation automatically has session_id
            pass
```

</Tab>
<Tab title="JS/TS SDK">

When using the context manager:

```ts /propagateAttributes/
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'

await startActiveObservation('context-manager', async (span) => {
  span.update({
    input: { query: 'What is the capital of France?' }
  })

  // Propagate sessionId to all child observations
  await propagateAttributes(
    {
      sessionId: 'session-123'
    },
    async () => {
      // All observations created here automatically have sessionId
      // ... your logic ...
    }
  )
})
```

When using the `observe` wrapper:

```ts /propagateAttributes/
import { observe, propagateAttributes } from '@langfuse/tracing'

const processChatMessage = observe(
  async (message: string) => {
    // Propagate sessionId to all child observations
    return await propagateAttributes({ sessionId: 'session-123' }, async () => {
      // All nested observations automatically inherit sessionId
      const result = await processMessage(message)
      return result
    })
  },
  { name: 'process-chat-message' }
)

const result = await processChatMessage('Hello!')
```

See [JS/TS SDK docs](/docs/sdk/typescript/guide) for more details.

</Tab>
<Tab>

```python /propagate_attributes(session_id="your-session-id")/
from langfuse import get_client, propagate_attributes
from langfuse.openai import openai

langfuse = get_client()

with langfuse.start_as_current_observation(as_type="span", name="openai-call"):
    # Propagate session_id to all observations including OpenAI generation
    with propagate_attributes(session_id="your-session-id"):
        completion = openai.chat.completions.create(
            name="test-chat",
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a calculator."},
                {"role": "user", "content": "1 + 1 = "}
            ],
            temperature=0,
        )
```

</Tab>
<Tab>

```python /propagate_attributes(session_id="your-session-id")/
from langfuse import get_client, propagate_attributes
from langfuse.langchain import CallbackHandler

langfuse = get_client()
handler = CallbackHandler()

with langfuse.start_as_current_observation(as_type="span", name="langchain-call"):
    # Propagate session_id to all observations
    with propagate_attributes(session_id="your-session-id"):
        # Pass handler to the chain invocation
        chain.invoke(
            {"animal": "dog"},
            config={"callbacks": [handler]},
        )
```

</Tab>
<Tab title="Langchain (JS/TS)">

Use `propagateAttributes()` with the CallbackHandler:

```ts /propagateAttributes/
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { CallbackHandler } from '@langfuse/langchain'

const langfuseHandler = new CallbackHandler()

await startActiveObservation('langchain-call', async () => {
  // Propagate sessionId to all observations
  await propagateAttributes(
    {
      sessionId: 'your-session-id'
    },
    async () => {
      // Pass handler to the chain invocation
      await chain.invoke({ input: '<user_input>' }, { callbacks: [langfuseHandler] })
    }
  )
})
```

</Tab>

<Tab title="Flowise">
The [Flowise Integration](/docs/flowise) automatically maps the Flowise chatId to the Langfuse sessionId. Flowise 1.4.10 or higher is required.

</Tab>

</LangTabs>

## Other features

- Add `session-level` scores programmatically via SDK or API, for example from [user feedback forms](/docs/observability/features/user-feedback), moderation checks, or conversation-level QA pipelines. See [Scores via API/SDK](/docs/evaluation/evaluation-methods/scores-via-sdk).
- How to [evaluate sessions](/resources/engineering/evaluating-sessions-conversations) in Langfuse?

## Related Resources

- If you need to group operations across multiple services into a single trace (rather than grouping traces together), see [Trace IDs & Distributed Tracing](/docs/observability/features/trace-ids-and-distributed-tracing).

## GitHub Discussions

<!-- agent-instructions -->

---

## Agent Instructions

This page is part of the [Langfuse](https://langfuse.com) documentation, published as plain Markdown for AI agents. Every page is available as Markdown by appending `.md` to its URL, or by sending an `Accept: text/markdown` header. This page: `https://langfuse.com/docs/observability/features/sessions.md`.

### Querying these docs

If the answer is not on this page, query the documentation instead of guessing:

- **Semantic search** across all Langfuse docs, returning an answer with the relevant pages and excerpts. Ask a specific, self-contained question:

  ```bash
  curl -sG "https://langfuse.com/api/search-docs" --data-urlencode "query=How do I trace a LangGraph agent?"
  ```

- **Index of every page**: <https://langfuse.com/llms.txt>, with per-section indexes [llms-docs.txt](https://langfuse.com/llms-docs.txt), [llms-integrations.txt](https://langfuse.com/llms-integrations.txt), and [llms-self-hosting.txt](https://langfuse.com/llms-self-hosting.txt).

### Before writing Langfuse code

- **Install the [Langfuse Agent Skill](https://langfuse.com/docs/api-and-data-platform/features/agent-skill).** It encodes Langfuse's own best practices for instrumentation, prompt management, and evaluation, and materially improves results.
- **Read [What does a good trace look like?](https://langfuse.com/docs/observability/best-practices.md)** before instrumenting an application.
- **Verify endpoints, parameters, and response fields** against the [API reference](https://api.reference.langfuse.com) instead of inferring them from code examples.
- **Use the [Langfuse CLI](https://langfuse.com/docs/api-and-data-platform/features/cli)** (`npx langfuse-cli api <resource> <action>`) to read or write traces, prompts, datasets, and scores from the terminal.

Found an error in these docs? Please open an issue at <https://github.com/langfuse/langfuse-docs/issues>.
