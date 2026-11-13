// The office client's own path from events to a scene plan, without React: the render page runs it
// in the daemon's Chromium. Pure; nothing here touches the DOM.
import { buildOfficeModel, type OfficeModel } from "../client/model.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "../client/office-state.js";
import type { ScenePalette } from "../client/scene/palette.js";
import {
  NO_LAYOUT,
  NO_ROOMS,
  UNMEASURED,
  columnsNow,
  nextLayout,
  shapeAfterResize,
  type ContainerShape,
  type SceneLayout,
} from "../client/scene/scene-layout.js";
import { buildScenePlan, type ScenePlan } from "../client/scene/scene-plan.js";
import type { OfficeEvent, OfficeSnapshot } from "../shared/contracts.js";

export interface RenderPipeline {
  /** Takes one office.state event. Null until there is both a snapshot and a size. */
  apply(event: OfficeEvent): ScenePlan | null;
  /** The view's size in CSS pixels. Null when the size is the one it had, or no size at all. */
  resize(width: number, height: number): ScenePlan | null;
}

export function createRenderPipeline(palette: ScenePalette): RenderPipeline {
  let state: OfficeSnapshot = EMPTY_OFFICE;
  let model: OfficeModel | null = null;
  let shape: ContainerShape = UNMEASURED;
  let layout: SceneLayout = NO_LAYOUT;

  function plan(): ScenePlan | null {
    if (model === null || !shape.sized) return null;
    layout = nextLayout(layout, model, columnsNow(shape, model.rooms.length, layout.columns));
    return layout.layout === null ? NO_ROOMS : buildScenePlan(model, layout.layout, palette);
  }

  return {
    apply(event) {
      state = applyOfficeEvent(state, event);
      // Changes before the first snapshot have nothing to change.
      if (event.type === "snapshot" || model !== null) model = buildOfficeModel(state);
      return plan();
    },
    resize(width, height) {
      const next = shapeAfterResize(shape, width, height);
      if (next === shape) return null;
      shape = next;
      return plan();
    },
  };
}
