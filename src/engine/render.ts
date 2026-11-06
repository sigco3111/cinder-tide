// WebGL2 renderer: lit pixels, a soft lit gas layer (steam, cloud, smoke), light spill from emissive pixels, bloom,
// golden-hour sky, capsule SDF sprites for the hero and effects, and a graded composite.
// Pipeline: cells (only the camera window is packed and uploaded) + capsules -> MRT (albedo, emissive)
//   -> gas density (cell res, blurred) -> emissive mip chain (light + bloom) -> composite.
import { COLOR, ST, World, GAS } from './sim';

const VS_FULL = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const COMMON = `
uniform vec2 uCam; uniform float uScale; uniform vec2 uRes; uniform vec2 uOrigin; uniform vec2 uTexSize;
vec2 worldAt(vec2 frag){ return uCam + vec2(frag.x, uRes.y - frag.y) / uScale; }
`;

const FS_WORLD = `#version 300 es
precision highp float; precision highp usampler2D;
in vec2 vUv;
uniform usampler2D uCells; uniform sampler2D uPal; uniform vec2 uWorld; uniform float uTime;
uniform vec3 uSkyTop, uSkyMid, uSkyLow, uSun, uHaze; uniform vec2 uSunPos; uniform float uSea;
${COMMON}
layout(location=0) out vec4 oAlb; layout(location=1) out vec4 oEmit;
float h11(float p){ return fract(sin(p*127.1)*43758.5453); }
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h11(i),h11(i+1.),f); }
float fbm(float x){ return n1(x)*0.55+n1(x*2.1+3.)*0.28+n1(x*4.3+7.)*0.17; }
uvec4 cellAt(ivec2 c){
  ivec2 t = c - ivec2(uOrigin);
  if(c.x<0||c.y<0||c.x>=int(uWorld.x)||c.y>=int(uWorld.y)) return uvec4(19u,0u,0u,0u);
  if(t.x<0||t.y<0||t.x>=int(uTexSize.x)||t.y>=int(uTexSize.y)) return uvec4(1u,0u,0u,0u);
  return texelFetch(uCells, t, 0);
}
uint stOf(uint t){ return uint(texelFetch(uPal, ivec2(int(t),1), 0).r*255.+0.5); }
bool solidAt(ivec2 c){ uint s = stOf(cellAt(c).r); return s==1u || s==2u; }
bool roofAt(ivec2 c){ uvec4 v = cellAt(c); return stOf(v.r)==1u && (v.a & 192u) == 0u; }
vec3 blackbody(float T){
  float k = clamp((T-480.)/1700., 0., 1.);
  vec3 c = mix(vec3(0.6,0.05,0.0), vec3(1.0,0.35,0.05), smoothstep(0.,0.35,k));
  c = mix(c, vec3(1.0,0.75,0.35), smoothstep(0.35,0.75,k));
  c = mix(c, vec3(1.0,0.97,0.85), smoothstep(0.75,1.,k));
  return c * (k*k*6.0 + k*0.6);
}
void main(){
  // one fragment per cell of the camera window: shade the cell, output premultiplied albedo with coverage
  ivec2 ci = ivec2(uOrigin) + ivec2(gl_FragCoord.xy);
  vec2 wp = vec2(ci) + 0.5;
  uvec4 cell = cellAt(ci);
  uint t = cell.r;
  vec4 pal = texelFetch(uPal, ivec2(int(t),0), 0);
  uint st = stOf(t);
  float shade = (float(cell.g)/255. - 0.5) * pal.a * 255. / 20.;
  float T = float(cell.b) * 8.;
  float life = float(cell.a & 63u);
  bool particle = (cell.a & 128u) != 0u;
  if (t == 0u || (st == 4u && t != 5u)) {
    // air under rock reads as a cave: a dark rock backdrop, lit only by what glows nearby
    // a roof is fixed rock at least two cells thick: flying debris never casts cave shade (that drew dotted lines under it)
    // averaged over five neighbouring columns, so a ragged roof (a fresh crater) fades out softly instead of hanging
    // stripes of shade of different lengths under it
    float rd = 0.;
    for (int j=-2;j<=2;j++){
      float r = 99.; ivec2 cj = ci + ivec2(j*3, 0);
      for (int k=2;k<=62;k+=3){ if (roofAt(cj+ivec2(0,-k)) && roofAt(cj+ivec2(0,-k-1))) { r = float(k); break; } }
      rd += min(r, 70.);
    }
    rd /= 5.;
    float dL = 99., dR = 99.;
    for (int k=2;k<=58;k+=4){ if (dL>98. && roofAt(ci+ivec2(-k,0)) && roofAt(ci+ivec2(-k-1,0))) dL = float(k); if (dR>98. && roofAt(ci+ivec2(k,0)) && roofAt(ci+ivec2(k+1,0))) dR = float(k); }
    // walls on both sides only count inside a roofed space (open gullies stay sky); they fade with distance, no hard edge
    float sides = (1. - smoothstep(30., 58., dL)) * (1. - smoothstep(30., 58., dR));
    float cave = max(1. - smoothstep(14., 40., rd), sides*(1. - smoothstep(20., 44., rd)));
    vec3 back = vec3(0.10,0.07,0.11) * (0.85 + 0.3*n1(wp.x*0.11 + n1(wp.y*0.13)*4.));
    oAlb = vec4(back * cave, cave); oEmit = vec4(0.); return;
  }
  vec3 base = pow(pal.rgb, vec3(2.2));
  if (t == 5u) { // fire
    float k = clamp(life/40., 0., 1.);
    vec3 fc = mix(vec3(1.0,0.22,0.03), vec3(1.0,0.75,0.25), k);
    fc = mix(fc, vec3(1.,0.95,0.8), smoothstep(0.75,1.,k));
    oAlb = vec4(fc*0.6*0.6, 0.6); oEmit = vec4(fc * (1.5 + 2.5*k), 1.); return;
  }
  vec3 c = base * (1. + shade * 0.16);
  float cov = 1.;
  if (st == 1u || st == 2u) {
    int depth = 8;
    for (int k=1;k<=7;k++){ if(!solidAt(ci+ivec2(0,-k))){ depth=k; break; } }
    float cap = depth==1 ? 1. : depth==2 ? 0.6 : depth==3 ? 0.3 : 0.;
    c = mix(c, c*vec3(1.35,1.22,0.98) + vec3(0.10,0.07,0.01), cap*0.75);
    float occ = 0.;
    for (int k=0;k<8;k++){ float a = float(k)*0.785; ivec2 o = ivec2(round(vec2(cos(a),sin(a))*3.)); occ += solidAt(ci+o)?1.:0.; ivec2 o2 = ivec2(round(vec2(cos(a+0.39),sin(a+0.39))*7.)); occ += solidAt(ci+o2)?1.:0.; }
    c *= 1. - smoothstep(7., 16., occ) * 0.42;
    if (t == 1u || t == 27u || t == 21u || t == 15u) {
      float band = floor((wp.y + n1(wp.x*0.013)*16. + n1(wp.x*0.05)*3.) / 6.);
      c *= 0.9 + 0.17*h11(band*1.7);
      c = mix(c, c*vec3(1.06,0.98,0.92), step(0.6, h11(band*3.1)));
    }
    if (depth > 7) c *= 0.88;
  }
  if (st == 3u) {
    // sea water under the leviathan's storm water is still deep water (its depth counts through the body)
    uint up = cellAt(ci+ivec2(0,-1)).r;
    bool surf = t == 3u ? (up != 3u && up != 32u) : up != t;
    float d = 0.; for (int k=1;k<=16;k++){ uint r2 = cellAt(ci+ivec2(0,-k*3)).r; if(r2==t || (t==3u && r2==32u)) d=float(k*3); else break; }
    if (t == 3u) {
      c = mix(vec3(0.22,0.66,0.82), vec3(0.03,0.14,0.34), clamp(d/42.,0.,1.));
      cov = 0.88;
      if (surf) { c = particle ? vec3(0.5,0.78,0.95) : vec3(0.72,0.92,0.98); cov = 1.; }
      c *= 1. + 0.05*sin(wp.x*0.6 + uTime*2. + wp.y*0.3);
    } else if (surf) c *= 1.2;
  }
  if (t == 10u || t == 13u) { cov = t==13u ? 0.8 : 0.6; c += vec3(0.14) * step(0.9, fract((wp.x+wp.y)*0.11)); }
  if (t == 20u) c *= 1.0 + step(0.85, float(cell.g)/255.)*0.6;
  if (t == 12u) c *= 0.85 + 0.3*step(0.5, fract(wp.y*0.25));
  vec3 emit = vec3(0.);
  if (t == 4u || t == 17u || t == 18u) emit += blackbody(max(T, 700.)) * (0.8 + shade*0.4) + base*0.25;
  else if (T > 480.) emit += blackbody(T) * (st==2u ? 1.2 : 1.0);
  if (t == 16u) emit += vec3(1.0,0.32,0.06) * (0.6 + 0.6*fract(float(cell.g)*0.37 + uTime*0.8));
  if (t == 11u) emit += vec3(0.2,0.6,0.05)*0.35;
  if (t == 33u) emit += vec3(0.05,0.16,0.3) * (0.8 + 0.2*sin(uTime*2. + wp.y*0.3)); // wraith ice glows faintly cold
  if (t == 32u) emit += vec3(0.015,0.08,0.13) * (0.75 + 0.25*sin(uTime*3. + wp.x*0.21 + wp.y*0.13)); // the leviathan's storm-lit water
  if (particle) emit *= 1.4;
  oAlb = vec4(c * cov, cov); oEmit = vec4(emit, 1.);
}`;

