"use client";
import { useId, useState, type ComponentType } from "react";
import Image from "next/image";
import { createRegistry, type RegisteredValue } from "@/lib/creation/registry";
import {
  cardRegistry,
  parseCard,
  questionSchema,
  formCardSchema,
  summaryCardSchema,
  galleryCardSchema,
  progressCardSchema,
  issueCardSchema,
  reviewCardSchema,
  type SavedCard,
  type CardAction,
} from "@/lib/creation/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type CardBodyProps = {
  content: RegisteredValue;
  disabled: boolean;
  respond: (action: CardAction, value: RegisteredValue["data"]) => void;
  allowedAssetIds: string[];
};
function QuestionBody({ content, disabled, respond }: CardBodyProps) {
  const data = questionSchema.parse(content.data);
  return (
    <FormBody
      content={{
        type: "form",
        version: 1,
        data: {
          title: data.title,
          explanation: data.explanation,
          fields: [
            data.kind === "text"
              ? {
                  id: "answer",
                  kind: "text",
                  label: "Your answer",
                  required: true,
                  multiline: true,
                  maxLength: 4000,
                }
              : {
                  id: "answer",
                  kind: "choice",
                  label: "Your answer",
                  required: true,
                  multiple: data.kind === "multiple",
                  options: data.options,
                },
          ],
        },
      }}
      disabled={disabled}
      allowedAssetIds={[]}
      respond={(_action, value) =>
        respond(
          "submit",
          (value as Record<string, RegisteredValue["data"]>).answer,
        )
      }
    />
  );
}
function FormBody({ content, disabled, respond }: CardBodyProps) {
  const form = formCardSchema.parse(content.data);
  const prefix = useId();
  const [values, setValues] = useState<
    Record<string, string | number | boolean | string[]>
  >({});
  const [error, setError] = useState("");
  const change = (id: string, value: string | number | boolean | string[]) =>
    setValues((old) => ({ ...old, [id]: value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        try {
          const parsed = cardRegistry
            .get("form", 1)
            .response(form, "submit", values);
          respond("submit", parsed);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Check the form fields.");
        }
      }}
    >
      {form.explanation && (
        <p className="text-sm text-muted-foreground">{form.explanation}</p>
      )}
      {form.fields.map((field) => {
        const id = `${prefix}-${field.id}`;
        if (field.kind === "toggle")
          return (
            <div key={field.id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                disabled={disabled}
                checked={values[field.id] === true}
                onCheckedChange={(value) => change(field.id, value === true)}
              />
              <Label htmlFor={id}>
                {field.label}
                {field.required ? " (required)" : ""}
              </Label>
            </div>
          );
        if (field.kind === "choice") {
          const selected = Array.isArray(values[field.id])
            ? (values[field.id] as string[])
            : [values[field.id]];
          return (
            <fieldset key={field.id} disabled={disabled} className="space-y-2">
              <legend className="text-sm font-medium">
                {field.label}
                {field.required ? " (required)" : ""}
              </legend>
              <p className="text-xs text-muted-foreground">
                {field.multiple ? "Choose one or more" : "Choose one"}
              </p>
              <div className="flex flex-wrap gap-2">
                {field.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={
                      selected.includes(option.id) ? "secondary" : "outline"
                    }
                    aria-pressed={selected.includes(option.id)}
                    disabled={disabled}
                    onClick={() =>
                      change(
                        field.id,
                        field.multiple
                          ? selected.includes(option.id)
                            ? selected.filter(
                                (id): id is string =>
                                  typeof id === "string" && id !== option.id,
                              )
                            : [
                                ...selected.filter(
                                  (id): id is string => typeof id === "string",
                                ),
                                option.id,
                              ]
                          : option.id,
                      )
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={id}>
              {field.label}
              {field.required ? " (required)" : ""}
            </Label>
            {field.kind === "text" && field.multiline ? (
              <Textarea
                id={id}
                disabled={disabled}
                value={String(values[field.id] ?? "")}
                onChange={(e) => change(field.id, e.target.value)}
                maxLength={field.maxLength}
                required={field.required}
              />
            ) : (
              <Input
                id={id}
                disabled={disabled}
                type={field.kind === "number" ? "number" : "text"}
                value={String(values[field.id] ?? "")}
                onChange={(e) =>
                  change(
                    field.id,
                    field.kind === "number" && e.target.value !== ""
                      ? e.target.valueAsNumber
                      : e.target.value,
                  )
                }
                required={field.required}
                {...(field.kind === "number"
                  ? { min: field.min, max: field.max, step: "any" }
                  : { maxLength: field.maxLength })}
              />
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button disabled={disabled}>Save response</Button>
    </form>
  );
}
function SummaryBody({ content, disabled, respond }: CardBodyProps) {
  const data = summaryCardSchema.parse(content.data);
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap break-words">{data.body}</p>
      <Button
        disabled={disabled}
        variant="outline"
        onClick={() => respond("acknowledge", null)}
      >
        Acknowledge
      </Button>
    </div>
  );
}
function GalleryBody({
  content,
  disabled,
  respond,
  allowedAssetIds,
}: CardBodyProps) {
  const data = galleryCardSchema.parse(content.data);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.items.map((item) => (
        <div key={item.assetId} className="space-y-2 rounded-md border p-3">
          {allowedAssetIds.includes(item.assetId) ? (
            <Image
              unoptimized
              src={`/api/workspace-assets/${item.assetId}`}
              width={400}
              height={300}
              alt={item.label}
              className="h-48 w-full rounded-md object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This image is unavailable.
            </p>
          )}
          <p>{item.label}</p>
          <Button
            disabled={disabled || !allowedAssetIds.includes(item.assetId)}
            variant="outline"
            onClick={() => respond("choose", item.assetId)}
          >
            Choose {item.label}
          </Button>
        </div>
      ))}
    </div>
  );
}
function ProgressBody({ content }: CardBodyProps) {
  const data = progressCardSchema.parse(content.data);
  return (
    <div role="status" className="space-y-2">
      <p>
        {data.label} · {data.completed} / {data.total}
      </p>
      <Progress
        value={(data.completed / data.total) * 100}
        aria-label={data.title}
      />
    </div>
  );
}
function IssueBody({ content, disabled, respond }: CardBodyProps) {
  const data = issueCardSchema.parse(content.data);
  return (
    <div className="space-y-3">
      <Badge
        variant={data.severity === "blocking" ? "destructive" : "secondary"}
      >
        {data.severity}
      </Badge>
      <ul className="list-disc space-y-1 pl-5">
        {data.details.map((detail, i) => (
          <li key={i}>{detail}</li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Acknowledging records that you read this message; it does not resolve
        quality findings or approve work.
      </p>
      <Button
        disabled={disabled}
        variant="outline"
        onClick={() => respond("acknowledge", null)}
      >
        Acknowledge
      </Button>
    </div>
  );
}
function ReviewBody({ content, disabled, respond }: CardBodyProps) {
  const data = reviewCardSchema.parse(content.data);
  const id = useId();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <p>Artifact version {data.version}</p>
      <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
        {data.summary}
      </p>
      <Label htmlFor={id}>Approval note or revision instructions</Label>
      <Textarea
        id={id}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={disabled}
        maxLength={2000}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => respond("approve", note)}>
          Approve reviewed version
        </Button>
        <Button
          variant="outline"
          disabled={disabled || !note.trim()}
          onClick={() => respond("request-revision", note)}
        >
          Request revision
        </Button>
      </div>
    </div>
  );
}
// Product UI extensions register components here; they never modify the workspace
// layout or execute code provided by a model. Contracts live in the shared registry.
export const cardRenderers = createRegistry<{
  type: string;
  version: number;
  component: ComponentType<CardBodyProps>;
}>([
  { type: "question", version: 1, component: QuestionBody },
  { type: "form", version: 1, component: FormBody },
  { type: "summary", version: 1, component: SummaryBody },
  { type: "gallery", version: 1, component: GalleryBody },
  { type: "progress", version: 1, component: ProgressBody },
  { type: "issue", version: 1, component: IssueBody },
  { type: "review", version: 1, component: ReviewBody },
]);
export function RegisteredCard({
  card,
  disabled,
  onRespond,
  onReopen,
  allowedAssetIds = [],
}: {
  card: SavedCard;
  disabled: boolean;
  allowedAssetIds?: string[];
  onRespond: (action: CardAction, value: RegisteredValue["data"]) => void;
  onReopen?: () => void;
}) {
  let content: RegisteredValue;
  let Component: ComponentType<CardBodyProps>;
  try {
    content = parseCard(card.content);
    Component = cardRenderers.get(content.type, content.version).component;
  } catch {
    return (
      <p role="status" className="rounded-md border p-3">
        This saved card needs a supported renderer. Its data has been preserved.
      </p>
    );
  }
  const title =
    typeof content.data === "object" &&
    content.data !== null &&
    "title" in content.data
      ? String(content.data.title)
      : "Generated card";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {cardRegistry.get(content.type, content.version).label}
          {cardRegistry.get(content.type, content.version).actions.length > 0
            ? ` · ${card.status}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {card.status === "active" ? (
          <Component
            content={content}
            disabled={disabled}
            respond={onRespond}
            allowedAssetIds={allowedAssetIds}
          />
        ) : (
          <>
            <p className="text-sm">Saved action: {card.responseAction}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
              {JSON.stringify(card.response, null, 2)}
            </pre>
            {card.status === "answered" &&
              onReopen &&
              content.type !== "review" && (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={onReopen}
                >
                  Reopen card
                </Button>
              )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
