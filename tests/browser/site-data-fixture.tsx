// Standalone component fixture; never imported into the shipped application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SiteTableView } from "../../apps/web/src/site/table";
import { SiteStudio } from "../../apps/web/src/site/studio";
import { templateSite, type StudioValue } from "../../apps/web/src/site/model";
import { authoredTable } from "../fixtures/site-table";
import "../../apps/web/src/style.css";
import "../../apps/web/src/liquid-glass.css";
const root = createRoot(document.getElementById("root")!);
(window as any).showTable = (value: unknown) =>
  root.render(
    <main style={{ padding: 24, maxWidth: 900, margin: "auto" }}>
      <h1>Dados declarativos em verificação</h1>
      <SiteTableView data={value} title="Pontos da comunidade" />
    </main>,
  );

function Studio() {
  const [value, setValue] = useState<StudioValue>(() => {
    const value = templateSite("journal", "Autora");
    value.site.version = 2;
    value.site.pages[0].blocks = [
      {
        id: "data",
        type: "table",
        title: "Lugares",
        body: "",
        data: authoredTable(),
      },
    ];
    return value;
  });
  return (
    <main>
      <h1>Estúdio em verificação</h1>
      <SiteStudio
        value={value}
        onChange={setValue}
        owner="Autora"
        posts={[]}
        busy={false}
        onPublish={async () => {}}
        onSave={() =>
          new Promise<void>((done) => {
            (window as any).completeSave = () => {
              const original = window.requestAnimationFrame;
              const pending: FrameRequestCallback[] = [];
              window.requestAnimationFrame = (callback) => {
                pending.push(callback);
                return pending.length;
              };
              (window as any).releaseSaveFrames = () => {
                window.requestAnimationFrame = original;
                for (const callback of pending) callback(performance.now());
              };
              done();
            };
          })
        }
      />
    </main>
  );
}
(window as any).showStudio = () => root.render(<Studio />);
