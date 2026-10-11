import "server-only";

// No model credentials or Start inputs: exercise MCP, Generative UI and native outputs.
export function starterDsl(providerId: string) {
  const question = {
    version: 1,
    cards: [
      {
        id: "direction",
        content: {
          type: "question",
          version: 1,
          data: {
            kind: "single",
            title: "Choose a summary",
            explanation:
              "The demo document was fetched through MCP. Choose how to present it.",
            options: [
              { id: "brief", label: "Brief" },
              { id: "detailed", label: "Detailed" },
            ],
          },
        },
      },
    ],
  };
  const definitions = [
    { type: "start", title: "Start", variables: [] },
    {
      type: "tool",
      title: "Fetch demo document through MCP",
      provider_type: "mcp",
      provider_id: providerId,
      provider_name: providerId,
      tool_name: "get_reference_document_v1",
      tool_label: "Read demo document",
      tool_configurations: {},
      tool_parameters: { documentId: { type: "mixed", value: "unibase-demo" } },
      is_team_authorization: true,
    },
    {
      type: "human-input",
      title: "Choose a summary",
      form_content:
        "```unibase-ui\n" +
        JSON.stringify(question) +
        "\n```\n{{#$output.response#}}",
      inputs: [
        {
          type: "paragraph",
          output_variable_name: "response",
          default: { type: "constant", selector: [], value: "" },
        },
      ],
      user_actions: [
        { id: "continue", title: "Continue", button_style: "primary" },
      ],
      delivery_methods: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          type: "webapp",
          enabled: true,
          config: {},
        },
      ],
      timeout: 24,
      timeout_unit: "hour",
    },
    {
      type: "code",
      title: "Compose result",
      code_language: "python3",
      code: 'def main(reference: list, response: str) -> dict:\n    document = next((item for item in reference if isinstance(item, dict) and item.get("id") == "unibase-demo"), None)\n    if not document or not document.get("body"):\n        raise ValueError("The MCP demo document was not received")\n    detailed = "detailed" in response\n    text = document["body"] if detailed else document["body"].split(".")[0] + "."\n    return {"text": "MCP document received. Selected: " + ("Detailed" if detailed else "Brief") + "\\n\\n" + document["title"] + "\\n" + text}\n',
      variables: [
        { variable: "reference", value_selector: ["reference", "json"] },
        { variable: "response", value_selector: ["decision", "response"] },
      ],
      outputs: { text: { type: "string", children: null } },
    },
    {
      type: "end",
      title: "Result",
      outputs: [{ variable: "text", value_selector: ["compose", "text"] }],
    },
  ];
  const ids = ["start", "reference", "decision", "compose", "end"];
  return {
    version: "0.6.0",
    kind: "app",
    dependencies: [],
    app: {
      name: "Unibase starter",
      description:
        "Test a Run: fetch a demo document through MCP, choose a summary, and view the result and tracing.",
      mode: "workflow",
      icon_type: "emoji",
      icon: "🧪",
      icon_background: "#FFEAD5",
      use_icon_as_answer_icon: false,
    },
    workflow: {
      conversation_variables: [],
      environment_variables: [],
      features: {
        file_upload: { enabled: false },
        opening_statement: "",
        suggested_questions: [],
        suggested_questions_after_answer: { enabled: false },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false },
      },
      graph: {
        nodes: definitions.map((data, i) => ({
          id: ids[i],
          type: "custom",
          data: { ...data, desc: "", selected: false },
          position: { x: 30 + i * 300, y: 100 },
          sourcePosition: "right",
          targetPosition: "left",
          width: 244,
          height: 100,
        })),
        edges: ids.slice(0, -1).map((source, i) => ({
          id: `${source}-${ids[i + 1]}`,
          source,
          target: ids[i + 1],
          sourceHandle: source === "decision" ? "continue" : "source",
          targetHandle: "target",
          type: "custom",
          data: {
            sourceType: definitions[i].type,
            targetType: definitions[i + 1].type,
            isInIteration: false,
            isInLoop: false,
          },
        })),
        viewport: { x: 0, y: 0, zoom: 0.7 },
      },
    },
  };
}
