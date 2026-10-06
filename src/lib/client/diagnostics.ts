import { safeRecord, type DiagnosticEvent } from "../diagnostics";

type Entry = ReturnType<typeof safeRecord>;
let enabled = false;
let entries: Entry[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
export const diagnostics = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  isEnabled: () => enabled,
  entries: () => entries,
  setEnabled(value: boolean) {
    enabled = value;
    entries = [];
    if (value) entries.push(safeRecord("diagnostics-enabled"));
    notify();
  },
  record(event: DiagnosticEvent, input?: Parameters<typeof safeRecord>[1]) {
    if (!enabled) return;
    entries = [...entries.slice(-99), safeRecord(event, input)];
    notify();
  },
  export() {
    return JSON.stringify(
      entries.map(({ event, status, durationMs, requestId, timestamp }) => ({
        ...safeRecord(event, { status, durationMs, requestId }),
        timestamp,
      })),
      null,
      2,
    );
  },
};
