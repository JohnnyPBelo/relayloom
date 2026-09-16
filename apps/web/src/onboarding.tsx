import React, { useState } from "react";
import {
  KeyRound,
  MessageCircle,
  Users,
  PanelsTopLeft,
  Settings2,
} from "lucide-react";
import { t } from "./i18n/core";
import { useLanguage } from "./i18n/selector";
export function WelcomeGuide({ compact = false }: { compact?: boolean }) {
  useLanguage();
  const [topic, setTopic] = useState<"messages" | "community" | "sites">(
    "messages",
  );
  const topics = [
    {
      id: "messages" as const,
      name: "Mensagens",
      icon: MessageCircle,
      title: "Um contacto e uma ligação são coisas diferentes.",
      text: "Troca cartões para reconhecer as pessoas. Em A rede, liga um par com o código e a resposta. Sem um caminho disponível, a mensagem fica em espera.",
    },
    {
      id: "community" as const,
      name: "Comunidade",
      icon: Users,
      title: "Partilha com as pessoas que escolheres.",
      text: "Publicações, comentários e guardados vivem nos dispositivos. O conteúdo público pode ser copiado; apagar não recolhe cópias já distribuídas.",
    },
    {
      id: "sites" as const,
      name: "Páginas",
      icon: PanelsTopLeft,
      title: "Constrói um lugar teu na rede.",
      text: "Cria páginas com blocos, composições e imagens. A tua assinatura mantém a autoria; um leitor pode distribuir a cópia sem ganhar permissão para a editar.",
    },
  ];
  const current = topics.find((t) => t.id === topic)!;
  return (
    <section
      className={"welcome-guide" + (compact ? " compact" : "")}
      aria-label={t("Como funciona o RelayLoom")}
    >
      <div className="eyebrow">{t("Primeiros passos")}</div>
      <article>
        <KeyRound aria-hidden="true" />
        <div>
          <h3>{t("Uma identidade tua, sem inscrição num servidor.")}</h3>
          <p>
            {t(
              "A frase-passe abre o teu cofre neste dispositivo. Guarda uma cópia de recuperação e a frase-passe em locais separados.",
            )}
          </p>
        </div>
      </article>
      <div className="guide-topics" aria-label={t("Como funciona o RelayLoom")}>
        {topics.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={topic === item.id}
            onClick={() => setTopic(item.id)}
          >
            <item.icon size={17} aria-hidden="true" />
            {t(item.name)}
          </button>
        ))}
      </div>
      <div className="guide-explanation" aria-live="polite">
        <h3>{t(current.title)}</h3>
        <p>{t(current.text)}</p>
      </div>
      <article>
        <Settings2 aria-hidden="true" />
        <div>
          <h3>{t("Ajusta a aplicação ao teu ritmo.")}</h3>
          <p>
            {t(
              "Escolhe o idioma e a aparência agora. Depois de entrar, em A rede e Definições, escolhe a participação, o consumo e o armazenamento.",
            )}
          </p>
        </div>
      </article>
      <small>{t("Podes voltar a este guia nas definições.")}</small>
    </section>
  );
}
