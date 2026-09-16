import { t, getLanguage } from "./i18n/core";
import React, { useState } from "react";
import {
  ArrowUpRight,
  Bluetooth,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import "./relay-participation.css";

export function RelayParticipation({
  enabled,
  peers,
  autonomous,
  busy,
  onChange,
  onConnect,
}: {
  enabled: boolean;
  peers: number;
  autonomous: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => Promise<unknown>;
  onConnect: () => void;
}) {
  const [requested, setRequested] = useState<boolean>();
  async function change(value: boolean) {
    setRequested(value);
    try {
      await onChange(value);
    } finally {
      setRequested(undefined);
    }
  }
  return (
    <section
      className="card relay-participation"
      aria-label={t("Ajudar a rede")}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {t("O TEU DISPOSITIVO, MAIS UM CAMINHO")}
          </span>
          <h2>{t("Ajuda a manter a rede ligada")}</h2>
        </div>
        <ShieldCheck aria-hidden="true" size={26} />
      </div>
      <p>
        {t(
          "Permite a passagem de pacotes entre outros dispositivos. O conteúdo privado continua cifrado para as pessoas autorizadas.",
        )}
      </p>
      <label className="toggle-row">
        <div>
          <strong>{t("Permitir retransmissão")}</strong>
          <span>
            {t(
              "Podes pausar quando quiseres. A tua escolha fica guardada neste perfil.",
            )}
          </span>
        </div>
        <input
          type="checkbox"
          aria-label={t("Permitir retransmissão")}
          checked={requested ?? enabled}
          disabled={busy || requested !== undefined}
          aria-busy={requested !== undefined}
          onChange={(e) => void change(e.target.checked)}
        />
      </label>
      <div className="relay-readiness" role="status">
        <Radio aria-hidden="true" size={20} />
        <div>
          <strong>
            {requested !== undefined
              ? t("A guardar a tua escolha…")
              : !enabled
                ? t("Retransmissão em pausa")
                : peers === 0
                  ? t("Pronto para retransmitir · falta ligar pares")
                  : t("Retransmissão permitida")}
          </strong>
          <p>
            {peers === 0
              ? t(
                  "Ainda não há dispositivos ligados. Troca um código para abrir o primeiro caminho.",
                )
              : t(
                  peers === 1
                    ? "{count} ligação disponível. Os pacotes só avançam quando existe um caminho até ao destino."
                    : "{count} ligações disponíveis. Os pacotes só avançam quando existe um caminho até ao destino.",
                  { count: peers },
                )}
          </p>
        </div>
        <button className="secondary" onClick={onConnect}>
          {t("Ligar outro dispositivo")} <ArrowUpRight size={17} />
        </button>
      </div>
      <p className="small-note">
        {autonomous
          ? t(
              "Mantém este separador aberto e o perfil desbloqueado. O browser ou o sistema podem suspender a rede em segundo plano.",
            )
          : t(
              "Mantém a aplicação em execução. O sistema pode limitar a actividade em segundo plano.",
            )}{" "}
        {t(
          "Adicionar um cartão guarda um contacto; a ligação à rede é feita separadamente.",
        )}
      </p>
      <details className="relay-capabilities">
        <summary>{t("Wi-Fi, Bluetooth e outros meios")}</summary>
        <div>
          <Wifi aria-hidden="true" size={20} />
          <p>
            <strong>{t("Wi-Fi, cabo ou dados móveis")}</strong>
            {t(
              "A aplicação usa a rede disponível através dos pares ligados. O destinatário é escolhido na conversa; o percurso pode passar por vários dispositivos. Ainda não há descoberta automática nem garantia de atravessar qualquer rede.",
            )}
          </p>
        </div>
        <div>
          <Bluetooth aria-hidden="true" size={20} />
          <p>
            <strong>{t("Bluetooth directo · por implementar")}</strong>
            {autonomous
              ? t(
                  "Abrir esta página não transforma o browser num relay Bluetooth. Os browsers também não oferecem as mesmas capacidades de rádio em todos os sistemas.",
                )
              : t(
                  "Esta versão ainda não tem um adaptador Bluetooth directo validado.",
                )}
          </p>
        </div>
        <div>
          <Radio aria-hidden="true" size={20} />
          <p>
            <strong>{t("Outros meios através de pares compatíveis")}</strong>
            {t(
              "A integração Reticulum pode ligar percursos por TCP e série com adaptadores configurados numa aplicação instalada. Os testes com portas série virtuais não validam rádios físicos.",
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
