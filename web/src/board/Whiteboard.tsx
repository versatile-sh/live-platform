import { CaptureUpdateAction, Excalidraw, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useState } from "react";

import type { BoardElement, BoardSync } from "./board-sync";
import { wins } from "./board-sync";

type Api = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["excalidrawAPI"]>>[0];
type SceneElements = Parameters<Api["updateScene"]>[0]["elements"];

(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/assets/board/";

function clean(elements: readonly BoardElement[]): NonNullable<SceneElements> {
  return restoreElements(elements as never, null);
}

/** The room's shared whiteboard: what I draw goes to the others, and what they draw is merged into mine without entering my undo history. */
export default function Whiteboard({ sync, langCode }: { sync: BoardSync; langCode: string }) {
  const [api, setApi] = useState<Api | undefined>();

  useEffect(() => {
    if (!api) return;
    const merge = () => {
      const mine = api.getSceneElementsIncludingDeleted() as unknown as readonly BoardElement[];
      const byId = new Map(mine.map((element) => [element.id, element]));
      const incoming = sync.getSnapshot().filter((element) => wins(element, byId.get(element.id)));
      if (incoming.length === 0) return;
      for (const element of clean(incoming) as unknown as BoardElement[]) byId.set(element.id, element);
      api.updateScene({ elements: [...byId.values()] as never, captureUpdate: CaptureUpdateAction.NEVER });
    };
    merge();
    return sync.subscribe(merge);
  }, [api, sync]);

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={{ elements: clean(sync.getSnapshot()), appState: { viewBackgroundColor: "#0e1116" } }}
      theme="dark"
      langCode={langCode}
      UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: false } }}
      onChange={(elements) => sync.local(elements as unknown as readonly BoardElement[])}
    />
  );
}
