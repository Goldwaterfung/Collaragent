To change the tool limits, you can modify the `toolLimits` by following steps:

1. Main Agent - Streaming Handler:
   `src/main/handlers/streaming.ts`:
   - In agent.stream(), set `recursionLimit`
2. Main Agent - Chat Handler:
   `src/main/handlers/agent.ts`:
   - In agent.invoke(), set `recursionLimit`
3. Subagent - Streaming Handler:
   `src/deepagents/middleware/subagents.ts`:
   - In subagent.invoke(), set `recursionLimit`
   