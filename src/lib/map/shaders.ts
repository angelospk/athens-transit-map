// The shader effects of the 3D mode (scene3d.ts): trees that sway in the wind, with their lower leaves in shade;
// rain streaks around the view; the beams of a bus's headlights on the road at night. Each shares one time
// uniform, advanced by the scene while it draws; with reduced motion the time stands still.
import type * as Three from "three";

export type Clock = { value: number };

/** A tree crown material: the instances sway (more at the top) and darken towards their base. */
export function swayMaterial(T: typeof Three, time: Clock, flat = false): Three.MeshLambertMaterial {
  const mat = new T.MeshLambertMaterial({ flatShading: flat });   // smooth: soft lumps; flat: facets («Μινιατούρα»)
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vUp;")
      .replace("#include <project_vertex>", `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          // A phase from the tree's place, so neighbours do not move as one; the top moves most.
          float ph = mvPosition.x * 0.13 + mvPosition.y * 0.17;
          float k = clamp((transformed.z + 1.0) * 0.5, 0.0, 1.0);
          mvPosition.xy += vec2(sin(uTime * 1.3 + ph), cos(uTime * 0.9 + ph * 1.7)) * 0.22 * k * k;
        #endif
        vUp = clamp((transformed.z + 1.0) * 0.5, 0.0, 1.0);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.72, 1.12, vUp);");
  };
  mat.customProgramCacheKey = () => (flat ? "x3d-sway-flat" : "x3d-sway");
  return mat;
}

/** Rain: thin streaks falling through a box that follows the view. The scene sets its centre (uCenter) and its size
 *  (uBox, metres across, to cover what is in view) each frame, so the rain fills the screen at any zoom. */
export function rain(T: typeof Three, time: Clock, dark: boolean, count = 14000): Three.LineSegments {
  const seeds = new Float32Array(count * 2 * 3), ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const sx = Math.random(), sy = Math.random(), sz = Math.random();
    for (const e of [0, 1]) {
      seeds.set([sx, sy, sz], (i * 2 + e) * 3);
      ends[i * 2 + e] = e;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 2 * 3), 3));   // unused: placed in the shader
  g.setAttribute("seed", new T.BufferAttribute(seeds, 3));
  g.setAttribute("end", new T.BufferAttribute(ends, 1));
  const mat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: time, uCenter: { value: new T.Vector2() }, uBox: { value: 200 }, uColor: { value: new T.Color(dark ? 0xd4dce8 : 0x6f8098) },
      uAlpha: { value: dark ? 0.6 : 0.5 } },
    vertexShader: `
      attribute vec3 seed; attribute float end;
      uniform float uTime; uniform vec2 uCenter; uniform float uBox;
      varying float vFade;
      void main() {
        float BOX = uBox, H = clamp(uBox * 0.35, 60.0, 260.0);
        vec2 drift = vec2(0.9, 0.3) * uTime;                       // a light wind
        vec2 xy = uCenter + mod(seed.xy * BOX + drift - uCenter, BOX) - BOX * 0.5;
        float z = H - mod(uTime * 11.0 + seed.z * H, H);              // 11 m/s
        z += end * 2.2;                                               // the streak's length
        xy -= end * vec2(0.09, 0.03);
        vFade = smoothstep(0.0, 6.0, z) * (1.0 - smoothstep(H - 10.0, H, z)) * (0.4 + 0.6 * end);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; varying float vFade;
      void main() { gl_FragColor = vec4(uColor, uAlpha * vFade); }`,
  });
  const lines = new T.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  return lines;
}

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
