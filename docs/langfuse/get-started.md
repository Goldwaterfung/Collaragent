---
title: Get Started
description: Get started with LLM observability with Langfuse in minutes before diving into all platform features.
---

# Get Started with Tracing

This guide walks you through ingesting your first trace into Langfuse. If you're looking to understand what tracing is and why it matters, check out the [Observability Overview](/docs/observability/overview) first. For details on how traces are structured in Langfuse and how it works in the background, see [Core Concepts](/docs/observability/data-model).

h2]:mt-6 [&>h2]:mb-4">

## Agentic installation [#agentic-installation]

Install the [Langfuse Agent Skill](https://github.com/langfuse/skills) to let your coding agent access all Langfuse features.

<Tabs items={["Ask your coding agent", "Cursor plugin", "Manual installation"]}>

<Tab>

Ask your coding agent to install the skill by pointing to the [GitHub repository](https://github.com/langfuse/skills) and instruct it to get started with tracing.

```txt filename="Agent instruction"
Install the Langfuse Agent Skill from github.com/langfuse/skills
and use it to add tracing to this application with Langfuse
following best practices.
```

</Tab>

<Tab>

Langfuse has a [Cursor Plugin](https://cursor.com/docs/plugins) that includes the skill automatically.

  <Button asChild>
    <Link
      href="https://cursor.com/marketplace/langfuse"
      target="_blank"
      rel="noopener noreferrer"
    >
      Install Plugin in Cursor
    </Link>
  </Button>

Then prompt your agent:

```txt filename="Agent instruction"
Add tracing to this application with Langfuse following best practices.
```

</Tab>

<Tab>

Install via npm ([skills CLI](https://www.npmjs.com/package/skills)):

```bash
npx skills add langfuse/skills --skill "langfuse"
```

If you want to target a specific agent directly:

```bash
npx skills add langfuse/skills --skill "langfuse" --agent "<agent-id>"
```

<Details>
<Summary>Alternatively you can manually clone the skill</Summary>

1. Clone repo somewhere stable

```bash
git clone https://github.com/langfuse/skills.git /path/to/langfuse-skills
```

2. Make sure your agent's skills dir exists

```bash
mkdir -p /path/to/<agent-skill-root>/skills
```

3. Symlink the skill folder

```bash
ln -s /path/to/langfuse-skills/skills/langfuse /path/to/<agent-skill-root>/skills/langfuse
```

</Details>

Then prompt your agent:

```txt filename="Agent instruction"
Add tracing to this application with Langfuse following best practices.
```

</Tab>

</Tabs>

## Manual installation [#manual-installation]

This guide helps you get started with Langfuse tracing manually.

<Steps>
### Get API keys

1.  [Create Langfuse account](https://cloud.langfuse.com/auth/sign-up) or [self-host Langfuse](/self-hosting).
2.  Create new API credentials in the project settings.

### Ingest your first trace

Choose your framework, SDK, or OpenTelemetry setup to get started. If your
application already emits OTEL spans, start with the OpenTelemetry guide.

<LangTabs items={["OpenAI SDK (Python)", "OpenAI SDK (JS/TS)", "Vercel AI SDK", "LangChain (Python)", "LangChain (JS/TS)", "Python SDK", "JS/TS SDK", "OpenTelemetry (OTEL)", "More integrations"]}>

<Tab>

Langfuse's OpenAI SDK is a drop-in replacement for the OpenAI client that automatically records your model calls without changing how you write code. If you already use the OpenAI python SDK, you can start using Langfuse with minimal changes to your code.

Start by installing the Langfuse OpenAI SDK. It includes the wrapped OpenAI client and sends traces in the background.

```bash
pip install langfuse
```

Set your Langfuse credentials as environment variables so the SDK knows which project to write to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

Swap the regular OpenAI import to Langfuse’s OpenAI drop-in. It behaves like the regular OpenAI client while also recording each call for you.

```python
from langfuse.openai import openai
```

Use the OpenAI SDK as you normally would. The wrapper captures the prompt, model and output and forwards everything to Langfuse.

```python
completion = openai.chat.completions.create(
  name="test-chat",
  model="gpt-4o",
  messages=[
      {"role": "system", "content": "You are a very accurate calculator. You output only the result of the calculation."},
      {"role": "user", "content": "1 + 1 = "}],
  metadata={"someMetadataKey": "someValue"},
)
```

- [Full OpenAI SDK documentation](/integrations/model-providers/openai-py)
- [Notebook example](https://colab.research.google.com/github/langfuse/langfuse-docs/blob/main/cookbook/integration_openai_sdk.ipynb)

</Tab>

<Tab>

Langfuse's JS/TS OpenAI SDK wraps the official client so your model calls are automatically traced and sent to Langfuse. If you already use the OpenAI JavaScript SDK, you can start using Langfuse with minimal changes to your code.

First install the Langfuse OpenAI wrapper. It extends the official client to send traces in the background.

**Install package**

```sh
npm install @langfuse/openai
```

**Add credentials**

Add your Langfuse credentials to your environment variables so the SDK knows which project to write to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

**Initialize OpenTelemetry**

Install the OpenTelemetry SDK, which the Langfuse integration uses under the hood to capture the data from each OpenAI call.

```bash
npm install @opentelemetry/sdk-node
```

Next is initializing the Node SDK. You can do that either in a dedicated instrumentation file or directly at the top of your main file.

<LangTabs items={["Inline setup", "Instrumentation file"]}>

<Tab>

The inline setup is the simplest way to get started. It works well for projects where your main file is executed first and import order is straightforward.

We can now initialize the `LangfuseSpanProcessor` and start the SDK. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

Important: start the SDK before initializing the logic that needs to be traced to avoid losing data.

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

</Tab>

<Tab>

The instrumentation file often preferred when you're using frameworks that have complex startup order (Next.js, serverless, bundlers) or if you want a clean, predictable place where tracing is always initialized first.

Create an `instrumentation.ts` file, which sets up the _collector_ that gathers data about each OpenAI call. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

```ts filename="instrumentation.ts" /LangfuseSpanProcessor/
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

Import the `instrumentation.ts` file first so all later imports run with tracing enabled.

```ts filename="index.ts"
import './instrumentation' // Must be the first import
```

</Tab>

</LangTabs>

Wrap your normal OpenAI client. From now on, each OpenAI request is automatically collected and forwarded to Langfuse.

**Wrap OpenAI client**

```ts
import OpenAI from 'openai'
import { observeOpenAI } from '@langfuse/openai'

const openai = observeOpenAI(new OpenAI())

const res = await openai.chat.completions.create({
  messages: [{ role: 'system', content: 'Tell me a story about a dog.' }],
  model: 'gpt-4o',
  max_tokens: 300
})
```

- [Full OpenAI SDK documentation](/integrations/model-providers/openai-js)

</Tab>

<Tab>

Langfuse's Vercel AI SDK integration uses OpenTelemetry to automatically trace your AI calls. If you already use the Vercel AI SDK, you can start using Langfuse with minimal changes to your code.

**Install packages**

Install AI SDK 7, OpenTelemetry, and the Langfuse integration packages.

```bash
npm install ai @ai-sdk/openai @langfuse/vercel-ai-sdk @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

**Add credentials**

Set your Langfuse credentials as environment variables so the SDK knows which project to write to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

**Initialize OpenTelemetry with Langfuse**

Set up the OpenTelemetry SDK with the Langfuse span processor and register the Langfuse Vercel AI SDK telemetry integration once at application startup.

```typescript
import { registerTelemetry } from 'ai'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()

registerTelemetry(new LangfuseVercelAiSdkIntegration())
```

**Run AI SDK calls**

After telemetry is registered, AI SDK 7 emits telemetry by default. Use `telemetry` to set a function name, include selected runtime context keys, or opt out of telemetry for a specific call.

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const { text } = await generateText({
  model: openai('gpt-5.1'),
  prompt: 'What is the weather like today?',
  telemetry: {
    functionId: 'weather-chat'
  }
})
```

- [Full Vercel AI SDK documentation](/integrations/frameworks/vercel-ai-sdk)

</Tab>

<Tab>

Langfuse's LangChain integration uses a callback handler to record and send traces to Langfuse. If you already use LangChain, you can start using Langfuse with minimal changes to your code.

First install the Langfuse SDK and your LangChain SDK.

```bash
pip install langfuse langchain-openai
```

Add your Langfuse credentials as environment variables so the callback handler knows which project to write to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

Initialize the Langfuse callback handler. LangChain has its own callback system, and Langfuse listens to those callbacks to record what your chains and LLMs are doing.

```python
from langfuse.langchain import CallbackHandler

langfuse_handler = CallbackHandler()
```

Add the Langfuse callback handler to your chain. The Langfuse callback handler plugs into LangChain’s event system. Every time the chain runs or the LLM is called, LangChain emits events, and the handler turns those into traces and observations in Langfuse.

```python {10}
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI(model_name="gpt-4o")
prompt = ChatPromptTemplate.from_template("Tell me a joke about {topic}")
chain = prompt | llm

response = chain.invoke(
    {"topic": "cats"},
    config={"callbacks": [langfuse_handler]})
```

- [Full LangChain SDK documentation](/integrations/frameworks/langchain)
- [Notebook](https://colab.research.google.com/github/langfuse/langfuse-docs/blob/main/cookbook/integration_langchain.ipynb)

</Tab>

<Tab>

Langfuse's LangChain integration uses a callback handler to record and send traces to Langfuse. If you already use LangChain, you can start using Langfuse with minimal changes to your code.

First install the Langfuse core SDK and the LangChain integration.

```bash
npm install @langfuse/core @langfuse/langchain
```

Add your Langfuse credentials as environment variables so the integration knows which project to send your traces to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

**Initialize OpenTelemetry**

Install the OpenTelemetry SDK, which the Langfuse integration uses under the hood to capture the data from each OpenAI call.

```bash
npm install @opentelemetry/sdk-node
```

Next is initializing the Node SDK. You can do that either in a dedicated instrumentation file or directly at the top of your main file.

<LangTabs items={["Inline setup", "Instrumentation file"]}>

<Tab>

The inline setup is the simplest way to get started. It works well for projects where your main file is executed first and import order is straightforward.

We can now initialize the `LangfuseSpanProcessor` and start the SDK. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

Important: start the SDK before initializing the logic that needs to be traced to avoid losing data.

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

</Tab>

<Tab>

The instrumentation file often preferred when you're using frameworks that have complex startup order (Next.js, serverless, bundlers) or if you want a clean, predictable place where tracing is always initialized first.

Create an `instrumentation.ts` file, which sets up the _collector_ that gathers data about each OpenAI call. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

```ts filename="instrumentation.ts" /LangfuseSpanProcessor/
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

Import the `instrumentation.ts` file first so all later imports run with tracing enabled.

```ts filename="index.ts"
import './instrumentation' // Must be the first import
```

</Tab>

</LangTabs>

Finally, initialize the Langfuse `CallbackHandler` and add it to your chain. The `CallbackHandler` listens to the LangChain agent's actions and prepares that information to be sent to Langfuse.

```typescript
import { CallbackHandler } from '@langfuse/langchain'

// Initialize the Langfuse CallbackHandler
const langfuseHandler = new CallbackHandler()
```

The line `{ callbacks: [langfuseHandler] }` is what attaches the `CallbackHandler` to the agent.

```typescript /{ callbacks: [langfuseHandler] }/
import { createAgent, tool } from '@langchain/core/agents'
import * as z from 'zod'

const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
  name: 'get_weather',
  description: 'Get the weather for a given city',
  schema: z.object({
    city: z.string().describe('The city to get the weather for')
  })
})

const agent = createAgent({
  model: 'openai:gpt-5-mini',
  tools: [getWeather]
})

console.log(
  await agent.invoke(
    { messages: [{ role: 'user', content: "What's the weather in San Francisco?" }] },
    { callbacks: [langfuseHandler] }
  )
)
```

- [Full Langchain SDK documentation](/integrations/frameworks/langchain)

</Tab>

<Tab>

The Langfuse Python SDK gives you full control over how you instrument your application and can be used with any other framework.

**1. Install package:**

```bash
pip install langfuse
```

**2. Add credentials:**

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

**3. Instrument your application:**

Instrumentation means adding code that records what’s happening in your application so it can be sent to Langfuse. There are three main ways of instrumenting your code with the Python SDK.

In this example we will use the [context manager](/docs/observability/sdk/instrumentation#context-manager). You can also use the [decorator](/docs/observability/sdk/instrumentation#observe-wrapper) or create [manual observations](/docs/observability/sdk/instrumentation#manual-observations).

```python
from langfuse import get_client

langfuse = get_client()

# Create a span using a context manager
with langfuse.start_as_current_observation(as_type="span", name="process-request") as span:
    # Your processing logic here
    span.update(output="Processing complete")

    # Create a nested generation for an LLM call
    with langfuse.start_as_current_observation(as_type="generation", name="llm-response", model="gpt-3.5-turbo") as generation:
        # Your LLM call logic here
        generation.update(output="Generated response")

# All spans are automatically closed when exiting their context blocks


# Flush events in short-lived applications
langfuse.flush()
```

_[When should I call `langfuse.flush()`?](/docs/observability/data-model#background-processing)_

**4. Run your application and see the trace in Langfuse:**

<Frame>
![First trace in Langfuse](/images/docs/observability/first-trace-python.png)
</Frame>

See the [trace in Langfuse](https://cloud.langfuse.com/project/cloramnkj0002jz088vzn1ja4/traces/b8789d62464dc7627016d9748a48ad0d?observation=5c7c133ec919ded7&timestamp=2025-12-03T14:56:19.285Z).

- [Full Python SDK documentation](/docs/sdk/python/sdk-v3)

</Tab>

<Tab>

Use the Langfuse JS/TS SDK to wrap any LLM or Agent

**Install packages**

Install the Langfuse tracing SDK, the Langfuse OpenTelemetry integration, and the OpenTelemetry Node SDK.

```sh
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

**Add credentials**

Add your Langfuse credentials to your environment variables so the tracing SDK knows which Langfuse project it should send your recorded data to.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

**Initialize OpenTelemetry**

Install the OpenTelemetry SDK, which the Langfuse integration uses under the hood to capture the data from each OpenAI call.

```bash
npm install @opentelemetry/sdk-node
```

Next is initializing the Node SDK. You can do that either in a dedicated instrumentation file or directly at the top of your main file.

<LangTabs items={["Inline setup", "Instrumentation file"]}>

<Tab>

The inline setup is the simplest way to get started. It works well for projects where your main file is executed first and import order is straightforward.

We can now initialize the `LangfuseSpanProcessor` and start the SDK. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

Important: start the SDK before initializing the logic that needs to be traced to avoid losing data.

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

</Tab>

<Tab>

The instrumentation file often preferred when you're using frameworks that have complex startup order (Next.js, serverless, bundlers) or if you want a clean, predictable place where tracing is always initialized first.

Create an `instrumentation.ts` file, which sets up the _collector_ that gathers data about each OpenAI call. The `LangfuseSpanProcessor` is the part that takes that collected data and sends it to your Langfuse project.

```ts filename="instrumentation.ts" /LangfuseSpanProcessor/
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()]
})

sdk.start()
```

Import the `instrumentation.ts` file first so all later imports run with tracing enabled.

```ts filename="index.ts"
import './instrumentation' // Must be the first import
```

</Tab>

</LangTabs>

**Instrument application**

Instrumentation means adding code that records what’s happening in your application so it can be sent to Langfuse. Here, OpenTelemetry acts as the system that collects those recordings.

```ts filename="server.ts"
import { startActiveObservation, startObservation } from '@langfuse/tracing'

// startActiveObservation creates a trace for this block of work.
// Everything inside automatically becomes part of that trace.
await startActiveObservation('user-request', async (span) => {
  span.update({
    input: { query: 'What is the capital of France?' }
  })

  // This generation will automatically be a child of "user-request" because of the startObservation function.
  const generation = startObservation(
    'llm-call',
    {
      model: 'gpt-4',
      input: [{ role: 'user', content: 'What is the capital of France?' }]
    },
    { asType: 'generation' }
  )

  // ... your real LLM call would happen here ...

  generation
    .update({
      output: { content: 'The capital of France is Paris.' } // update the output of the generation
    })
    .end() // mark this nested observation as complete

  // Add final information about the overall request
  span.update({ output: 'Successfully answered.' })
})
```

- [Full JS/TS SDK documentation](/docs/sdk/typescript/guide)
- [Notebook](/docs/sdk/typescript/example-notebook)

</Tab>

<Tab>

If your app, framework, or collector already emits OpenTelemetry (OTEL) spans,
use the Langfuse OpenTelemetry integration to send OTLP traces to Langfuse.
This is the right entry point for custom OTEL setups and languages beyond the
Langfuse SDKs.

- [OpenTelemetry (OTEL) guide](/integrations/native/opentelemetry)
- [Attribute propagation](/integrations/native/opentelemetry#propagating-attributes)

</Tab>

<Tab>

Explore all integrations and frameworks that Langfuse supports.

- [OpenTelemetry (OTEL)](/integrations/native/opentelemetry)
- [Vercel AI SDK](/integrations/frameworks/vercel-ai-sdk)
- [Llamaindex](/integrations/frameworks/llamaindex)
- [CrewAI](/integrations/frameworks/crewai)
- [Ollama](/integrations/model-providers/ollama)
- [LiteLLM](/integrations/gateways/litellm)
- [AutoGen](/integrations/frameworks/autogen)
- [Google ADK](/integrations/frameworks/google-adk)
- [All integrations](/integrations)

</Tab>

</LangTabs>

### See your trace in Langfuse

After running your application, visit the Langfuse interface to view the trace you just created. _[(Example LangGraph trace in Langfuse)](https://cloud.langfuse.com/project/cloramnkj0002jz088vzn1ja4/traces/7d5f970573b8214d1ca891251e42282c)_

_[What does a good trace look like?](/docs/observability/best-practices)_

</Steps>

## Not seeing what you expected?

If your trace looks overly complicated or overwhelming, the tracing setup itself may need a second look. Compare it against our [best practices guide](/docs/observability/best-practices).

## Next steps

Now that your first trace is in Langfuse, learn to make sense of your traces by reading the chapter on [Monitoring in the Langfuse Academy](/academy/monitoring).

Or if you know exactly what you're looking for, here are the most common features:

- [Group traces into sessions for multi-turn applications](/docs/observability/features/sessions)
- [Attribute traces to individual users](/docs/observability/features/users)
- [Add attributes to your traces so you can filter them later](/docs/observability/features/tags)
- [Track model usage and cost](/docs/observability/features/token-and-cost-tracking)
- [Monitor application quality with scores](/docs/evaluation/scores/overview)
- [Get notified when a metric crosses a threshold with alerts](/docs/observability/features/alerts)
- [Analyze cost, latency, volume, and quality in custom dashboards](/docs/metrics/features/custom-dashboards)

Take a look under [Features](#sidebar-folder-docs-observability-features) in the sidebar for guides on specific topics.

<!-- agent-instructions -->

---

## Agent Instructions

This page is part of the [Langfuse](https://langfuse.com) documentation, published as plain Markdown for AI agents. Every page is available as Markdown by appending `.md` to its URL, or by sending an `Accept: text/markdown` header. This page: `https://langfuse.com/docs/observability/get-started.md`.

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

---

---

title: Get Started
sidebarTitle: Get Started
description: Get started with Langfuse Prompt Management.
---

# Get Started with Prompt Management

This guide walks you through creating and using a prompt with Langfuse. If you're looking to understand what prompt management is and why it matters, check out the [Prompt Management Overview](/docs/prompt-management/overview) first. For details on how prompts are structured in Langfuse and how it works in the background, see [Core Concepts](/docs/prompt-management/data-model).

h2]:mt-6 [&>h2]:mb-4">

## Agentic installation [#agentic-installation]

Install the [Langfuse Agent Skill](https://github.com/langfuse/skills) to let your coding agent access all Langfuse features.

<Tabs items={["Ask your coding agent", "Cursor plugin", "Manual installation"]}>

<Tab>

Ask your coding agent to install the skill by pointing to the [GitHub repository](https://github.com/langfuse/skills) and instruct it to migrate your prompts.

```txt filename="Agent instruction"
Install the Langfuse Agent Skill from github.com/langfuse/skills
and use it to migrate the prompts in this codebase to Langfuse.
```

</Tab>

<Tab>

Langfuse has a [Cursor Plugin](https://cursor.com/docs/plugins) that includes the skill automatically.

  <Button asChild>
    <Link
      href="https://cursor.com/marketplace/langfuse"
      target="_blank"
      rel="noopener noreferrer"
    >
      Install Plugin in Cursor
    </Link>
  </Button>

Then prompt your agent:

```txt filename="Agent instruction"
Migrate the prompts in this codebase to Langfuse.
```

</Tab>

<Tab>

Install via npm ([skills CLI](https://www.npmjs.com/package/skills)):

```bash
npx skills add langfuse/skills --skill "langfuse"
```

If you want to target a specific agent directly:

```bash
npx skills add langfuse/skills --skill "langfuse" --agent "<agent-id>"
```

<Details>
<Summary>Alternatively you can manually clone the skill</Summary>

1. Clone repo somewhere stable

```bash
git clone https://github.com/langfuse/skills.git /path/to/langfuse-skills
```

2. Make sure your agent's skills dir exists

```bash
mkdir -p /path/to/<agent-skill-root>/skills
```

3. Symlink the skill folder

```bash
ln -s /path/to/langfuse-skills/skills/langfuse /path/to/<agent-skill-root>/skills/langfuse
```

</Details>

Then prompt your agent:

```txt filename="Agent instruction"
Migrate the prompts in this codebase to Langfuse.
```

</Tab>

</Tabs>

## Manual installation [#manual-installation]

This guide helps you get started with Langfuse Prompt Management manually.

<Steps>
### Get API keys

1.  [Create Langfuse account](https://langfuse.com/cloud) or [self-host Langfuse](/self-hosting).
2.  Create new API credentials in the project settings.

### Create a prompt [#create-update-prompt-diy]

<LangTabs items={["Langfuse UI", "Python SDK", "JS/TS SDK", "API", "Migrate from existing code"]}>
<Tab>

Use the Langfuse UI to create a new prompt or update an existing one. You'll need to select the [prompt type](/docs/prompt-management/data-model#text-vs-chat-prompts), you can't change this afterwards.

</Tab>
<Tab>

```bash
pip install langfuse
```

Add your Langfuse credentials as environment variables so the SDK knows which project to create the prompt in.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

Use the Python SDK to create a new prompt or update an existing one.

```python
# Create a text prompt
langfuse.create_prompt(
    name="movie-critic",
    type="text",
    prompt="As a {{criticlevel}} movie critic, do you like {{movie}}?",
    labels=["production"]  # optionally, directly promote to production
)

# Create a chat prompt
langfuse.create_prompt(
    name="movie-critic-chat",
    type="chat",
    prompt=[
      { "role": "system", "content": "You are an {{criticlevel}} movie critic" },
      { "role": "user", "content": "Do you like {{movie}}?" },
    ],
    labels=["production"]  # optionally, directly promote to production
)
```

If you already have a prompt with the same `name`, the prompt will be added as a new version.

</Tab>

<Tab>

```bash
npm i @langfuse/client
```

Add your Langfuse credentials as environment variables so the SDK knows which project to create the prompt in.

```bash filename=".env"
LANGFUSE_SECRET_KEY = "sk-lf-..."
LANGFUSE_PUBLIC_KEY = "pk-lf-..."
LANGFUSE_BASE_URL = "https://cloud.langfuse.com" # 🇪🇺 EU region
# Other Langfuse data regions include 🇺🇸 US: https://us.cloud.langfuse.com, 🇯🇵 Japan: https://jp.cloud.langfuse.com and ⚕️ HIPAA: https://hipaa.cloud.langfuse.com
```

```ts
import { LangfuseClient } from '@langfuse/client'

const langfuse = new LangfuseClient()
```

Use the JS/TS SDK to create a new prompt or update an existing one.

```ts
// Create a text prompt
await langfuse.prompt.create({
  name: 'movie-critic',
  type: 'text',
  prompt: 'As a {{criticlevel}} critic, do you like {{movie}}?',
  labels: ['production'] // optionally, directly promote to production
})

// Create a chat prompt
await langfuse.prompt.create({
  name: 'movie-critic-chat',
  type: 'chat',
  prompt: [
    { role: 'system', content: 'You are an {{criticlevel}} movie critic' },
    { role: 'user', content: 'Do you like {{movie}}?' }
  ],
  labels: ['production'] // optionally, directly promote to production
})
```

If you already have a prompt with the same `name`, the prompt will be added as a new version.

</Tab>

<Tab>

Use the [Public API](https://api.reference.langfuse.com/#tag/prompts/post/api/public/v2/prompts) to create a new prompt or update an existing one.

```bash
curl -X POST "https://cloud.langfuse.com/api/public/v2/prompts" \
  -u "your-public-key:your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "chat",
    "name": "movie-critic",
    "prompt": [
      { "role": "system", "content": "You are an {{criticlevel}} movie critic" },
      { "role": "user", "content": "Do you like {{movie}}?" }
    ]
  }'

```

- [API Reference](https://api.reference.langfuse.com/#tag/prompts/POST/api/public/v2/prompts)

</Tab>

<Tab>

If you have prompts in your existing codebase, you can migrate them to Langfuse programmatically.

**Using the Langfuse Skill**

1. Install the [Langfuse Skill](https://github.com/langfuse/skills):

```bash
# Cursor plugin
/add-plugin langfuse

# skills CLI
npx skills add langfuse/skills --skill "langfuse"

# Manual: clone and symlink
git clone https://github.com/langfuse/skills.git /path/to/langfuse-skills
ln -s /path/to/langfuse-skills/skills/langfuse ~/.skills/langfuse
```

2. Ask the agent to migrate your prompts:

```
Migrate the hardcoded prompts in this codebase to Langfuse prompt management.
```

**Using the API**

You can write a script that reads your existing prompts and creates them in Langfuse using the [Public API](https://api.reference.langfuse.com/#tag/prompts/post/api/public/v2/prompts). This is ideal for bulk migrations or CI/CD integration.

- [API Reference](https://api.reference.langfuse.com/#tag/prompts/POST/api/public/v2/prompts)

Things to look out for

- Langfuse uses a specific syntax for [variables, prompt references, and message placeholders](/docs/prompt-management/data-model#dynamic-rendering-of-prompts). Make sure to update your prompts to use the correct format, if you want to use Langfuse's dynamic rendering capabilities.

</Tab>

</LangTabs>

### Use the prompt in your code [#use-prompt-diy]

At runtime, you can fetch the prompt from Langfuse. We recommend using the `production` label to fetch the version intentionally chosen for production. Learn more about control (versions/labels) [here](/docs/prompt-management/features/prompt-version-control).

<LangTabs items={["Python SDK", "JS/TS SDK", "API", "OpenAI SDK (Python)", "OpenAI SDK (JS/TS)", "Langchain (Python)", "Langchain (JS)", "Vercel AI SDK"]}>
<Tab>

```python
from langfuse import get_client

# Initialize Langfuse client
langfuse = get_client()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

**Text prompt**

```python
# By default, the production version is fetched.
prompt = langfuse.get_prompt("movie-critic")

# Insert variables into prompt template
compiled_prompt = prompt.compile(criticlevel="expert", movie="Dune 2")
# -> "As an expert movie critic, do you like Dune 2?"
```

**Chat prompt**

```python
# By default, the production version of a chat prompt is fetched.
chat_prompt = langfuse.get_prompt("movie-critic-chat", type="chat") # type arg infers the prompt type (default is 'text')

# Insert variables into chat prompt template
compiled_chat_prompt = chat_prompt.compile(criticlevel="expert", movie="Dune 2")
# -> [{"role": "system", "content": "You are an expert movie critic"}, {"role": "user", "content": "Do you like Dune 2?"}]
```

</Tab>

<Tab>

```ts
import { LangfuseClient } from '@langfuse/client'

// Initialize the Langfuse client
const langfuse = new LangfuseClient()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

**Text prompt**

```ts
// By default, the production version of a text prompt is fetched.
const prompt = await langfuse.prompt.get('movie-critic')

// Insert variables into prompt template
const compiledPrompt = prompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})
// -> "As an expert movie critic, do you like Dune 2?"
```

**Chat prompt**

```ts
// By default, the production version of a chat prompt is fetched.
const chatPrompt = await langfuse.prompt.get('movie-critic-chat', {
  type: 'chat'
}) // type option infers the prompt type (default is 'text')

// Insert variables into chat prompt template
const compiledChatPrompt = chatPrompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})
// -> [{"role": "system", "content": "You are an expert movie critic"}, {"role": "user", "content": "Do you like Dune 2?"}]
```

</Tab>

<Tab>

Use the [Public API](https://api.reference.langfuse.com/#tag/prompts/get/api/public/v2/prompts/{promptName}) to fetch a prompt at runtime. By default, the prompt labeled `production` is returned.

```bash
curl "https://cloud.langfuse.com/api/public/v2/prompts/movie-critic?label=production" \
  -u "your-public-key:your-secret-key"
```

For fetching a specific version instead of a label:

```bash
curl "https://cloud.langfuse.com/api/public/v2/prompts/movie-critic?version=1" \
  -u "your-public-key:your-secret-key"
```

- [API Reference](https://api.reference.langfuse.com/#tag/prompts/get/api/public/v2/prompts/{promptName})

</Tab>

<Tab>

```bash
pip install langfuse openai
```

```python
import openai
from langfuse import get_client

# Initialize Langfuse client
langfuse = get_client()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

**Text prompt**

```python
# By default, the production version of a text prompt is fetched.
prompt = langfuse.get_prompt("movie-critic")

# Compile the prompt with variables
compiled_prompt = prompt.compile(criticlevel="expert", movie="Dune 2")

# Use with OpenAI - prompt is a string
completion = openai.chat.completions.create(
  model="gpt-4o",
  messages=[{"role": "user", "content": compiled_prompt}]
)
```

**Chat prompt**

```python
# By default, the production version of a chat prompt is fetched.
chat_prompt = langfuse.get_prompt("movie-critic-chat", type="chat")

# Compile the prompt with variables - returns a list of message dicts
compiled_chat_prompt = chat_prompt.compile(criticlevel="expert", movie="Dune 2")

# Use with OpenAI - prompt is a list of messages
completion = openai.chat.completions.create(
  model="gpt-4o",
  messages=compiled_chat_prompt
)
```

**Example notebook**

- [Example Cookbook](/guides/cookbook/prompt_management_openai_functions)

</Tab>

<Tab>

```bash
npm install @langfuse/openai openai
```

```typescript
import { observeOpenAI } from '@langfuse/openai'
import { LangfuseClient } from '@langfuse/client'
import OpenAI from 'openai'

// Initialize Langfuse client
const langfuse = new LangfuseClient()

// Wrap OpenAI client
const openai = observeOpenAI(new OpenAI())
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

**Text prompt**

```typescript
// By default, the production version of a text prompt is fetched.
const prompt = await langfuse.prompt.get('movie-critic', {
  type: 'text'
})

// Compile the prompt with variables
const compiledPrompt = prompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})

// Use with OpenAI - prompt is a string
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: compiledPrompt }]
})
```

**Chat prompt**

```typescript
// By default, the production version of a chat prompt is fetched.
const chatPrompt = await langfuse.prompt.get('movie-critic-chat', {
  type: 'chat'
})

// Compile the prompt with variables - returns an array of messages
const compiledChatPrompt = chatPrompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})

// Use with OpenAI - prompt is an array of messages
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: compiledChatPrompt
})
```

</Tab>

<Tab>

```python
from langfuse import Langfuse
from langchain_core.prompts import ChatPromptTemplate

# Initialize Langfuse client
langfuse = Langfuse()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

These examples contain [variables](/docs/prompt-management/features/variables). As Langfuse and Langchain process input variables of prompt templates differently (`{}` instead of `{{}}`), we provide the `prompt.get_langchain_prompt()` method to transform the Langfuse prompt into a string that can be used with Langchain's PromptTemplate. You can pass optional keyword arguments to `prompt.get_langchain_prompt(**kwargs)` in order to precompile some variables and handle the others with Langchain's PromptTemplate.

**Text prompt**

```python
# By default, the production version of a text prompt is fetched.
langfuse_prompt = langfuse.get_prompt("movie-critic")

# Example using ChatPromptTemplate
langchain_prompt = ChatPromptTemplate.from_template(langfuse_prompt.get_langchain_prompt())

# Example using ChatPromptTemplate with pre-compiled variables.
langchain_prompt = ChatPromptTemplate.from_template(langfuse_prompt.get_langchain_prompt(strictness='tough'))
```

**Chat prompt**

```python
# By default, the production version of a chat prompt is fetched.
langfuse_prompt = langfuse.get_prompt("movie-critic-chat", type="chat")

# Create a Langchain ChatPromptTemplate from the Langfuse prompt chat messages
langchain_prompt = ChatPromptTemplate.from_messages(langfuse_prompt.get_langchain_prompt())
```

**Example notebook**

- [Example Cookbook](/guides/cookbook/prompt_management_langchain)

</Tab>

<Tab>

```ts
import { LangfuseClient } from '@langfuse/client'
import { ChatPromptTemplate } from '@langchain/core/prompts'

const langfuse = new LangfuseClient()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

These examples contain [variables](/docs/prompt-management/features/variables). As Langfuse and Langchain process input variables of prompt templates differently (`{}` instead of `{{}}`), we provide the `prompt.get_langchain_prompt()` method to transform the Langfuse prompt into a string that can be used with Langchain's PromptTemplate. You can pass optional keyword arguments to `prompt.get_langchain_prompt(**kwargs)` in order to precompile some variables and handle the others with Langchain's PromptTemplate.

**Text prompt**

```ts
// Get current `production` version
const langfusePrompt = await langfuse.prompt.get('movie-critic')

// Example using ChatPromptTemplate
const promptTemplate = PromptTemplate.fromTemplate(langfusePrompt.getLangchainPrompt())
```

**Chat prompt**

```ts
// Get current `production` version of a chat prompt
const langfusePrompt = await langfuse.prompt.get('movie-critic-chat', { type: 'chat' })

// Example using ChatPromptTemplate
const promptTemplate = ChatPromptTemplate.fromMessages(
  langfusePrompt.getLangchainPrompt().map((msg) => [msg.role, msg.content])
)
```

**Example notebook**

- [Example Cookbook.](/guides/cookbook/js_prompt_management_langchain)

</Tab>

<Tab>

Use Langfuse Prompt Management with the Vercel AI SDK.

```bash
npm install @langfuse/client ai
```

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { LangfuseClient } from '@langfuse/client'

// Initialize Langfuse client
const langfuse = new LangfuseClient()
```

Below are code examples for both a text type prompt and a chat type prompt. Learn more about prompt types [here](/docs/prompt-management/data-model#text-vs-chat-prompts).

**Text prompt**

```typescript
// By default, the production version of a text prompt is fetched.
const prompt = await langfuse.prompt.get('movie-critic', {
  type: 'text'
})

// Compile the prompt with variables
const compiledPrompt = prompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})

// Use with Vercel AI SDK
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: compiledPrompt,
  experimental_telemetry: {
    isEnabled: true
  }
})
```

**Chat prompt**

```typescript
// By default, the production version of a chat prompt is fetched.
const chatPrompt = await langfuse.prompt.get('movie-critic-chat', {
  type: 'chat'
})

// Compile the prompt with variables - returns an array of messages
const compiledChatPrompt = chatPrompt.compile({
  criticlevel: 'expert',
  movie: 'Dune 2'
})

// Use with Vercel AI SDK
const result = await generateText({
  model: openai('gpt-4o'),
  messages: compiledChatPrompt,
  experimental_telemetry: {
    isEnabled: true
  }
})
```

</Tab>

</LangTabs>

Not seeing your latest version? This might be because of the caching behavior. See [prompt caching](/docs/prompt-management/data-model#prompt-caching) for more details.

Prompt Management is not on the critical path of your application. The SDKs [cache prompts client-side](/docs/prompt-management/features/caching), so after the first fetch they are served from memory with no extra latency. If Langfuse goes down, your application continues to use the cached prompt.

If you need 100% availability even when a new instance starts with an empty cache, see [guaranteed availability](/docs/prompt-management/features/guaranteed-availability).

</Steps>

## Not seeing what you expected?

## Next steps

Now that you've used your first prompt, here are a few things we recommend next to make the most of Langfuse Prompt Management:

- [Link prompts to traces](/docs/prompt-management/features/link-to-traces) to analyze performance by prompt version
- [Improve prompts with experiments](/docs/evaluation/experiments/experiments-via-ui) to test prompt versions on a dataset
- [Use version control and labels](/docs/prompt-management/features/prompt-version-control#protected-prompt-labels) to manage deployments across environments

Looking for something specific? Take a look under _Features_ for guides on specific topics.

<!-- agent-instructions -->

---

## Agent Instructions

This page is part of the [Langfuse](https://langfuse.com) documentation, published as plain Markdown for AI agents. Every page is available as Markdown by appending `.md` to its URL, or by sending an `Accept: text/markdown` header. This page: `https://langfuse.com/docs/prompt-management/get-started.md`.

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

---

---

title: Overview
seoTitle: "Evaluation of LLM Applications"
description: With Langfuse you can capture all your LLM evaluations in one place. You can combine a variety of different evaluation metrics like model-based evaluations (LLM-as-a-Judge), human annotations or fully custom evaluation workflows via API/SDKs. This allows you to measure quality, tonality, factual accuracy, completeness, and other dimensions of your LLM application.
---

# Evaluation Overview

Evals give you a repeatable check of your LLM application's behavior. You replace guesswork with data, and catch regressions before you ship a change.

<Frame fullWidth>
  <img src="/images/docs/score-analytics-full-dashboard.png" alt="Score Analytics dashboard in Langfuse showing evaluation scores trended over time across multiple evaluators." />
</Frame>

Evaluation runs across most of the [AI engineering loop](/academy/ai-engineering-loop): you score live traces in production, turn interesting examples into datasets, run experiments to compare changes, and judge the results with manual or automated evaluators. It happens both **online**, on live production traces, and **offline**, before you ship a change.

The AI Engineering Loop:

- [Trace](/academy/tracing): traces, sessions, agents, prompts
- [Monitor](/academy/monitoring): dashboards, LLM-as-judge, feedback
- [Build datasets](/academy/datasets): datasets, features-as-tests
- [Experiment](/academy/experiments): prompts, models, code variants
- [Evaluate](/academy/evaluate): judges, custom evals, annotation

Want to see it in action? [**Create a free account**](/cloud) and explore Langfuse Evaluation in the [interactive example project](/docs/demo).

## Getting Started

Start with the [Core Concepts](/docs/evaluation/core-concepts) page. It explains how evaluators, scores, datasets, and experiments fit together in Langfuse, which makes the rest of the docs much easier to navigate.

Once you have that context, use the table below to find the right feature page:

| If you want to...                                   | Use this Langfuse feature                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review and rate traces manually                     | [Annotation Queues](/docs/evaluation/evaluation-methods/annotation-queues), [Scores via UI](/docs/evaluation/evaluation-methods/scores-via-ui)                                                                                              |
| Collect feedback from your end users                | [User Feedback](/docs/observability/features/user-feedback)                                                                                                                                                                                 |
| Leave open-ended notes on traces                    | [Text scores](/docs/evaluation/scores/overview#score-types), [Annotation Queues](/docs/evaluation/evaluation-methods/annotation-queues)                                                                                                     |
| Build a reusable set of test cases                  | [Datasets](/docs/evaluation/experiments/datasets)                                                                                                                                                                                           |
| Compare prompt, model, or code changes side by side | [Experiments via UI](/docs/evaluation/experiments/experiments-via-ui), [Experiments via SDK](/docs/evaluation/experiments/experiments-via-sdk), [Experiments via OpenTelemetry](/docs/evaluation/experiments/experiments-via-opentelemetry) |
| Block deploys on regressions                        | [CI/CD experiments](/docs/evaluation/experiments/experiments-ci-cd)                                                                                                                                                                         |
| Run deterministic checks                            | [Code Evaluators](/docs/evaluation/evaluation-methods/code-evaluators)                                                                                                                                                                      |
| Automatically score live production traces          | [LLM-as-a-Judge](/docs/evaluation/evaluation-methods/llm-as-a-judge), [Scores via API/SDK](/docs/evaluation/evaluation-methods/scores-via-sdk)                                                                                              |
| See how scores trend over time                      | [Score Analytics](/docs/evaluation/scores/score-analytics), [custom dashboards](/docs/metrics/features/custom-dashboards)                                                                                                                   |

Already know what you're looking for? Browse _Evaluation Methods_ and _Experiments_ in the sidebar.

## GitHub Discussions

<!-- agent-instructions -->

---

## Agent Instructions

This page is part of the [Langfuse](https://langfuse.com) documentation, published as plain Markdown for AI agents. Every page is available as Markdown by appending `.md` to its URL, or by sending an `Accept: text/markdown` header. This page: `https://langfuse.com/docs/evaluation/overview.md`.

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
