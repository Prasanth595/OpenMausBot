import { useEffect, useRef } from "react";
import { CssSphere, SphereCanvas } from "../../third_party/zap-dot/spheres/react";
import { SphereScene } from "../../third_party/zap-dot/spheres/scene";
import type { ZapDotShape } from "../../shared/zap-dot-appearance";
import type { ZapDotMood } from "@/lib/zap-dot-state";
import "../../third_party/zap-dot/ZapDot.css";
import "./ZapDot.css";

type ZapDotProps = {
  size: number;
  color: string;
  seed: string;
  shape: ZapDotShape;
  mood: ZapDotMood;
  paused?: boolean;
  look?: { x: number; y: number };
};

export function ZapDot({ size, color, seed, shape, mood, paused = false, look }: ZapDotProps) {
  const sceneRef = useRef<SphereScene | null>(null);
  const pad = size * 0.45;
  const box = size + pad * 2;
  const dim = mood === "killed" ? 0.85 : 0;
  useEffect(() => { sceneRef.current?.setMood(seed, mood); }, [seed, mood]);
  useEffect(() => {
    sceneRef.current?.update(seed, { radius: size / 2, color, shape, dim });
  }, [seed, size, color, shape, dim]);

  const sprite = <CssSphere size={size} color={color} seed={seed} shape={shape} dim={dim} mood={mood} look={look} glow={0.8} />;
  if (size < 120 || paused) return sprite;
  return (
    <SphereCanvas
      key={seed}
      style={{ width: box, height: box, margin: -pad }}
      options={{ quality: "high" }}
      fallback={<span style={{ position: "absolute", inset: pad }}>{sprite}</span>}
      onReady={(scene) => {
        sceneRef.current = scene;
        scene.add({ id: seed, x: box / 2, y: box / 2, radius: size / 2, color, shape, dim, glow: 1 });
        scene.setMood(seed, mood);
        return () => { sceneRef.current = null; };
      }}
    />
  );
}
