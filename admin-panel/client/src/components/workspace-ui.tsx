import { useEffect, useState, type ReactNode } from "react";
import { subscribeLive } from "@/lib/live";
import { useLiveState } from "@/hooks/use-live-resource";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { PageHeader } from "./page-header";
import { Field, FieldLabel } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function WorkspaceHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return <PageHeader title={title} description={description} actions={children} />;
}
export function Feedback({ error = "", message = "" }) {
  return error ? (
    <p role="alert" className="my-3 text-sm text-destructive">
      {error}
    </p>
  ) : message ? (
    <p role="status" className="my-3 text-sm text-muted-foreground">
      {message}
    </p>
  ) : null;
}
export function Choice({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={value || "__none"}
        onValueChange={(value) => onChange(value === "__none" ? "" : value)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.value || "__none"}
                value={option.value || "__none"}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function ConfirmAction({
  title,
  description,
  onConfirm,
  disabled = false,
  children,
  open: controlled,
  onOpenChange,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  /** Content of the trigger button; without it the dialog is opened from outside through `open`. */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setError("");
        }
      }}
    >
      {children && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            {children}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Feedback error={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } catch (cause) {
                setError(cause.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Wird ausgeführt …" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function useResource<T>(path: string) {
  const connection = useLiveState();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let received = false;
    const stop = subscribeLive(path, (message) => {
      received = true;
      if (message.type === "snapshot") {
        setData(message.data);
        setError("");
      } else {
        setError(message.error);
        if ([401, 403, 404].includes(message.status)) setData(null);
      }
      setLoading(false);
    });
    let pending = false;
    setData(null);
    setError("");
    setLoading(true);
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      pending = true;

      try {
        const next = await api(path, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!controller.signal.aborted && !received) {
          setData(next);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted && !received) {
          setError(cause.message);
          if ([401, 403, 404].includes(cause.status)) setData(null);
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    void refresh();

    return () => {
      controller.abort();

      stop();
    };
  }, [path, version]);
  return {
    data,
    connection,
    setData,
    error,
    loading,
    reload: () => reload((value) => value + 1),
  };
}
