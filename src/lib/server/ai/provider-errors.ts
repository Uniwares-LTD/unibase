import "server-only";

// Provider errors can contain credentials, capability tokens, prompts and URLs.
// Classify bounded input into fixed messages; never serialize the raw error.
export function workflowFailure(error: unknown): string {
  const value = typeof error === "string" ? error.slice(0, 8000) : "";
  if (/UNITALE_IMAGE_MODEL_UNAVAILABLE/.test(value))
    return "The Unitale image model is unavailable. Update the image tool to a supported model in Dify before starting another attempt.";
  if (/UNITALE_IMAGE_AUTHENTICATION_FAILED/.test(value))
    return "The Unitale image provider rejected its credentials or permissions. Check the image tool connection in Dify.";
  if (/UNITALE_IMAGE_RATE_LIMITED/.test(value))
    return "The Unitale image provider reached its quota or rate limit. Check provider availability before starting another attempt.";
  if (/UNITALE_IMAGE_REQUEST_BLOCKED/.test(value))
    return "The Unitale image provider rejected an image request under its safety policy. Review the image prompt in Dify.";
  if (/UNITALE_IMAGE_PROVIDER_FAILED/.test(value))
    return "The Unitale image provider returned an error instead of an image. Check the image tool execution in Dify.";
  if (/UNITALE_IMAGE_MISSING|Expected one generated image per task/.test(value))
    return "A Unitale image step returned no valid image. Check the image provider's model and execution details in Dify.";
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
    /model.*(?:not found|not configured|not available|does not exist)|provider.*(?:not found|not configured|not available)/i.test(
      value,
    )
  )
    return "A workflow model or provider is unavailable. Check its configuration in Dify.";
  if (/timeout|timed out/i.test(value))
    return "A workflow step timed out in Dify. Check its dependencies before starting another attempt.";
  return "The workflow failed in Dify. Check the execution details in Dify for more information.";
}