// Screen pass: the sky per pixel, then the shaded cells upscaled with sharp bilinear filtering (crisp texels, 1-pixel
// anti-aliased edges, smooth sub-pixel scrolling at any zoom), composited over the sky.
const FS_SCREEN = `#version 300 es
precision highp float;
uniform sampler2D uCellAlb; uniform sampler2D uCellEmit; uniform vec2 uWorld; uniform float uTime;
uniform vec3 uSkyTop, uSkyMid, uSkyLow, uSun, uHaze; uniform vec2 uSunPos; uniform float uSea;
${COMMON}
layout(location=0) out vec4 oAlb; layout(location=1) out vec4 oEmit;
float h11(float p){ return fract(sin(p*127.1)*43758.5453); }
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h11(i),h11(i+1.),f); }
float fbm(float x){ return n1(x)*0.55+n1(x*2.1+3.)*0.28+n1(x*4.3+7.)*0.17; }
vec3 sky(vec2 wp, vec2 sp){
  float y = sp.y;
  vec3 c = mix(uSkyTop, uSkyMid, smoothstep(0.0,0.5,y));
  c = mix(c, uSkyLow, smoothstep(0.38,0.95,y));
  vec2 d = (sp - uSunPos) * vec2(uRes.x/uRes.y, 1.);
  float r = length(d);
  c += uSun * (smoothstep(0.05,0.045,r)*2.6 + exp(-r*6.)*0.6 + exp(-r*1.8)*0.22);
  // far islands and ridges: three parallax layers, warmer and hazier toward the horizon
  for(int L=0; L<3; L++){
    float f = float(L);
    float par = 0.12 + f*0.16;
    float x = (wp.x - uCam.x*(1.-par)) * 0.012 * (1.2 - f*0.25);
    float base = uSea/uWorld.y; // the horizon sits near sea level
    float hgt = 0.56 + f*0.07 + (fbm(x*1.3 + f*13.) - 0.45) * (0.24 - f*0.06);
    float m = smoothstep(hgt, hgt+0.003, y);
    vec3 lc = mix(uHaze, uSkyMid*0.7 + uSkyLow*0.3, 0.35 + f*0.2) * (0.62 + f*0.14);
    c = mix(c, lc, m * (0.55 - f*0.12));
  }
  return c;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 wp = worldAt(frag);
  vec2 sp = vec2(frag.x, uRes.y - frag.y) / uRes;
  vec3 bg = sky(wp, sp);
  vec2 p = wp - uOrigin;
  vec2 r = floor(p + 0.5);                                   // nearest texel boundary
  vec2 q = r - 0.5 + clamp((p - r) * uScale + 0.5, 0., 1.);    // blend across it only within one screen pixel
  vec2 uv = q / uTexSize;
  vec4 A = texture(uCellAlb, uv);
  vec3 E = texture(uCellEmit, uv).rgb;
  oAlb = vec4(bg * (1. - A.a) + A.rgb, A.a); oEmit = vec4(E, 1.);
}`;

