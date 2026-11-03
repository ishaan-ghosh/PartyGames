import "./doodle.css";
import type { ClientGame } from "@party/ui";
import { doodleDash } from "../rules";
import { DoodlePhone } from "./DoodlePhone";
import { DoodleScreen } from "./DoodleScreen";
import { DoodleSettingsForm } from "./DoodleSettingsForm";

export const doodleClient: ClientGame = {
  id: doodleDash.id,
  meta: doodleDash.meta,
  emoji: "🎨",
  Screen: DoodleScreen,
  Phone: DoodlePhone,
  Settings: DoodleSettingsForm,
};

export { applyOp, CANVAS_H, CANVAS_W, floodFillData, hexToRgb, renderStrokes } from "./strokes";
