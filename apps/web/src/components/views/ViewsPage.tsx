"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import useAuth from "@/context/useAuth";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import ResourceList from "@/components/views/ResourceList";
import ViewDialogComponent from "@/components/views/ViewDialog";
import {
  createViewAction,
  deleteViewAction,
  describeViewQuery,
  listViewAction,
  runViewAction,
  updateViewAction,
  type ViewRecord,
  type ViewResourcePage,
  type ViewWriteInput,
} from "@/lib/viewsApi";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/** Runs one saved view against the evaluation endpoint and renders the page. */
function ViewRun({ view }: { view: ViewRecord }) {
  const { token } = useAuth();
  const runQuery = useApiQuery<ViewResourcePage>(
    queryKeys.views.run(token, view.id),
    (auth) => runViewAction(auth, view.id),
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white/85">{view.name}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => runQuery.refetch()}>
          <RefreshCw /> refresh
        </Button>
      </div>
      {runQuery.isPending ? (
        <div className="frosted rounded-2xl p-8 text-center text-sm text-white/60">running…</div>
      ) : runQuery.isError ? (
        <div className="frosted rounded-2xl p-4 text-sm text-red-300">
          {errorMessage(runQuery.error, "view query failed")}
        </div>
      ) : (
        <ResourceList page={runQuery.data} presentation={view.definition?.presentation} />
      )}
    </section>
  );
}

export default function ViewsPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<ViewRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ViewRecord | null>(null);
  const [activeView, setActiveView] = useState<ViewRecord | null>(null);

  const viewsKey = ["api", token, ...queryKeys.views.root(token)] as const;
  const viewsQuery = useApiQuery<ViewRecord[]>(queryKeys.views.root(token), listViewAction);
  const views = viewsQuery.data ?? [];

  const saveMutation = useApiMutation<ViewRecord, { view: ViewRecord | null; input: ViewWriteInput }>(
    (auth, { view, input }) => (view ? updateViewAction(auth, view.id, input) : createViewAction(auth, input)),
    {
      onSuccess: (saved) => {
        queryClient.setQueryData<ViewRecord[]>(viewsKey, (current = []) => {
          const rest = current.filter((existing) => existing.id !== saved.id);
          return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name));
        });
        setActiveView((current) => (current && current.id === saved.id ? saved : current));
        void queryClient.invalidateQueries({ queryKey: ["api", token, ...queryKeys.views.run(token, saved.id)] });
        setDialogOpen(false);
      },
    },
  );

  const deleteMutation = useApiMutation<void, { viewId: string }>(
    (auth, { viewId }) => deleteViewAction(auth, viewId),
    {
      onSuccess: (_data, { viewId }) => {
        queryClient.setQueryData<ViewRecord[]>(viewsKey, (current = []) =>
          current.filter((existing) => existing.id !== viewId));
        setActiveView((current) => (current && current.id === viewId ? null : current));
        setDeleteTarget(null);
      },
    },
  );

  const openCreate = () => {
    setEditingView(null);
    setDialogOpen(true);
  };

  const openEdit = (view: ViewRecord) => {
    setEditingView(view);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">views</h1>
          <p className="text-sm text-white/60">saved resource queries you can run any time</p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus /> new view
        </Button>
      </div>

      {viewsQuery.isPending ? (
        <div className="frosted rounded-2xl p-8 text-center text-sm text-white/60">loading views…</div>
      ) : viewsQuery.isError ? (
        <div className="frosted rounded-2xl p-4 text-sm text-red-300">
          {errorMessage(viewsQuery.error, "could not load views")}
        </div>
      ) : views.length === 0 ? (
        <div className="frosted rounded-2xl p-8 text-center space-y-3">
          <p className="text-sm text-white/60">no saved views yet</p>
          <Button type="button" variant="secondary" size="sm" onClick={openCreate}>
            <Plus /> create a view
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {views.map((view) => {
            const summary = describeViewQuery(view.definition?.query);
            return (
              <div key={view.id} className="frosted rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold leading-tight break-words">{view.name}</p>
                    <p className="text-xs text-white/45">updated {formatDate(view.updatedAt)}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`actions for ${view.name}`}
                      >
                        <MoreHorizontal className="text-white/70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="frosted bg-black/70 text-foreground min-w-36">
                      <DropdownMenuItem onSelect={() => setActiveView(view)}>
                        <Play /> run
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openEdit(view)}>
                        <Pencil /> edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDeleteTarget(view)}>
                        <Trash2 /> delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {summary.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {summary.map((part) => (
                      <span
                        key={part}
                        className="text-[10px] px-1.5 py-0 rounded-md border border-white/10 text-white/70 font-mono"
                      >
                        {part}
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveView(view)}
                >
                  <Play /> run
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {activeView && (
        <ViewRun key={activeView.id} view={activeView} />
      )}

      <ViewDialogComponent
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        view={editingView}
        onSaved={(input) => saveMutation.mutateAsync({ view: editingView, input })}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="frosted bg-black/70 border-white/20 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>delete view</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              delete "{deleteTarget?.name}"? saved views cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) deleteMutation.mutate({ viewId: deleteTarget.id });
              }}
            >
              {deleteMutation.isPending ? "deleting…" : "delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
