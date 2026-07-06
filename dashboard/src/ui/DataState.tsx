import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "./EmptyState";

/** The shared error panel, reused by DataState and the error boundary. */
export function ErrorPanel({ message }: { message?: string }) {
  return (
    <div className="card border-t-4 border-t-[var(--color-danger)] p-6">
      <div className="eyebrow text-[var(--color-danger)] mb-2">Error</div>
      <p className="text-[14px] text-[var(--color-ink)]">
        Something went wrong loading this view.
      </p>
      {message && (
        <p className="text-[12px] text-[var(--color-soft)] font-mono mt-2 break-words">
          {message}
        </p>
      )}
    </div>
  );
}

/** The shared loading state: a quiet pulsing label. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-[var(--color-soft)]">
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
        {label}
      </span>
    </div>
  );
}

interface DataStateProps<T> {
  /** A `useQuery` result: `undefined` while the subscription is loading. */
  data: T | undefined;
  /** An error to render instead of the data (e.g. from a boundary). */
  error?: Error | null;
  /** Override emptiness detection; defaults to null or empty array. */
  isEmpty?: (data: T) => boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyHint?: string;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  children: (data: NonNullable<T>) => ReactNode;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data === null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Renders the uniform loading / empty / error / success states from a
 * `useQuery` result, so no view hand-rolls those three states. Pass the
 * raw query result as `data` (`undefined` means loading).
 */
export function DataState<T>({
  data,
  error = null,
  isEmpty = defaultIsEmpty,
  loadingLabel,
  emptyTitle = "Nothing here yet",
  emptyHint,
  emptyIcon,
  emptyAction,
  children,
}: DataStateProps<T>) {
  if (error) return <ErrorPanel message={error.message} />;
  if (data === undefined) return <LoadingState label={loadingLabel} />;
  if (isEmpty(data))
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        hint={emptyHint}
        action={emptyAction}
      />
    );
  return <>{children(data as NonNullable<T>)}</>;
}

/**
 * Catches errors thrown by Convex subscriptions during render (the way
 * `convex/react` surfaces query failures) and renders the shared error
 * panel, so a failed deployment or query does not blank the whole app.
 */
export class QueryErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <ErrorPanel message={this.state.error.message} />
          <div className="mt-4">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => this.setState({ error: null })}
            >
              <AlertTriangle size={13} /> Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
