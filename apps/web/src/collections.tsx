import React, { useState } from "react";
import { Plus, Pencil, Trash2, Bookmark, ArrowUpRight } from "lucide-react";
import type { Collection, CollectionCommand } from "../../node/src/social";
export function CollectionManager({
  collections,
  selected,
  onSelect,
  onCommand,
}: {
  collections: Collection[];
  selected: string;
  onSelect: (id: string) => void;
  onCommand: (command: CollectionCommand) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string>(),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="collection-manager">
      <header>
        <h3>As minhas colecções</h3>
        <button
          className="icon"
          aria-label="Criar colecção"
          onClick={() => {
            setEditing("new");
            setTitle("");
          }}
        >
          <Plus size={17} />
        </button>
      </header>
      <button
        className={"collection-choice " + (!selected ? "selected" : "")}
        aria-pressed={!selected}
        onClick={() => onSelect("")}
      >
        <Bookmark size={17} /> Todos os guardados
      </button>
      {collections.map((c) => (
        <div className="collection-row" key={c.id}>
          <button
            className={
              "collection-choice " + (selected === c.id ? "selected" : "")
            }
            aria-pressed={selected === c.id}
            onClick={() => onSelect(c.id)}
          >
            {c.title}
            <span>{c.objectIds.length}</span>
          </button>
          <button
            className="icon"
            aria-label={`Renomear colecção ${c.title}`}
            onClick={() => {
              setEditing(c.id);
              setTitle(c.title);
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            className="icon"
            aria-label={`Eliminar colecção ${c.title}`}
            onClick={async () => {
              await onCommand({ action: "delete", id: c.id });
              if (selected === c.id) onSelect("");
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const result = await onCommand(
              editing === "new"
                ? { action: "create", id: crypto.randomUUID(), title }
                : { action: "rename", id: editing, title },
            );
            setBusy(false);
            if (result) setEditing(undefined);
          }}
        >
          <label>
            Nome da colecção
            <input
              value={title}
              required
              maxLength={64}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="collection-form-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setEditing(undefined)}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              Guardar colecção
            </button>
          </div>
        </form>
      )}
      <p className="muted">
        Colecções privadas e cifradas neste dispositivo. Guardar uma referência
        não altera a autoria nem impede a limpeza da cache.
      </p>
    </div>
  );
}
