"use client";
import { useId, useState, type ComponentType } from "react";
import Image from "next/image";
import { createRegistry, type RegisteredValue } from "@/lib/creation/registry";
import {
  artifactRegistry,
  documentContentSchema,
  imageContentSchema,
  checklistContentSchema,
  parseArtifact,
} from "@/lib/creation/artifacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EditorProps = {
  initial?: RegisteredValue;
  disabled: boolean;
  onSave: (content: RegisteredValue) => Promise<boolean>;
  assets: { id: string; name: string; mime: string }[];
};
type ViewProps = { content: RegisteredValue; allowedAssetIds: string[] };
function DocumentView({ content }: ViewProps) {
  return (
    <p className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
      {documentContentSchema.parse(content.data).body}
    </p>
  );
}
function DocumentEditor({ initial, disabled, onSave }: EditorProps) {
  const data = initial
    ? documentContentSchema.parse(initial.data)
    : { title: "", body: "" };
  const [title, setTitle] = useState(data.title);
  const [body, setBody] = useState(data.body);
  const id = useId();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          (await onSave({
            type: "document",
            version: 1,
            data: { title, body },
          })) &&
          !initial
        ) {
          setTitle("");
          setBody("");
        }
      }}
    >
      <Label htmlFor={`${id}-title`}>Title</Label>
      <Input
        id={`${id}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={500}
        required
        disabled={disabled}
      />
      <Label htmlFor={`${id}-body`}>Content</Label>
      <Textarea
        id={`${id}-body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={30000}
        required
        disabled={disabled}
      />
      <Button disabled={disabled}>Save document</Button>
    </form>
  );
}
function ImageView({ content, allowedAssetIds }: ViewProps) {
  const data = imageContentSchema.parse(content.data);
  return (
    <div className="space-y-2">
      {allowedAssetIds.includes(data.assetId) ? (
        <Image
          unoptimized
          src={`/api/workspace-assets/${data.assetId}`}
          width={640}
          height={480}
          alt={data.caption || data.title}
          className="max-h-96 w-full rounded-md object-contain"
        />
      ) : (
        <p>Private image unavailable.</p>
      )}
      <p>{data.caption}</p>
    </div>
  );
}
function ImageEditor({ initial, assets, disabled, onSave }: EditorProps) {
  const data = initial
    ? imageContentSchema.parse(initial.data)
    : { title: "", assetId: "", caption: "" };
  const [title, setTitle] = useState(data.title);
  const [assetId, setAssetId] = useState(data.assetId);
  const [caption, setCaption] = useState(data.caption);
  const id = useId();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          type: "image",
          version: 1,
          data: { title, assetId, caption },
        });
      }}
    >
      <Label htmlFor={`${id}-title`}>Title</Label>
      <Input
        id={`${id}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={500}
        disabled={disabled}
      />
      <Label htmlFor={`${id}-asset`}>Private image</Label>
      <Select value={assetId} onValueChange={setAssetId} disabled={disabled}>
        <SelectTrigger id={`${id}-asset`}>
          <SelectValue placeholder="Choose an uploaded image" />
        </SelectTrigger>
        <SelectContent>
          {assets
            .filter((a) => a.mime.startsWith("image/"))
            .map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Label htmlFor={`${id}-caption`}>Caption</Label>
      <Textarea
        id={`${id}-caption`}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={4000}
        disabled={disabled}
      />
      <Button disabled={disabled || !assetId}>Save image version</Button>
    </form>
  );
}
function ChecklistView({ content }: ViewProps) {
  const data = checklistContentSchema.parse(content.data);
  return (
    <ul className="space-y-2">
      {data.items.map((item) => (
        <li key={item.id} className="flex items-start gap-2">
          <span aria-label={item.done ? "Complete" : "Incomplete"}>
            {item.done ? "✓" : "○"}
          </span>
          <span
            className={item.done ? "text-muted-foreground line-through" : ""}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
function ChecklistEditor({ initial, disabled, onSave }: EditorProps) {
  const data = initial
    ? checklistContentSchema.parse(initial.data)
    : { title: "", items: [] };
  const [title, setTitle] = useState(data.title);
  const [items, setItems] = useState(data.items);
  const [next, setNext] = useState("");
  const id = useId();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ type: "checklist", version: 1, data: { title, items } });
      }}
    >
      <Label htmlFor={`${id}-title`}>Checklist title</Label>
      <Input
        id={`${id}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={500}
        disabled={disabled}
      />
      <ul className="space-y-2">
        {items.map((item) => (
          <li className="flex items-start gap-2" key={item.id}>
            <Checkbox
              id={`${id}-${item.id}`}
              checked={item.done}
              disabled={disabled}
              onCheckedChange={(done) =>
                setItems(
                  items.map((old) =>
                    old.id === item.id ? { ...old, done: done === true } : old,
                  ),
                )
              }
            />
            <Label className="flex-1 break-words" htmlFor={`${id}-${item.id}`}>
              {item.text}
            </Label>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={disabled}
              onClick={() =>
                setItems(items.filter((old) => old.id !== item.id))
              }
            >
              Remove <span className="sr-only">{item.text}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Label htmlFor={`${id}-next`}>New checklist item</Label>
      <Input
        id={`${id}-next`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        maxLength={1000}
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !next.trim() || items.length >= 100}
          onClick={() => {
            setItems([
              ...items,
              { id: crypto.randomUUID(), text: next.trim(), done: false },
            ]);
            setNext("");
          }}
        >
          Add item
        </Button>
        <Button disabled={disabled || !items.length}>Save checklist</Button>
      </div>
    </form>
  );
}
export const artifactRenderers = createRegistry<{
  type: string;
  version: number;
  View: ComponentType<ViewProps>;
  Editor: ComponentType<EditorProps>;
}>([
  { type: "document", version: 1, View: DocumentView, Editor: DocumentEditor },
  { type: "image", version: 1, View: ImageView, Editor: ImageEditor },
  {
    type: "checklist",
    version: 1,
    View: ChecklistView,
    Editor: ChecklistEditor,
  },
]);
export function RegisteredArtifactView(props: ViewProps) {
  let View: ComponentType<ViewProps>;
  try {
    parseArtifact(props.content);
    View = artifactRenderers.get(
      props.content.type,
      props.content.version,
    ).View;
  } catch {
    return (
      <p>
        This saved artifact needs a supported renderer. Its data has been
        preserved.
      </p>
    );
  }
  return <View {...props} />;
}
export function RegisteredArtifactEditor(props: EditorProps) {
  const [type, setType] = useState(props.initial?.type ?? "document");
  const id = useId();
  let Editor: ComponentType<EditorProps>;
  try {
    Editor = artifactRenderers.get(type, props.initial?.version ?? 1).Editor;
  } catch {
    return (
      <p>Editing this artifact requires its registered schema and editor.</p>
    );
  }
  return (
    <div className="space-y-3">
      {!props.initial && (
        <>
          <Label htmlFor={id}>Artifact type</Label>
          <Select
            value={type}
            onValueChange={setType}
            disabled={props.disabled}
          >
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {artifactRegistry.list().map((d) => (
                <SelectItem key={`${d.type}:${d.version}`} value={d.type}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      <Editor key={`${type}:${props.initial?.version ?? 1}`} {...props} />
    </div>
  );
}
