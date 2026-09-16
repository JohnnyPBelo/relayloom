import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Sun,
  Moon,
  ShieldCheck,
  RefreshCw,
  LockKeyhole,
  AlertTriangle,
} from "lucide-react";
import { t } from "./i18n/core";
import { LanguageSelector, useLanguage } from "./i18n/selector";
import { WelcomeGuide } from "./onboarding";
export type SetupValues = { name: string; password: string; recovery?: string };
type Props = {
  logo: ReactNode;
  ready: boolean;
  initialized: boolean;
  busy: boolean;
  error: string;
  dark: boolean;
  setDark: (value: boolean) => void;
  largeText: boolean;
  setLargeText: (value: boolean) => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
  onReconnect: () => void;
  onAuthenticate: (values: SetupValues) => void;
};
export function WelcomeScreen({
  logo,
  ready,
  initialized,
  busy,
  error,
  dark,
  setDark,
  largeText,
  setLargeText,
  highContrast,
  setHighContrast,
  onReconnect,
  onAuthenticate,
}: Props) {
  useLanguage();
  const [started, setStarted] = useState(false),
    [fields, setFields] = useState({ name: "", password: "", recovery: "" });
  const change =
    (key: keyof typeof fields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.currentTarget.setCustomValidity("");
      const value = event.currentTarget.value;
      setFields((old) => ({ ...old, [key]: value }));
    };
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (started)
      formRef.current
        ?.querySelector<HTMLInputElement>('input[name="name"]')
        ?.focus();
  }, [started]);
  return (
    <div
      className="welcome"
      data-setup-step={initialized ? "unlock" : started ? "identity" : "intro"}
    >
      <header>
        {logo}
        <LanguageSelector compact />
        <button
          className="icon"
          onClick={() => setDark(!dark)}
          aria-label={t("Alternar tema")}
        >
          {dark ? <Sun /> : <Moon />}
        </button>
      </header>
      <main className="welcome-grid">
        <section>
          <div className="eyebrow">
            <span className="live-dot" /> {t("LIGAÇÕES QUE FICAM")}
          </div>
          <h1>
            {t("Sempre")}
            <br />
            {t("entre")} <em>{t("nós.")}</em>
          </h1>
          <p className="welcome-copy">
            {t("As tuas conversas. A tua comunidade.")}
            <br />
            {t("Uma rede feita pelas pessoas que a usam.")}
          </p>
          <div className="weave" aria-hidden="true">
            <div />
            <div />
            <div />
            <span />
            <span />
            <span />
          </div>
          <div className="welcome-note">
            <ShieldCheck size={20} />
            <p>
              {t("Identidade local. Conteúdo cifrado.")}
              <br />
              <strong>{t("Sem um servidor central obrigatório.")}</strong>
            </p>
          </div>
        </section>

        <section className="onboarding">
          <div className="eyebrow">{t("O TEU PONTO DE PARTIDA")}</div>
          <h2>
            {initialized
              ? t("Bom ter-te de volta.")
              : t("Um novo fio na rede.")}
          </h2>
          <p>
            {initialized
              ? t("Desbloqueia a tua identidade neste dispositivo.")
              : t(
                  "Cria uma identidade. A tua chave fica num cofre cifrado neste dispositivo.",
                )}
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!ready ? (
            <button className="primary" onClick={onReconnect}>
              <RefreshCw size={18} /> {t("Voltar a ligar ao nó")}
            </button>
          ) : (
            <>
              <div hidden={initialized || started}>
                <button
                  className="primary full"
                  type="button"
                  data-action="setup-start"
                  onClick={() => setStarted(true)}
                >
                  {t("Começar")}
                  <ArrowUpRight size={19} />
                </button>
                <WelcomeGuide compact />
              </div>
              <form
                ref={formRef}
                hidden={!initialized && !started}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  onAuthenticate({
                    name: String(data.get("name") ?? ""),
                    password: String(data.get("password") ?? ""),
                    ...(data.get("recovery")
                      ? { recovery: String(data.get("recovery")) }
                      : {}),
                  });
                }}
              >
                {!initialized && (
                  <button
                    className="text-button setup-back"
                    type="button"
                    disabled={busy}
                    onClick={() => setStarted(false)}
                  >
                    {t("Voltar à apresentação")}
                  </button>
                )}
                {!initialized && (
                  <label>
                    {t("Como te chamas?")}
                    <input
                      name="name"
                      value={fields.name}
                      onChange={change("name")}
                      placeholder={t("O teu nome")}
                      maxLength={64}
                      required
                      autoComplete="nickname"
                      onInvalid={(event) =>
                        event.currentTarget.setCustomValidity(
                          t("Indica um nome com 1 a 64 caracteres."),
                        )
                      }
                      pattern=".*\S.*"
                    />
                  </label>
                )}
                <label>
                  {t("Frase-passe")}
                  <input
                    name="password"
                    value={fields.password}
                    onChange={change("password")}
                    type="password"
                    placeholder={t("Pelo menos 12 caracteres")}
                    minLength={12}
                    maxLength={1024}
                    required
                    autoComplete={
                      initialized ? "current-password" : "new-password"
                    }
                    onInvalid={(event) =>
                      event.currentTarget.setCustomValidity(
                        t("Use uma frase-passe com 12 a 1024 caracteres"),
                      )
                    }
                  />
                </label>
                {!initialized && (
                  <details>
                    <summary>{t("Já tenho uma cópia de recuperação")}</summary>
                    <label>
                      {t("Cofre exportado")}
                      <textarea
                        name="recovery"
                        value={fields.recovery}
                        onChange={change("recovery")}
                        placeholder={t(
                          "Cola aqui o conteúdo do teu cofre cifrado",
                        )}
                        aria-label={t("Cofre exportado")}
                      />
                    </label>
                  </details>
                )}
                {!initialized && (
                  <fieldset className="setup-preferences">
                    <legend>{t("Aparência inicial")}</legend>
                    <div className="setup-theme">
                      <button
                        type="button"
                        aria-pressed={!dark}
                        onClick={() => setDark(false)}
                      >
                        {t("Claro")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={dark}
                        onClick={() => setDark(true)}
                      >
                        {t("Escuro")}
                      </button>
                    </div>
                    <label className="setup-toggle">
                      <input
                        type="checkbox"
                        checked={largeText}
                        onChange={(e) => setLargeText(e.target.checked)}
                      />
                      {t("Texto maior")}
                    </label>
                    <label className="setup-toggle">
                      <input
                        type="checkbox"
                        checked={highContrast}
                        onChange={(e) => setHighContrast(e.target.checked)}
                      />
                      {t("Alto contraste")}
                    </label>
                  </fieldset>
                )}
                <button
                  className="primary full"
                  data-action="identity-submit"
                  disabled={busy}
                >
                  {busy
                    ? t("A proteger a identidade…")
                    : initialized
                      ? t("Entrar na minha rede")
                      : t("Criar identidade")}
                  <ArrowUpRight size={19} />
                </button>
                <div className="small-note">
                  <LockKeyhole size={14} />{" "}
                  {t("A frase-passe não sai deste nó local.")}
                </div>
              </form>
            </>
          )}
          <div className="experimental">
            <AlertTriangle size={17} />
            <p>
              {t(
                "Rede experimental. Não é infraestrutura de emergência validada nem substitui os serviços de emergência.",
              )}
            </p>
          </div>
        </section>
      </main>
      <footer>
        RELAYLOOM <span>{t("Conversar é criar caminhos.")}</span>
        <span>{t("Construído para aproximar.")}</span>
      </footer>
    </div>
  );
}
