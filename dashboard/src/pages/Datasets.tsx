import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Database, GitBranch, Plus } from "lucide-react";
import { api } from "../lib/convex";
import type { Dataset } from "../lib/types";
import { parseItems } from "../lib/datasetInput";
import { stringifyValue, truncate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataState,
  Dialog,
  Input,
  SectionHeader,
  Table,
  Textarea,
} from "../ui";

export function DatasetsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const datasets = useQuery(api.dashboard.listDatasets, { includeArchived });
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <SectionHeader
        eyebrow="Data"
        title="Datasets"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Show archived
            </label>
            <Button variant="accent" onClick={() => setCreating(true)}>
              <Plus size={14} /> New dataset
            </Button>
          </>
        }
      />
      <Card>
        <DataState
          data={datasets}
          loadingLabel="Loading datasets"
          emptyIcon={<Database size={28} />}
          emptyTitle="No datasets yet"
          emptyHint="Create one to start running evals against it."
          emptyAction={
            <Button variant="accent" onClick={() => setCreating(true)}>
              <Plus size={14} /> New dataset
            </Button>
          }
        >
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Version</th>
                  <th className="text-right">Items</th>
                  <th>Description</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d._id}>
                    <td>
                      <Link
                        to={`/datasets/${d._id}`}
                        className="font-mono text-[13px] text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="text-right font-mono text-[12px]">
                      v{d.version}
                    </td>
                    <td className="text-right font-mono text-[12px]">
                      {d.itemCount}
                    </td>
                    <td className="text-[12px] text-[var(--color-muted)]">
                      {d.description ? truncate(d.description, 60) : "—"}
                    </td>
                    <td>
                      {d.archived ? (
                        <Badge tone="muted">archived</Badge>
                      ) : (
                        <Badge tone="ok">active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Card>
      <CreateDatasetDialog
        open={creating}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function CreateDatasetDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useMutation(api.dashboard.createDataset);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemsRaw, setItemsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setItemsRaw("");
    setError(null);
  };

  const submit = async () => {
    const parsed = parseItems(itemsRaw);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const id = await create({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsed.items.length ? { items: parsed.items } : {}),
      });
      reset();
      onClose();
      navigate(`/datasets/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Create"
      title="New dataset"
      tone="accent"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => void submit()} disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <label className="block text-[12px] text-[var(--color-muted)] mb-1.5">
        Name
      </label>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-eval-set"
      />
      <label className="block text-[12px] text-[var(--color-muted)] mb-1.5 mt-4">
        Description <span className="text-[var(--color-soft)]">(optional)</span>
      </label>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What this dataset covers"
      />
      <label className="block text-[12px] text-[var(--color-muted)] mb-1.5 mt-4">
        Items <span className="text-[var(--color-soft)]">(optional JSON)</span>
      </label>
      <Textarea
        rows={5}
        value={itemsRaw}
        onChange={(e) => setItemsRaw(e.target.value)}
        placeholder={'[{"input": "hello", "expectedOutput": "HELLO"}]'}
      />
      {error && (
        <p className="text-[12px] text-[var(--color-danger)] mt-2">{error}</p>
      )}
    </Dialog>
  );
}

export function DatasetDetailPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  // Datasets are few; subscribe to the full list (incl. archived) and
  // pick this one, so the header reflects archive/version changes live.
  const datasets = useQuery(api.dashboard.listDatasets, {
    includeArchived: true,
  });
  const items = useQuery(api.dashboard.listItems, { datasetId });
  const version = useMutation(api.dashboard.versionDataset);
  const archive = useMutation(api.dashboard.archiveDataset);

  const dataset = useMemo<Dataset | null | undefined>(() => {
    if (datasets === undefined) return undefined;
    return datasets.find((d) => d._id === datasetId) ?? null;
  }, [datasets, datasetId]);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Link
        to="/datasets"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-soft)] hover:text-[var(--color-ink)] mb-3"
      >
        <ArrowLeft size={13} /> Datasets
      </Link>
      <DataState data={dataset} loadingLabel="Loading dataset" emptyTitle="Dataset not found">
        {(d) => (
          <>
            <SectionHeader
              eyebrow={`Dataset · v${d.version}`}
              title={<span className="font-mono text-[20px]">{d.name}</span>}
              actions={
                <>
                  {d.archived ? (
                    <Badge tone="muted">archived</Badge>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const id = await version({ datasetId });
                            navigate(`/datasets/${id}`);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <GitBranch size={13} /> New version
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => setConfirming(true)}
                      >
                        Archive
                      </Button>
                    </>
                  )}
                </>
              }
            />
            {d.description && (
              <p className="text-[13px] text-[var(--color-muted)] mb-4 -mt-2">
                {d.description}
              </p>
            )}
            {error && (
              <p className="text-[12px] text-[var(--color-danger)] mb-3">
                {error}
              </p>
            )}
            <Card>
              <DataState
                data={items}
                loadingLabel="Loading items"
                emptyIcon={<Database size={28} />}
                emptyTitle="No items"
                emptyHint="This dataset version has no items."
              >
                {(rows) => (
                  <Table>
                    <thead>
                      <tr>
                        <th>Input</th>
                        <th>Expected output</th>
                        <th>Tags</th>
                        <th>Slice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((it) => (
                        <tr key={it._id}>
                          <td className="max-w-[22rem]">
                            <pre className="font-mono text-[12px] whitespace-pre-wrap break-words line-clamp-3">
                              {stringifyValue(it.input)}
                            </pre>
                          </td>
                          <td className="max-w-[22rem] text-[var(--color-muted)]">
                            <pre className="font-mono text-[12px] whitespace-pre-wrap break-words line-clamp-3">
                              {it.expectedOutput !== undefined
                                ? stringifyValue(it.expectedOutput)
                                : "—"}
                            </pre>
                          </td>
                          <td className="text-[12px]">
                            {it.tags?.length ? it.tags.join(", ") : "—"}
                          </td>
                          <td className="text-[12px]">{it.slice ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </DataState>
            </Card>

            <ConfirmDialog
              open={confirming}
              onClose={() => setConfirming(false)}
              onConfirm={async () => {
                setBusy(true);
                try {
                  await archive({ datasetId });
                  setConfirming(false);
                  navigate("/datasets");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              title={`Archive ${d.name}`}
              confirmText={d.name}
              confirmLabel="Archive"
              pending={busy}
            >
              <p className="text-[13px] text-[var(--color-muted)] leading-relaxed">
                Archiving removes this dataset from the default listing. Existing
                runs and results are kept. This can be undone by showing archived
                datasets, but the dataset stops appearing in pickers.
              </p>
            </ConfirmDialog>
          </>
        )}
      </DataState>
    </div>
  );
}
