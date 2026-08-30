import {
  createMiddleware,
} from "langchain";

/**
 * Middleware for injecting the current date and time into the system prompt.
 * 
 * This ensures the agent is always aware of the current date and time
 * at the moment each request is processed.
 */
export function dateMiddleware() {
  return createMiddleware({
    name: "DateMiddleware",

    wrapModelCall(request, handler) {
      const now = new Date();
      // Format: Monday, March 2, 2026
      const formattedDate = now.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const dateSection = `## Current Date\n- **Date**: ${formattedDate}\n`;

      // Prepend the date section to the system prompt
      const currentSystemPrompt = request.systemPrompt || "";
      const newSystemPrompt = currentSystemPrompt
        ? `${dateSection}\n${currentSystemPrompt}`
        : dateSection;

      return handler({ ...request, systemPrompt: newSystemPrompt });
    },
  });
}
