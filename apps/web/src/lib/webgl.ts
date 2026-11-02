interface ContextProbe { getContext(kind: string): unknown }

/** Whether a webgl2 or webgl context can be created (the R3F lobby background needs one). */
export function hasWebGL(createCanvas: () => ContextProbe = () => document.createElement("canvas")): boolean {
  try {
    const c = createCanvas();
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
