# ChatOpenAI

[OpenAI](https://en.wikipedia.org/wiki/OpenAI) is an artificial intelligence (AI) research laboratory.

This guide will help you getting started with ChatOpenAI [chat models](/oss/javascript/langchain/models). For detailed documentation of all ChatOpenAI features and configurations head to the [API reference](https://api.js.langchain.com/classes/langchain_openai.ChatOpenAI.html).

<Note>
  **Chat Completions API compatibility**

  `ChatOpenAI` is fully compatible with OpenAI's (legacy) [Chat Completions API](https://platform.openai.com/docs/guides/completions). If you are looking to connect to other model providers that support the Chat Completions API, you can do so – see [instructions](/oss/javascript/integrations/chat#chat-completions-api).
</Note>

<Info>
  **OpenAI models hosted on Azure**

  Note that certain OpenAI models can also be accessed via the [Microsoft Azure platform](https://azure.microsoft.com/en-us/products/ai-foundry/models/openai/).
</Info>

## Setup

To access OpenAI chat models you'll need to create an OpenAI account, get an API key, and install the `@langchain/openai` integration package.

### Credentials

Head to [OpenAI's website](https://platform.openai.com/) to sign up for OpenAI and generate an API key. Once you've done this set the `OPENAI_API_KEY` environment variable:

```bash  theme={null}
export OPENAI_API_KEY="your-api-key"
```

If you want to get automated tracing of your model calls you can also set your [LangSmith](https://docs.langchain.com/langsmith/home) API key by uncommenting below:

```bash  theme={null}
# export LANGSMITH_TRACING="true"
# export LANGSMITH_API_KEY="your-api-key"
```

### Installation

The LangChain [`ChatOpenAI`](https://reference.langchain.com/javascript/classes/_langchain_openai.ChatOpenAI.html) integration lives in the `@langchain/openai` package:

<CodeGroup>
  ```bash npm theme={null}
  npm install @langchain/openai @langchain/core
  ```

  ```bash yarn theme={null}
  yarn add @langchain/openai @langchain/core
  ```

  ```bash pnpm theme={null}
  pnpm add @langchain/openai @langchain/core
  ```
</CodeGroup>

## Instantiation

Now we can instantiate our model object and generate chat completions:

```typescript  theme={null}
import { ChatOpenAI } from "@langchain/openai"

const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  // other params...
})
```

## Invocation

```typescript  theme={null}
const aiMsg = await llm.invoke([
  {
    role: "system",
    content: "You are a helpful assistant that translates English to French. Translate the user sentence.",
  },
  {
    role: "user",
    content: "I love programming."
  },
])
aiMsg
```

```text  theme={null}
AIMessage {
  "id": "chatcmpl-ADItECqSPuuEuBHHPjeCkh9wIO1H5",
  "content": "J'adore la programmation.",
  "additional_kwargs": {},
  "response_metadata": {
    "tokenUsage": {
      "completionTokens": 5,
      "promptTokens": 31,
      "totalTokens": 36
    },
    "finish_reason": "stop",
    "system_fingerprint": "fp_5796ac6771"
  },
  "tool_calls": [],
  "invalid_tool_calls": [],
  "usage_metadata": {
    "input_tokens": 31,
    "output_tokens": 5,
    "total_tokens": 36
  }
}
```

```typescript  theme={null}
console.log(aiMsg.content)
```

```text  theme={null}
J'adore la programmation.
```

## Custom tools

[Custom tools](https://platform.openai.com/docs/guides/function-calling#custom-tools) support tools with arbitrary string inputs. They can be particularly useful when you expect your string arguments to be long or complex.

If you use a model that supports custom tools, you can use the [`ChatOpenAI`](https://reference.langchain.com/javascript/classes/_langchain_openai.ChatOpenAI.html) class and the `customTool` function to create a custom tool.

```typescript  theme={null}
import { ChatOpenAI, customTool } from "@langchain/openai";
import { createAgent, HumanMessage } from "langchain";

const codeTool = customTool(
  async () => {
    // ... Add code to execute the input
    return "Code executed successfully";
  },
  {
    name: "execute_code",
    description: "Execute a code snippet",
    format: { type: "text" },
  }
);

const model = new ChatOpenAI({ model: "gpt-5" });

const agent = createAgent({
  model,
  tools: [codeTool],
});

const result = await agent.invoke({
  messages: [new HumanMessage("Use the tool to execute the code")],
});
console.log(result);
```

<details>
  <summary>Context-free grammars</summary>

  OpenAI supports the specification of a [context-free grammar](https://platform.openai.com/docs/guides/function-calling#context-free-grammars) for custom tool inputs in `lark` or `regex` format. See [OpenAI docs](https://platform.openai.com/docs/guides/function-calling#context-free-grammars) for details. The `format` parameter can be passed into `customTool` as shown below:

  ```typescript  theme={null}
  import { ChatOpenAI, customTool } from "@langchain/openai";
  import { createAgent, HumanMessage } from "langchain";

  const MATH_GRAMMAR = `
  start: expr
  expr: term (SP ADD SP term)* -> add
  | term
  term: factor (SP MUL SP factor)* -> mul
  | factor
  factor: INT
  SP: \" \"
  ADD: \"+\"
  MUL: \"*\"
  %import common.INT
  `;

  const doMath = customTool(
    async () => {
      // ... Add code to parse and execute the input
      return "27";
    },
    {
      name: "do_math",
      description: "Evaluate a math expression",
      format: { type: "grammar", definition: MATH_GRAMMAR, syntax: "lark" },
    }
  );

  const model = new ChatOpenAI({ model: "gpt-5" });

  const agent = createAgent({
    model,
    tools: [doMath],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage("Use the tool to calculate 3^3")],
  });
  console.log(result);
  ```
</details>

## Structured output

We can also pass `strict: true` to the [`.withStructuredOutput()`](https://js.langchain.com/docs/how_to/structured_output/#the-.withstructuredoutput-method). Here's an example:

```typescript  theme={null}
import { ChatOpenAI } from "@langchain/openai";

const traitSchema = z.object({
  traits: z.array(z.string()).describe("A list of traits contained in the input"),
});

const structuredLlm = new ChatOpenAI({
  model: "gpt-4o-mini",
}).withStructuredOutput(traitSchema, {
  name: "extract_traits",
  strict: true,
});

await structuredLlm.invoke([{
  role: "user",
  content: `I am 6'5" tall and love fruit.`
}]);
```

```javascript  theme={null}
{ traits: [ `6'5" tall`, 'love fruit' ] }
```

### Reasoning models

<Warning>
  **Compatibility**: The below points apply to `@langchain/openai>=0.4.0`.
</Warning>

When using reasoning models like `o1`, the default method for `withStructuredOutput` is OpenAI's built-in method for structured output (equivalent to passing `method: "jsonSchema"` as an option into `withStructuredOutput`). JSON schema mostly works the same as other models, but with one important caveat: when defining schema, `z.optional()` is not respected, and you should instead use `z.nullable()`.

Here's an example:

```typescript  theme={null}
import * as z from "zod";
import { ChatOpenAI } from "@langchain/openai";

// Will not work
const reasoningModelSchemaOptional = z.object({
  color: z.optional(z.string()).describe("A color mentioned in the input"),
});

const reasoningModelOptionalSchema = new ChatOpenAI({
  model: "o1",
}).withStructuredOutput(reasoningModelSchemaOptional, {
  name: "extract_color",
});

await reasoningModelOptionalSchema.invoke([{
  role: "user",
  content: `I am 6'5" tall and love fruit.`
}]);
```

```javascript  theme={null}
{ color: 'No color mentioned' }
```

And here's an example with `z.nullable()`:

```typescript  theme={null}
import * as z from "zod";
import { ChatOpenAI } from "@langchain/openai";

// Will not work
const reasoningModelSchemaNullable = z.object({
  color: z.nullable(z.string()).describe("A color mentioned in the input"),
});

const reasoningModelNullableSchema = new ChatOpenAI({
  model: "o1",
}).withStructuredOutput(reasoningModelSchemaNullable, {
  name: "extract_color",
});

await reasoningModelNullableSchema.invoke([{
  role: "user",
  content: `I am 6'5" tall and love fruit.`
}]);
```

```javascript  theme={null}
{ color: null }
```
