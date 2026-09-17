import { sitePublishing } from "./site-publishing";
import { runtimeErrors } from "./runtime-errors";
import { validation } from "./validation";
import { studio } from "./studio";
import { siteContent } from "./site-content";
import { groups } from "./groups";
import { participation } from "./participation";
import { media, notifications } from "./media";
import { connections } from "./connections";
import { delivery } from "./delivery";
import { shell } from "./shell";
import { surfaces } from "./surfaces";
import { messenger } from "./messenger";
import { welcome } from "./welcome";
/** Source keys describe UI copy only. Do not look up authored content. */
export const messageRows: readonly (readonly [string, string, string])[] = [
  ...welcome,
  ...surfaces,
  ...messenger,
  ...shell,
  ...connections,
  ...delivery,
  ...media,
  ...notifications,
  ...participation,
  ...groups,
  ...studio,
  ...sitePublishing,
  ...siteContent,
  ...validation,
  ...runtimeErrors,
  ["Idioma", "Language", "Idioma"],
  ["Idioma da aplicação", "Application language", "Idioma de la aplicación"],
  [
    "A escolha aplica-se à interface. As mensagens e as páginas mantêm o texto original.",
    "This changes the interface. Messages and pages keep their original text.",
    "Esto cambia la interfaz. Los mensajes y las páginas conservan su texto original.",
  ],
  [
    "O idioma mudou nesta sessão, mas este navegador não permitiu guardar a preferência.",
    "The language changed for this session, but this browser could not save the preference.",
    "El idioma ha cambiado en esta sesión, pero este navegador no ha permitido guardar la preferencia.",
  ],
];
export const messages: Record<string, { "en-GB": string; "es-ES": string }> =
  Object.fromEntries(
    messageRows.map(([source, en, es]) => [
      source,
      { "en-GB": en, "es-ES": es },
    ]),
  );
