---
title: Overview
description: Langfuse is an open-source AI engineering platform (GitHub) that helps teams collaboratively debug, analyze, and iterate on their AI agent applications. All platform features are natively integrated to accelerate the development workflow.
---

# Langfuse Overview

Langfuse is an open-source AI engineering platform ([GitHub](https://github.com/langfuse/langfuse)) that helps teams collaboratively debug, analyze, and iterate on their AI agent applications. All platform features are natively integrated to accelerate the development workflow. Langfuse is open, self-hostable, and extensible ([_why Langfuse?_](/why)).

## Observability [#observability]

[Observability](/docs/observability/overview) is essential for understanding and debugging AI agent applications. Unlike traditional software, AI agent applications involve complex, non-deterministic interactions that can be challenging to monitor and debug. Langfuse provides comprehensive tracing capabilities that help you understand exactly what's happening in your application.

- Traces include all LLM and non-LLM calls, including retrieval, embedding, API calls, and more
- Support for tracking multi-turn conversations as sessions and user tracking
- Agents can be represented as graphs
- Capture traces via our native SDKs for Python/JS, 100+ library/framework integrations, OpenTelemetry, or via an LLM Gateway such as LiteLLM
- Based on OpenTelemetry to increase compatibility and reduce vendor lock-in

[Create a free account](/cloud) and explore Langfuse Observability in the [interactive example project](/docs/demo).

<Tabs items={["Trace Details", "Sessions", "Timeline", "Users", "Agent Graphs", "Dashboard", "Alerts"]}>
<Tab>

Traces allow you to track every LLM call and other relevant logic in your app.

</Tab>
<Tab>

Sessions allow you to track multi-step conversations or agentic workflows.

</Tab>
<Tab>

Debug latency issues by inspecting the timeline view.

</Tab>

<Tab>

Add your own `userId` to monitor costs and usage for each user. Optionally, create a deep link to this view in your systems.

</Tab>
<Tab>

LLM agents can be visualized as a graph to illustrate the flow of complex agentic workflows.

</Tab>
<Tab>

See quality, cost, and latency metrics in the dashboard to monitor your LLM application.

</Tab>
<Tab>

Get notified over Slack, GitHub Actions, or Webhooks when a metric crosses a threshold with [alerts](/docs/observability/features/alerts).

<Frame fullWidth>
  <img
    src="/images/docs/monitors-list.png"
    alt="Alerts list showing severity, name, and tags for each alert"
  />
</Frame>

</Tab>

</Tabs>

## Prompt Management [#prompts]

[Prompt Management](/docs/prompt-management/overview) is critical in building effective AI applications. Langfuse provides tools to help you manage, version, and optimize your prompts throughout the development lifecycle.

- [Get started](/docs/prompt-management/get-started) with prompt management
- Manage, version, and optimize your prompts throughout the development lifecycle
- Test prompts interactively in the [LLM Playground](/docs/prompt-management/features/playground)
- Run [Experiments](/docs/evaluation/features/prompt-experiments) against datasets to test new prompt versions directly within Langfuse

Want to see it in action? [**Create a free account**](/cloud) and explore Langfuse Prompt Management in the [interactive example project](/docs/demo).

<Tabs items={["Create", "Version Control", "Deploy", "Metrics", "Test in Playground", "Link with Traces", "Track Changes"]}>

<Tab>

Create a new prompt via UI, SDKs, or API.

</Tab>

<Tab>

Collaboratively version and edit prompts via UI, API, or SDKs.

</Tab>
<Tab>

Deploy prompts to production or any environment via labels - without any code changes.

</Tab>
<Tab>

Compare latency, cost, and evaluation metrics across different versions of your prompts.

</Tab>
<Tab>

Instantly test your prompts in the playground.

</Tab>
<Tab>

Link prompts with traces to understand how they perform in the context of your LLM application.

</Tab>
<Tab>

Track changes to your prompts to understand how they evolve over time.

</Tab>
</Tabs>

## Evaluation [#evaluation]

[Evaluation](/docs/evaluation/overview) is crucial for ensuring the quality and reliability of your LLM applications. Langfuse provides flexible evaluation tools that adapt to your specific needs, whether you're testing in development or monitoring production performance.

- Get started with different [evaluation methods](/docs/evaluation/overview): LLM-as-a-judge, code evaluators, user feedback, manual labeling, or custom pipelines
- Identify issues early by running evaluations on production traces
- Create and manage [Datasets](/docs/evaluation/features/datasets) for systematic testing in development that ensure your application performs reliably across different scenarios
- Run [Experiments](/docs/evaluation/core-concepts#experiments) to systematically test your LLM application

Want to see it in action? [**Create a free account**](/cloud) and explore Langfuse Evaluation in the [interactive example project](/docs/demo).

<Tabs items={["Analytics", "User Feedback", "LLM-as-a-Judge", "Experiments", "Annotation Queue", "Custom Evals"]}>
<Tab>

Plot evaluation results in the Langfuse Dashboard.

</Tab>
<Tab>

Collect feedback from your users. Can be captured in the frontend via our Browser SDK, server-side via the SDKs or API. Video includes example application.

</Tab>
<Tab>

Run fully managed LLM-as-a-judge evaluations on production or development traces. Can be applied to any step within your application for step-wise evaluations.

</Tab>
<Tab>

Evaluate prompts and models on datasets directly in the user interface. No custom code is needed.

</Tab>

<Tab>

Baseline your evaluation workflow with human annotations via Annotation Queues.

</Tab>
<Tab>

Add custom evaluation results, supports numeric, boolean and categorical values.

```bash
POST /api/public/scores
```

Add scores via Python or JS SDK.

```python filename="Example (Python)"
langfuse.score(
  trace_id="123",
  name="my_custom_evaluator",
  value=0.5,
)
```

</Tab>
</Tabs>

## Where to start?

Setting up the full process of online tracing, prompt management, production evaluations to identify issues, and offline evaluations on datasets requires some time. Most teams eventually end up with a process that looks like this:

The AI Engineering Loop:

- [Trace](/academy/tracing): traces, sessions, agents, prompts
- [Monitor](/academy/monitoring): dashboards, LLM-as-judge, feedback
- [Build datasets](/academy/datasets): datasets, features-as-tests
- [Experiment](/academy/experiments): prompts, models, code variants
- [Evaluate](/academy/evaluate): judges, custom evals, annotation

If you're new to AI engineering, take a look at the [Academy](/academy), where you'll find conceptual guidance on how to approach AI engineering, trade-offs, and best practices. If you already know what you want, [the getting-started guides below](#quickstarts) will get you going.

Tip: let your coding agent do the setup and work with Langfuse through the [Agent Skill](/docs/api-and-data-platform/features/agent-skill), [CLI](/docs/api-and-data-platform/features/cli), or [MCP server](/docs/api-and-data-platform/features/mcp-server). On Langfuse Cloud, you can also ask the [Langfuse Assistant](/docs/langfuse-assistant) about your project data from inside the app.

## Quickstarts [#quickstarts]

Get up and running with Langfuse in minutes. Choose the path that best fits your current needs:

- [Integrate LLM Application/Agent Tracing](/docs/observability/get-started)
- [Integrate Prompt Management](/docs/prompt-management/get-started)
- [Setup Evaluations](/docs/evaluation/overview)

## Why Langfuse?

- **Open source:** Fully open source with public API for custom integrations
- **Production optimized:** Designed with minimal performance overhead
- **Best-in-class SDKs:** Native SDKs for Python and JavaScript
- **Framework support:** Integrated with popular frameworks like OpenAI SDK, LangChain, and LlamaIndex
- **Multi-modal:** Support for tracing text, images and other modalities
- **Full platform:** Suite of tools for the complete LLM application development lifecycle

## Community & Contact

We actively develop Langfuse in [open source](/open-source) together with our community:

- Contribute and vote on the Langfuse [roadmap](/docs/roadmap).
- Ask questions on [GitHub Discussions](/gh-support) or private [support channels](/support).
- Report bugs via [GitHub Issues](/issue).
- Chat with the community on [Discord](/discord).
- Join a [community hour](/events) to talk to the team and ask questions live.
- [Why people choose Langfuse?](/why)

Langfuse evolves quickly, check out the [changelog](/changelog) for the latest updates. Subscribe to the **mailing list** to get notified about new major features:

Subscribe to the Langfuse product update newsletter at https://langfuse.com/changelog.

<!-- agent-instructions -->

---

## Agent Instructions

This page is part of the [Langfuse](https://langfuse.com) documentation, published as plain Markdown for AI agents. Every page is available as Markdown by appending `.md` to its URL, or by sending an `Accept: text/markdown` header. This page: `https://langfuse.com/docs.md`.

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