// gas density at cell resolution: r = steam/cloud, g = smoke, b = per-cell noise
const FS_GAS = `#version 300 es
precision highp float; precision highp usampler2D;
uniform usampler2D uCells; out vec4 o;
void main(){
  uvec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  float life = float(c.a & 63u);
  float w = 0., s = 0., m = 0.;
  if (c.r == 22u) w = 1.0; else if (c.r == 7u) m = 1.0; else if (c.r == 6u) s = 0.4 + 0.6*clamp(life/60.,0.,1.);
  o = vec4(w, s, m, float(c.g)/255.);
}`;
const FS_BLUR = `#version 300 es
precision highp float; uniform sampler2D uSrc; uniform vec2 uDir; uniform float uStep; out vec4 o;
void main(){ ivec2 p = ivec2(gl_FragCoord.xy); ivec2 sz = textureSize(uSrc,0);
  vec4 a = texelFetch(uSrc,p,0)*0.2; vec4 c0 = texelFetch(uSrc,p,0);
  for (int k=1;k<=4;k++){ float w = k==1?0.16:k==2?0.12:k==3?0.08:0.04; ivec2 d = ivec2(uDir)*k*int(uStep); a += texelFetch(uSrc, clamp(p+d, ivec2(0), sz-1),0)*w + texelFetch(uSrc, clamp(p-d, ivec2(0), sz-1),0)*w; }
  o = vec4(a.rgb, c0.a); }`;

