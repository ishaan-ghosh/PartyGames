import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";

const COLORS = ["#7f5af0", "#ff8906", "#e53170", "#2cb67d"];
const SHAPES = Array.from({ length: 14 }, (_, i) => ({
  pos: [((i * 7) % 13) - 6, ((i * 5) % 9) - 4, -3 - (i % 4)] as [number, number, number],
  color: COLORS[i % COLORS.length]!,
  speed: 0.15 + (i % 5) * 0.06,
  kind: i % 3,
}));

function Shape({ pos, color, speed, kind }: (typeof SHAPES)[number]) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime * speed;
    m.rotation.set(t, t * 0.7, 0);
    m.position.y = pos[1] + Math.sin(t * 2) * 0.4;
  });
  return (
    <mesh ref={ref} position={pos}>
      {kind === 0 ? (
        <icosahedronGeometry args={[0.6, 0]} />
      ) : kind === 1 ? (
        <torusGeometry args={[0.5, 0.18, 16, 32]} />
      ) : (
        <octahedronGeometry args={[0.6, 0]} />
      )}
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
    </mesh>
  );
}

/** Subtle floating shapes behind the screen lobby. Lazy-loaded; skipped for reduced motion. */
export default function LobbyBackground() {
  return (
    <div className="lobby-bg" aria-hidden>
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        {SHAPES.map((s, i) => <Shape key={i} {...s} />)}
      </Canvas>
    </div>
  );
}
