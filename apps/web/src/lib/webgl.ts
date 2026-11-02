interface ProbeContext { getExtension?(name: string): { loseContext?(): void } | null }
interface ContextProbe { getContext(kind: string): unknown }

/** Whether a webgl2 or webgl context can be created (the R3F lobby background needs one). */
export function hasWebGL(createCanvas: () => ContextProbe = () => document.createElement("canvas")): boolean {
  try {
    const c = createCanvas();
    const ctx = (c.getContext("webgl2") ?? c.getContext("webgl")) as ProbeContext | null;
    if (!ctx) return false;
    // Browsers cap live GL contexts: release the probe's slot right away.
    try {
      ctx.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    } catch {
      /* best effort */
    }
    return true;
  } catch {
    return false;
  }
}