const VS_CAP = `#version 300 es
in vec2 aCorner; in vec4 iAB; in vec2 iR; in vec4 iCol; in vec4 iEmit; in vec2 iAnchor;
uniform vec2 uCam; uniform float uScale; uniform vec2 uRes;
out vec2 vW; flat out vec4 vAB; flat out vec2 vR; flat out vec4 vCol; flat out vec4 vEmit; flat out vec2 vAnchor;
void main(){
  vec2 a = iAB.xy, b = iAB.zw; float r = iEmit.w > 0.5 ? max(iR.x, iR.y) + 1.0 : max(iR.x, iR.y) * 1.7 + 1.0;
  vec2 lo = min(a,b) - r, hi = max(a,b) + r;
  vec2 w = mix(lo, hi, aCorner);
  vW = w; vAB = iAB; vR = iR; vCol = iCol; vEmit = iEmit; vAnchor = iAnchor;
  vec2 s = (w - uCam) * uScale; s.y = uRes.y - s.y;
  gl_Position = vec4(s / uRes * 2. - 1., 0., 1.);
}`;
const FS_CAP = `#version 300 es
precision highp float;
in vec2 vW; flat in vec4 vAB; flat in vec2 vR; flat in vec4 vCol; flat in vec4 vEmit; flat in vec2 vAnchor;
uniform float uPix; uniform float uScale;
layout(location=0) out vec4 oAlb; layout(location=1) out vec4 oEmit;
void main(){
  vec2 p = vW;
  if (vEmit.w > 0.5 && uPix > 0.) p = (floor((p - vAnchor)/uPix)+0.5)*uPix + vAnchor;
  vec2 a = vAB.xy, b = vAB.zw, pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-6), 0., 1.);
  float d = length(pa - ba*h) - mix(vR.x, vR.y, h);
  float alpha;
  if (vEmit.w > 0.5) alpha = uPix > 0. ? (d < 0. ? 1. : 0.) : clamp(0.5 - d * uScale, 0., 1.); // crisp sprites: 1-pixel anti-aliased edge, no pixel crawl
  else { float soft = max(vR.x, vR.y); float u = clamp((d + soft) / (soft * 1.65), 0., 1.); alpha = (1. - u) * (1. - u); alpha *= alpha; }
  if (alpha <= 0.002) discard;
  float aAlb = vCol.a * alpha;
  oAlb = vec4(vCol.rgb * aAlb, aAlb);
  oEmit = vec4(vEmit.rgb * alpha, aAlb);
}`;

const FS_DOWN = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main(){ vec2 t=uTexel; vec3 c = texture(uSrc,vUv).rgb*4.;
 c += texture(uSrc,vUv+vec2(-t.x,-t.y)).rgb + texture(uSrc,vUv+vec2(t.x,-t.y)).rgb + texture(uSrc,vUv+vec2(-t.x,t.y)).rgb + texture(uSrc,vUv+vec2(t.x,t.y)).rgb;
 o = vec4(c/8.,1.); }`;
const FS_UP = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform sampler2D uBase; uniform vec2 uTexel; uniform float uMix; out vec4 o;
void main(){ vec2 t=uTexel; vec3 c = vec3(0.);
 c += texture(uSrc,vUv+vec2(-t.x*2.,0.)).rgb + texture(uSrc,vUv+vec2(t.x*2.,0.)).rgb + texture(uSrc,vUv+vec2(0.,-t.y*2.)).rgb + texture(uSrc,vUv+vec2(0.,t.y*2.)).rgb;
 c += (texture(uSrc,vUv+vec2(-t.x,-t.y)).rgb + texture(uSrc,vUv+vec2(t.x,-t.y)).rgb + texture(uSrc,vUv+vec2(-t.x,t.y)).rgb + texture(uSrc,vUv+vec2(t.x,t.y)).rgb)*2.;
 c /= 12.;
 o = vec4(texture(uBase,vUv).rgb + c*uMix, 1.); }`;
