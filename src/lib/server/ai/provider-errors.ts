import "server-only";

// Provider errors can contain credentials, capability tokens, prompts and URLs.
// Classify bounded input into fixed messages; never serialize the raw error.
export function workflowFailure(error: unknown): string {
  const value = typeof error === "string" ? error.slice(0, 8000) : "";
  const reserved = /The variable name '(text|json|files)' is reserved\./.exec(
    value,
  );
  if (reserved)
    return `Dify rejected the reserved tool output name '${reserved[1]}'. Rename or nest this field in the MCP tool output, then refresh the tools in Dify.`;
  if (/Failed to connect to MCP server/i.test(value))
    return "Dify could not connect to the MCP server. Check the MCP connection and tunnel availability before starting another attempt.";
  const unavailable = /Failed to invoke tool: (502|503|504)\b/.exec(value);
  if (unavailable)
    return `A workflow tool service is unavailable (HTTP ${unavailable[1]}). Check its endpoint and proxy or tunnel availability before starting another attempt.`;
  if (/Tool execution (?:failed|timeout)\. Request ID: /i.test(value))
    return "An MCP tool could not complete. Check its permissions, Run context and server availability.";
  if (
    /unauthorized|invalid api.?key|authentication|credentials? (?:not|is not) (?:found|configured)|permission denied/i.test(
      value,
    )
  )
    return "Dify could not authenticate a workflow dependency. Check its provider credentials and permissions.";
  if (
    /model.*(?:not found|not configured|not available)|provider.*(?:not found|not configured|not available)/i.test(
      value,
    )
  )
    return "A workflow model or provider is unavailable. Check its configuration in Dify.";
  if (/timeout|timed out/i.test(value))
    return "A workflow step timed out in Dify. Check its dependencies before starting another attempt.";
  return "The workflow failed in Dify. Check the execution details in Dify for more information.";
}
