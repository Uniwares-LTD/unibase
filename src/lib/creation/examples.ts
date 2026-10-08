import { parseCard, type SavedCard } from "./cards";
import type { RegisteredValue } from "./registry";

// Public, deterministic sample data. Never use these IDs as authorization or
// persist these examples as a user's workspace. Real galleries need owned assets.
export function creationCardExamples(): SavedCard[] {
  const examples: RegisteredValue[] = [
    {
      type: "question",
      version: 1,
      data: {
        title: "Choose a direction",
        explanation: "A reusable single-choice decision.",
        kind: "single",
        options: [
          { id: "concise", label: "Concise" },
          { id: "detailed", label: "Detailed" },
        ],
      },
    },
    {
      type: "form",
      version: 1,
      data: {
        title: "Collect a brief",
        explanation: "Try text, numeric, multiple-choice and toggle fields.",
        fields: [
          {
            id: "goal",
            kind: "text",
            label: "Goal",
            required: true,
            multiline: true,
            maxLength: 500,
          },
          {
            id: "count",
            kind: "number",
            label: "Number of alternatives",
            required: true,
            min: 1,
            max: 4,
          },
          {
            id: "formats",
            kind: "choice",
            label: "Formats",
            required: true,
            multiple: true,
            options: [
              { id: "document", label: "Document" },
              { id: "checklist", label: "Checklist" },
            ],
          },
          {
            id: "review",
            kind: "toggle",
            label: "Include a review",
            required: false,
          },
        ],
      },
    },
    {
      type: "summary",
      version: 1,
      data: {
        title: "Confirm the brief",
        body: "Create a reusable draft, compare alternatives and request human approval before publication.",
      },
    },
    {
      type: "gallery",
      version: 1,
      data: {
        title: "Choose a private image",
        items: [
          {
            assetId: "00000000-0000-4000-8000-000000000101",
            label: "First alternative",
          },
          {
            assetId: "00000000-0000-4000-8000-000000000102",
            label: "Second alternative",
          },
        ],
      },
    },
    {
      type: "progress",
      version: 1,
      data: {
        title: "Generation progress",
        completed: 2,
        total: 3,
        label: "Two steps completed",
      },
    },
    {
      type: "issue",
      version: 1,
      data: {
        title: "Review a concern",
        severity: "warning",
        details: [
          "The draft needs a clearer introduction.",
          "Acknowledging this message does not resolve the finding.",
        ],
      },
    },
    {
      type: "review",
      version: 1,
      data: {
        title: "Review a saved version",
        artifactId: "00000000-0000-4000-8000-000000000201",
        version: 1,
        summary:
          "Approve this sample version or request a revision with a note.",
      },
    },
  ];
  return examples.map((content, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    content: parseCard(content),
    status: "active",
    response: null,
    responseAction: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    answeredAt: null,
    sourceJobId: null,
  }));
}