const FS_COMP = `#version 300 es
precision highp float; in vec2 vUv;
uniform sampler2D uAlb; uniform sampler2D uEmit; uniform sampler2D uLight; uniform sampler2D uGas;
uniform vec3 uAmb; uniform float uLightGain; uniform float uHaze; uniform float uExposure;
uniform vec2 uShake; uniform float uShakeRot; uniform float uFlash; uniform float uAberr; uniform float uTime;
uniform vec3 uCloudLit, uCloudShade, uSun; uniform vec2 uSunPos; uniform float uVig;
${COMMON}
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
vec4 gasAt(vec2 wp){ vec2 g = (floor(wp) + 0.5 - uOrigin) / uTexSize; return texture(uGas, g); }
void main(){
  vec2 c = vUv - 0.5; float cs = cos(uShakeRot), sn = sin(uShakeRot);
  c = mat2(cs,-sn,sn,cs) * (c * vec2(uRes.x/uRes.y,1.)); c.x /= uRes.x/uRes.y;
  vec2 uv = c + 0.5 + uShake;
  vec4 A = texture(uAlb, uv);
  vec3 E = texture(uEmit, uv).rgb;
  vec3 L = texture(uLight, uv).rgb;
  if (uAberr > 0.) { vec2 d = (uv-0.5)*uAberr; L.r = texture(uLight, uv+d).r; L.b = texture(uLight, uv-d).b; }
  float isWorld = A.a;
  vec3 lit = A.rgb * (mix(vec3(1.), uAmb, isWorld) + L * uLightGain * mix(0.35, 1., isWorld));
  vec3 col = lit + E + L * uHaze;
  // soft gas masses, drawn per cell so they keep the pixel look, with ragged edges, a lit top and glow from inside
  vec2 frag = uv * uRes; vec2 wp = worldAt(vec2(frag.x, frag.y));
  vec4 g = gasAt(wp);
  float noise = g.a - 0.5;
  float w = smoothstep(0.035, 0.32, g.r + noise*0.03);           // clouds: soft masses that keep a slightly ragged pixel edge
  float m = smoothstep(0.015, 0.22, g.b) * 0.85;                  // steam: soft billowing plumes
  float s = smoothstep(0.12, 0.6, g.g + noise*0.2);
  w = max(w, m);
  if (w + s > 0.001) {
    float above = gasAt(wp + vec2(-2., -4.)).r;
    float light = clamp(1.15 - above*0.9, 0.25, 1.15);
    vec3 cloud = mix(uCloudShade, uCloudLit, light) * (1. + noise*0.10);
    vec2 sd = (vec2(frag.x, uRes.y-frag.y)/uRes - uSunPos) * vec2(uRes.x/uRes.y,1.);
    cloud += uSun * exp(-length(sd)*3.) * 0.35 * (1.-above);   // rim toward the sun
    cloud += L * 0.9;                                           // beams and lava glow through steam
    cloud *= 1.0 + 0.18 * m;                                    // fresh steam is brighter, so it blooms a little
    col = mix(col, cloud, w * 0.94);
    vec3 smoke = vec3(0.10,0.09,0.11) * (0.8 + light*0.4) + L*0.25;
    col = mix(col, smoke, s * 0.85);
  }
  col *= uExposure;
  col += uFlash;
  col = aces(col);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(col * vec3(0.93,0.95,1.06), col, smoothstep(0.0,0.5,lum));
  col = mix(col, col*vec3(1.05,1.0,0.93), smoothstep(0.5,1.,lum));
  float v = smoothstep(1.25, 0.4, length((vUv-0.5)*vec2(1.2,1.1)));
  col *= mix(uVig, 1., v);
  col += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898,78.233)))*43758.5453) - 0.5) * 0.01;
  o = vec4(pow(col, vec3(1./2.2)), 1.);
}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation> };
function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
	return s;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): Prog {
	const p = gl.createProgram()!; gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
	gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 0, 'aCorner'); gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
	const u: Record<string, WebGLUniformLocation> = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
	for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; u[info.name] = gl.getUniformLocation(p, info.name)!; }
	return { p, u };
}

export interface Look { skyTop: number[]; skyMid: number[]; skyLow: number[]; sun: number[]; sunPos: number[]; haze: number[]; amb: number[]; lightGain: number; hazeGain: number; exposure: number; cloudLit: number[]; cloudShade: number[]; vignette: number }
export const GOLDEN: Look = {
	skyTop: [0.16, 0.10, 0.30], skyMid: [0.78, 0.36, 0.40], skyLow: [1.0, 0.66, 0.38], sun: [1.0, 0.78, 0.52], sunPos: [0.70, 0.56], haze: [0.95, 0.62, 0.50],
	amb: [1.0, 0.90, 0.92], lightGain: 2.4, hazeGain: 0.4, exposure: 1.05, cloudLit: [1.0, 0.88, 0.82], cloudShade: [0.50, 0.36, 0.48], vignette: 0.74,
};

export class Renderer {
	canvas: HTMLCanvasElement; world: World; gl: WebGL2RenderingContext;
	W: number; H: number; scale: number; cam = [0, 0]; pix = 0; look: Look;
	shake = [0, 0]; shakeRot = 0; flash = 0; aberr = 0; seaLevel = 0;
	pWorld: Prog; pScreen: Prog; pCap: Prog; pDown: Prog; pUp: Prog; pComp: Prog; pGas: Prog; pBlur: Prog;
	vaoFull: WebGLVertexArrayObject; vaoCap: WebGLVertexArrayObject; capBuf: WebGLBuffer;
	CAPMAX = 24000; capData: Float32Array; capN = 0;
	cellTex: WebGLTexture | null = null; palTex: WebGLTexture; cellBytes: Uint8Array = new Uint8Array(4); texW = 0; texH = 0; origin = [0, 0];
	gasTex: (WebGLTexture | null)[] = []; gasFb: (WebGLFramebuffer | null)[] = []; cellAlb: WebGLTexture | null = null; cellEmit: WebGLTexture | null = null; cellFb: WebGLFramebuffer | null = null;
	albTex!: WebGLTexture; emitTex!: WebGLTexture; sceneFb!: WebGLFramebuffer;
	mips: { w: number; h: number; down: WebGLTexture; up: WebGLTexture; fd: WebGLFramebuffer; fu: WebGLFramebuffer }[] = [];
	packMs = 0; gpuMs = 0;
	constructor(canvas: HTMLCanvasElement, world: World, look: Look = GOLDEN) {
		this.canvas = canvas; this.world = world; this.look = look;
		const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: false });
		if (!gl) throw new Error('WebGL2 is not available');
		this.gl = gl;
		gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float');
		this.W = canvas.width; this.H = canvas.height; this.scale = 2;
		this.pWorld = program(gl, VS_FULL, FS_WORLD); this.pScreen = program(gl, VS_FULL, FS_SCREEN); this.pCap = program(gl, VS_CAP, FS_CAP);
		this.pDown = program(gl, VS_FULL, FS_DOWN); this.pUp = program(gl, VS_FULL, FS_UP); this.pComp = program(gl, VS_FULL, FS_COMP);
		this.pGas = program(gl, VS_FULL, FS_GAS); this.pBlur = program(gl, VS_FULL, FS_BLUR);
		this.vaoFull = gl.createVertexArray()!; gl.bindVertexArray(this.vaoFull);
		const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		this.capData = new Float32Array(this.CAPMAX * 16);
		this.vaoCap = gl.createVertexArray()!; gl.bindVertexArray(this.vaoCap);
		const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		this.capBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.capBuf); gl.bufferData(gl.ARRAY_BUFFER, this.capData.byteLength, gl.DYNAMIC_DRAW);
		const P = this.pCap.p;
		for (const [n, sz, off] of [['iAB', 4, 0], ['iR', 2, 4], ['iCol', 4, 6], ['iEmit', 4, 10], ['iAnchor', 2, 14]] as [string, number, number][]) {
			const l = gl.getAttribLocation(P, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 64, off * 4); gl.vertexAttribDivisor(l, 1);
		}
		const NP = 40, pal = new Uint8Array(NP * 2 * 4);
		for (let i = 0; i < NP; i++) { pal.set(COLOR.subarray(i * 4, i * 4 + 4), i * 4); pal[(NP + i) * 4] = ST[i]; }
		this.palTex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.palTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, NP, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, pal);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		this.resize(canvas.width, canvas.height);
	}
	mk(w: number, h: number, fmt: number, filter: number) {
		const gl = this.gl, t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
	}
	fb(tex: WebGLTexture) { const gl = this.gl, f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return f; }
	resize(w: number, h: number) {
		const gl = this.gl; this.W = w; this.H = h; this.canvas.width = w; this.canvas.height = h;
		for (const m of this.mips) { gl.deleteTexture(m.down); gl.deleteTexture(m.up); gl.deleteFramebuffer(m.fd); gl.deleteFramebuffer(m.fu); }
		if (this.albTex) { gl.deleteTexture(this.albTex); gl.deleteTexture(this.emitTex); gl.deleteFramebuffer(this.sceneFb); }
		this.albTex = this.mk(w, h, gl.RGBA8, gl.LINEAR); this.emitTex = this.mk(w, h, gl.RGBA16F, gl.LINEAR);
		this.sceneFb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albTex, 0);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.emitTex, 0);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
		this.mips = []; let mw = w >> 1, mh = h >> 1;
		for (let i = 0; i < 7 && mw >= 4 && mh >= 4; i++) {
			const down = this.mk(mw, mh, gl.RGBA16F, gl.LINEAR), up = this.mk(mw, mh, gl.RGBA16F, gl.LINEAR);
			this.mips.push({ w: mw, h: mh, down, up, fd: this.fb(down), fu: this.fb(up) }); mw >>= 1; mh >>= 1;
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}
	ensureCellTex(w: number, h: number) {
		if (w === this.texW && h === this.texH && this.cellTex) return;
		const gl = this.gl;
		if (this.cellTex) gl.deleteTexture(this.cellTex);
		for (const t of this.gasTex) if (t) gl.deleteTexture(t);
		this.texW = w; this.texH = h;
		this.cellTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, w, h);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		this.cellBytes = new Uint8Array(w * h * 4);
		this.gasTex = [this.mk(w, h, gl.RGBA16F, gl.NEAREST), this.mk(w, h, gl.RGBA16F, gl.NEAREST)];
		for (const t of this.gasTex) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); }
		this.gasFb = this.gasTex.map(t => this.fb(t!));
		if (this.cellAlb) { gl.deleteTexture(this.cellAlb); gl.deleteTexture(this.cellEmit); gl.deleteFramebuffer(this.cellFb); }
		this.cellAlb = this.mk(w, h, gl.RGBA8, gl.LINEAR); this.cellEmit = this.mk(w, h, gl.RGBA16F, gl.LINEAR);
		this.cellFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cellAlb, 0);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.cellEmit, 0);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
	}
	anchor = [0, 0]; // pixel-snap origin for crisp sprites (set to the sprite's root before drawing it)
	cap(ax: number, ay: number, bx: number, by: number, r0: number, r1: number, col: number[], emit: number[] | null, crisp = true) {
		if (this.capN >= this.CAPMAX) return;
		const d = this.capData, o = this.capN++ * 16;
		d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by; d[o + 4] = r0; d[o + 5] = r1;
		d[o + 6] = col[0]; d[o + 7] = col[1]; d[o + 8] = col[2]; d[o + 9] = col[3];
		d[o + 10] = emit ? emit[0] : 0; d[o + 11] = emit ? emit[1] : 0; d[o + 12] = emit ? emit[2] : 0; d[o + 13] = crisp ? 1 : 0; d[o + 14] = this.anchor[0]; d[o + 15] = this.anchor[1];
	}
	glow(x: number, y: number, r: number, e: number[], bx?: number, by?: number) { this.cap(x, y, bx ?? x, by ?? y, r, r, [0, 0, 0, 0], e, false); }
	viewCells() { return [this.W / this.scale, this.H / this.scale]; }
	pack() {
		const t0 = performance.now();
		const w = this.world, [vw, vh] = this.viewCells(), M = 12;
		const ox = Math.max(0, Math.floor(this.cam[0]) - M), oy = Math.max(0, Math.floor(this.cam[1]) - M);
		const tw = Math.min(w.W - ox, Math.ceil(vw) + 2 * M), th = Math.min(w.H - oy, Math.ceil(vh) + 2 * M);
		const TW = Math.ceil(vw) + 2 * M, TH = Math.ceil(vh) + 2 * M;
		this.ensureCellTex(TW, TH);
		this.origin = [ox, oy];
		const out = this.cellBytes, ty = w.type, sh = w.shade, tm = w.temp, lf = w.life, W = w.W;
		out.fill(0);
		for (let y = 0; y < th; y++) {
			let i = (oy + y) * W + ox, o = y * TW * 4;
			for (let x = 0; x < tw; x++, i++, o += 4) {
				out[o] = ty[i]; out[o + 1] = sh[i];
				const T = tm[i]; out[o + 2] = T <= 0 ? 0 : T >= 2040 ? 255 : (T / 8) | 0;
				const l = lf[i]; out[o + 3] = (l > 63 ? 63 : l) | (w.body[i] ? 64 : 0); // bit 64: part of a moving body, 128: a flying cell
			}
		}
		for (let k = 0; k < w.pn; k++) {
			const x = (w.px[k] | 0) - ox, y = (w.py[k] | 0) - oy; if (x < 0 || y < 0 || x >= tw || y >= th) continue;
			if (ST[w.pt[k]] === GAS || w.pt[k] === 3) continue; // gases go to the soft layer; flying water is drawn as rain streaks
			const o = (y * TW + x) * 4; out[o] = w.pt[k]; out[o + 1] = w.pshade[k];
			const T = w.ptemp[k]; out[o + 2] = T <= 0 ? 0 : T >= 2040 ? 255 : (T / 8) | 0; out[o + 3] = 128 | 60;
		}
		this.packMs = performance.now() - t0;
	}
	render(time = 0) {
		const gl = this.gl, L = this.look;
		this.pack();
		gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texW, this.texH, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, this.cellBytes);
		const setCommon = (P: Prog) => {
			gl.uniform2f(P.u.uCam, this.cam[0], this.cam[1]); gl.uniform1f(P.u.uScale, this.scale); gl.uniform2f(P.u.uRes, this.W, this.H);
			gl.uniform2f(P.u.uOrigin, this.origin[0], this.origin[1]); gl.uniform2f(P.u.uTexSize, this.texW, this.texH);
		};
		gl.bindVertexArray(this.vaoFull); gl.disable(gl.BLEND);
		// gas density + blur
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.gasFb[0]); gl.viewport(0, 0, this.texW, this.texH);
		let P = this.pGas; gl.useProgram(P.p);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cellTex); gl.uniform1i(P.u.uCells, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		P = this.pBlur; gl.useProgram(P.p);
		for (const [src, dst, dx, dy, st] of [[0, 1, 1, 0, 1], [1, 0, 0, 1, 1], [0, 1, 1, 0, 2], [1, 0, 0, 1, 2]]) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.gasFb[dst]);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gasTex[src]); gl.uniform1i(P.u.uSrc, 0); gl.uniform2f(P.u.uDir, dx, dy); gl.uniform1f(P.u.uStep, st);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}
		// cells: shade each cell of the window once
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFb); gl.viewport(0, 0, this.texW, this.texH);
		P = this.pWorld; gl.useProgram(P.p);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cellTex); gl.uniform1i(P.u.uCells, 0);
		gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.palTex); gl.uniform1i(P.u.uPal, 1);
		setCommon(P); gl.uniform2f(P.u.uWorld, this.world.W, this.world.H); gl.uniform1f(P.u.uTime, time);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		// screen: sky, then the cells upscaled with sharp bilinear filtering
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFb); gl.viewport(0, 0, this.W, this.H);
		P = this.pScreen; gl.useProgram(P.p);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cellAlb); gl.uniform1i(P.u.uCellAlb, 0);
		gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cellEmit); gl.uniform1i(P.u.uCellEmit, 1);
		setCommon(P);
		gl.uniform2f(P.u.uWorld, this.world.W, this.world.H); gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uSea, this.seaLevel);
		gl.uniform3fv(P.u.uSkyTop, L.skyTop); gl.uniform3fv(P.u.uSkyMid, L.skyMid); gl.uniform3fv(P.u.uSkyLow, L.skyLow); gl.uniform3fv(P.u.uSun, L.sun); gl.uniform2fv(P.u.uSunPos, L.sunPos); gl.uniform3fv(P.u.uHaze, L.haze);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		if (this.capN) {
			gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			P = this.pCap; gl.useProgram(P.p);
			gl.uniform2f(P.u.uCam, this.cam[0], this.cam[1]); gl.uniform1f(P.u.uScale, this.scale); gl.uniform2f(P.u.uRes, this.W, this.H); gl.uniform1f(P.u.uPix, this.pix);
			gl.bindVertexArray(this.vaoCap); gl.bindBuffer(gl.ARRAY_BUFFER, this.capBuf);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.capData, 0, this.capN * 16);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.capN);
			gl.disable(gl.BLEND);
		}
		this.capN = 0;
		gl.bindVertexArray(this.vaoFull);
		P = this.pDown; gl.useProgram(P.p);
		let src = this.emitTex, sw = this.W, sh = this.H;
		for (const m of this.mips) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, m.fd); gl.viewport(0, 0, m.w, m.h);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(P.u.uSrc, 0); gl.uniform2f(P.u.uTexel, 1 / sw, 1 / sh);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); src = m.down; sw = m.w; sh = m.h;
		}
		P = this.pUp; gl.useProgram(P.p);
		const last = this.mips.length - 1;
		for (let i = last - 1; i >= 0; i--) {
			const m = this.mips[i], s = this.mips[i + 1];
			gl.bindFramebuffer(gl.FRAMEBUFFER, m.fu); gl.viewport(0, 0, m.w, m.h);
			gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, i + 1 === last ? s.down : s.up); gl.uniform1i(P.u.uSrc, 0);
			gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m.down); gl.uniform1i(P.u.uBase, 1);
			gl.uniform2f(P.u.uTexel, 1 / s.w, 1 / s.h); gl.uniform1f(P.u.uMix, 1.15);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
		P = this.pComp; gl.useProgram(P.p);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.albTex); gl.uniform1i(P.u.uAlb, 0);
		gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.emitTex); gl.uniform1i(P.u.uEmit, 1);
		gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mips[0].up); gl.uniform1i(P.u.uLight, 2);
		gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.gasTex[0]); gl.uniform1i(P.u.uGas, 3);
		setCommon(P);
		gl.uniform3fv(P.u.uAmb, L.amb); gl.uniform1f(P.u.uLightGain, L.lightGain / this.mips.length); gl.uniform1f(P.u.uHaze, L.hazeGain / this.mips.length); gl.uniform1f(P.u.uExposure, L.exposure);
		gl.uniform2fv(P.u.uShake, this.shake); gl.uniform1f(P.u.uShakeRot, this.shakeRot); gl.uniform1f(P.u.uFlash, this.flash); gl.uniform1f(P.u.uAberr, this.aberr);
		gl.uniform1f(P.u.uTime, time); gl.uniform3fv(P.u.uCloudLit, L.cloudLit); gl.uniform3fv(P.u.uCloudShade, L.cloudShade); gl.uniform3fv(P.u.uSun, L.sun); gl.uniform2fv(P.u.uSunPos, L.sunPos); gl.uniform1f(P.u.uVig, L.vignette);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
}
