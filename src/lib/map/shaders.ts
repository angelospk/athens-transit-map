// The shader effects of the 3D mode (scene3d.ts): the beams of a bus's headlights on the road at night. Each shares one time
// uniform, advanced by the scene while it draws; with reduced motion the time stands still.
import type * as Three from "three";

export type Clock = { value: number };

/** The beam of a bus's two headlights on the road ahead (+x), as a soft additive cone: night only. */
export function headlightBeam(T: typeof Three): Three.Mesh {
  const len = 14, wide = 7;
  const g = new T.PlaneGeometry(len, wide);
  g.translate(6.2 + len / 2, 0, 0.07);
  const mat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    uniforms: { uColor: { value: new T.Color(0xffe2a8) } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float d = vUv.x;                                  // 0 at the bumper, 1 at the far end
        float half_ = mix(0.12, 0.5, d);                  // the cone widens ahead
        float a = 1.0 - smoothstep(half_ * 0.55, half_, abs(vUv.y - 0.5));
        a *= (1.0 - smoothstep(0.15, 1.0, d)) * smoothstep(0.0, 0.08, d);
        gl_FragColor = vec4(uColor * a * 0.55, 1.0);
      }`,
  });
  const m = new T.Mesh(g, mat);
  m.name = "beam";
  m.renderOrder = 5;
  return m;
}

/** The soft light under a street lamp: an open cone from the lamp head (top) to the road, brightest near the lamp
 *  and fading to nothing at the ground, added onto what is behind it. One instance per lamp. */
export function lampCone(T: typeof Three, count: number, height = 5.8): Three.InstancedMesh {
  const g = new T.CylinderGeometry(0.22, 3.4, height, 28, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, height / 2);
  const mat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
    uniforms: { uColor: { value: new T.Color(0xffd59a) }, uH: { value: height } },
    vertexShader: `
      uniform float uH; varying float vH;
      void main() {
        vH = clamp(position.z / uH, 0.0, 1.0);
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vH;
      void main() {
        float a = 0.11 * pow(vH, 1.6) + 0.025 * smoothstep(0.0, 0.25, vH);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const m = new T.InstancedMesh(g, mat, Math.max(1, count));
  m.frustumCulled = false;
  m.renderOrder = 6;
  return m;
}
