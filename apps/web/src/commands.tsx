import { t, getLanguage } from "./i18n/core";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Search, X, type LucideIcon } from "lucide-react";

export type Command = {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
};
const normalise = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase(getLanguage());

/** Only mounted while unlocked and open. No independent index or persistent queries. */
export function CommandPalette({
  commands,
  close,
}: {
  commands: Command[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const terms = normalise(query).trim().split(/\s+/);
  const matches = commands.filter((c) =>
    terms.every((term) =>
      normalise(`${c.label} ${c.detail} ${c.keywords ?? ""}`).includes(term),
    ),
  );
  const results = matches.slice(0, 40);
  const selected = Math.min(active, Math.max(results.length - 1, 0));
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      if (before?.isConnected) before.focus();
    };
  }, []);
  useEffect(() => {
    document
      .getElementById(`${id}-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query, id]);
  function select(command: Command) {
    close();
    command.run();
  }
  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="command-heading">
        <div>
          <span className="eyebrow">{t("AO ALCANCE DE UM GESTO")}</span>
          <h2 id={`${id}-title`}>{t("O teu espaço, mais perto.")}</h2>
        </div>
        <button
          className="icon"
          aria-label={t("Fechar pesquisa")}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="command-input">
        <Search size={22} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={t("Pesquisar no teu espaço")}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${id}-results`}
          aria-activedescendant={
            results.length ? `${id}-${selected}` : undefined
          }
          aria-describedby={`${id}-scope`}
          autoComplete="off"
          spellCheck={false}
          maxLength={256}
          placeholder={t("Uma conversa, uma mensagem, um destino…")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key))
              event.preventDefault();
            if (event.key === "ArrowDown")
              setActive((selected + 1) % Math.max(results.length, 1));
            if (event.key === "ArrowUp")
              setActive(
                (selected + results.length - 1) % Math.max(results.length, 1),
              );
            if (event.key === "Enter" && results[selected])
              select(results[selected]);
          }}
        />
      </div>
      <p className="command-scope" id={`${id}-scope`}>
        {t(
          "Conversas e mensagens carregadas neste dispositivo. Só conteúdo a que tens acesso.",
        )}
      </p>
      <div
        className="command-results"
        id={`${id}-results`}
        role="listbox"
        aria-label={t("Resultados da pesquisa")}
      >
        {results.map((command, index) => (
          <div
            role="option"
            aria-selected={index === selected}
            id={`${id}-${index}`}
            key={command.id}
            className="command-result"
            onClick={() => select(command)}
          >
            <span className="command-symbol">
              <command.icon size={20} />
            </span>
            <span className="command-copy">
              <strong>{command.label}</strong>
              <span>{command.detail}</span>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </div>
        ))}
      </div>
      {!results.length && (
        <div className="command-empty">
          <Search size={26} />
          <strong>{t("Nenhum fio encontrado.")}</strong>
          <p>
            {t(
              "Experimenta outra palavra ou carrega mais histórico na conversa.",
            )}
          </p>
        </div>
      )}
      <footer className="command-footer">
        <span role="status">
          {matches.length > 40
            ? t("40 primeiros resultados · refina a pesquisa")
            : `${results.length} ${results.length === 1 ? t("resultado") : t("resultados")}`}
        </span>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("explorar")} <kbd>↵</kbd> {t("abrir")} <kbd>esc</kbd>{" "}
          {t("fechar")}
        </span>
      </footer>
    </dialog>
  );
}
