import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";

// In-app replacements for window.confirm, alert and prompt: same promise
// shape, but styled like the app and readable on a phone.

export type FormField = {
  key: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** Several lines. */
  long?: boolean;
  /** A choice instead of free text. */
  options?: { value: string; label: string }[];
};

type Request = {
  id: number;
  kind: "confirm" | "alert" | "prompt" | "form";
  fields?: FormField[];
  message: string;
  ok: string;
  danger: boolean;
  value: string;
  done: (answer: boolean | string | null | Record<string, string>) => void;
};

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ask(kind: Request["kind"], message: string, opts: { ok?: string; danger?: boolean; value?: string; fields?: FormField[] } = {}) {
  return new Promise<boolean | string | null | Record<string, string>>((resolve) => {
    const request: Request = {
      id: nextId++,
      kind,
      message,
      ok: opts.ok ?? t("common.ok"),
      danger: !!opts.danger,
      value: opts.value ?? "",
      fields: opts.fields,
      done: (answer) => {
        queue = queue.filter((r) => r !== request);
        emit();
        resolve(answer);
      },
    };
    queue = [...queue, request];
    emit();
  });
}

/** Asks yes or no. `ok` names the action, `danger` marks it as destructive. */
export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return ask("confirm", message, opts) as Promise<boolean>;
}

export function alertDialog(message: string): Promise<void> {
  return ask("alert", message).then(() => undefined);
}

/** Resolves to the text entered, or null when cancelled. */
export function promptDialog(message: string, value = ""): Promise<string | null> {
  return ask("prompt", message, { value }) as Promise<string | null>;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** A few fields at once; resolves with their values, or null when cancelled. */
export function formDialog(message: string, fields: FormField[], opts: { ok?: string } = {}): Promise<Record<string, string> | null> {
  return ask("form", message, { ...opts, fields }) as Promise<Record<string, string> | null>;
}

/** Shows the oldest open request. Mounted once, next to the app. */
export function DialogHost() {
  const request = useSyncExternalStore(subscribe, () => queue[0]);
  if (!request) return null;
  return <Dialog key={request.id} request={request} />;
}

function Dialog({ request }: { request: Request }) {
  const [value, setValue] = useState(request.value);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((request.fields ?? []).map((f) => [f.key, f.value ?? f.options?.[0]?.value ?? ""])),
  );
  const firstField = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancel = () => request.done(request.kind === "prompt" || request.kind === "form" ? null : false);
  const accept = () => request.done(request.kind === "prompt" ? value : request.kind === "form" ? values : true);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (firstField.current) firstField.current.focus();
    else if (inputRef.current) inputRef.current.select();
    // A destructive action never runs on a stray Enter: Cancel has the focus.
    else (request.danger ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        className="modal dialog"
        role={request.kind === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={request.message}
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        <p className="dialog-message">{request.message}</p>
        {request.kind === "prompt" && (
          <input ref={inputRef} className="dialog-input" value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        {request.fields?.map((f, i) => (
          <label key={f.key} className="dialog-field">
            <span>{f.label}</span>
            {f.options ? (
              <select ref={i === 0 ? firstField : undefined} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.long ? (
              <textarea
                ref={i === 0 ? firstField : undefined}
                rows={4}
                placeholder={f.placeholder}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            ) : (
              <input
                ref={i === 0 ? firstField : undefined}
                placeholder={f.placeholder}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}
        <div className="dialog-actions">
          {request.kind !== "alert" && (
            <button ref={cancelRef} type="button" onClick={cancel}>
              {t("common.cancel")}
            </button>
          )}
          <button ref={okRef} type="submit" className={request.danger ? "danger solid" : "primary"}>
            {request.ok}
          </button>
        </div>
      </form>
    </div>
  );
}
