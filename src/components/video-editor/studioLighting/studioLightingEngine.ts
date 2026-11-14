import type { StudioLightingSettings } from "./studioLightingTypes";

const colorCache = new Map<string, [number, number, number]>();

export function hexToRgb(hex: string): [number, number, number] {
	const cached = colorCache.get(hex);
	if (cached) return cached;
	const clean = hex.replace("#", "").trim();
	let result: [number, number, number];
	if (clean.length === 3) {
		const r = parseInt(clean[0] + clean[0], 16) / 255;
		const g = parseInt(clean[1] + clean[1], 16) / 255;
		const b = parseInt(clean[2] + clean[2], 16) / 255;
		result = [r, g, b];
	} else if (clean.length === 6) {
		const r = parseInt(clean.substring(0, 2), 16) / 255;
		const g = parseInt(clean.substring(2, 4), 16) / 255;
		const b = parseInt(clean.substring(4, 6), 16) / 255;
		result = [r, g, b];
	} else {
		result = [1, 1, 1];
	}
	colorCache.set(hex, result);
	return result;
}

const VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

// Renders into an FBO with UV (0,0) matching DOM/texture top-left so Pass 2 samples identically to u_webcam.
const DEPTH_VS_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
}
`;

const DEPTH_SHARED_GLSL = `
const float TAN_HALF_FOV = 0.57735;
const float FAR_PLANE = 3.5;

float toZ(float d, float farZ) {
    return 1.0 / mix(1.0 / farZ, 1.0, clamp(d, 0.001, 1.0));
}

vec3 reconstructWorldPos(vec2 uv, float d, float aspect, float tanF, float farZ) {
    float z = toZ(d, farZ);
    vec2 s = vec2((uv.x * 2.0 - 1.0) * aspect, (1.0 - uv.y) * 2.0 - 1.0) * tanF;
    return vec3(s * z, -z);
}

vec2 toScreenUv(vec3 p, float aspect, float tanF) {
    vec2 ndc = p.xy / max(-p.z, 0.0001) / (tanF * vec2(aspect, 1.0));
    return vec2((ndc.x + 1.0) * 0.5, 1.0 - (ndc.y + 1.0) * 0.5);
}
`;

// Pass 1: Precompute low-pass portrait depth & float-precision local normal once at reduced resolution.
const DEPTH_FS_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_webcam;
uniform vec2 u_resolution;
uniform float u_depthResponse;
uniform float u_normalSmoothness;

${DEPTH_SHARED_GLSL}

float sampleLowPassLuminance(vec2 uv, vec2 px) {
    float k = max(6.0, u_normalSmoothness * 16.0);
    vec2 offX = vec2(px.x * k, 0.0);
    vec2 offY = vec2(0.0, px.y * k);
    vec2 offDiag = vec2(px.x * k * 0.7071, px.y * k * 0.7071);

    float lum0 = dot(texture(u_webcam, uv).rgb, vec3(0.299, 0.587, 0.114));
    float lumR = dot(texture(u_webcam, clamp(uv + offX, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumL = dot(texture(u_webcam, clamp(uv - offX, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumU = dot(texture(u_webcam, clamp(uv - offY, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumD = dot(texture(u_webcam, clamp(uv + offY, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumTR = dot(texture(u_webcam, clamp(uv + vec2(offDiag.x, -offDiag.y), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumTL = dot(texture(u_webcam, clamp(uv - offDiag, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumBR = dot(texture(u_webcam, clamp(uv + offDiag, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lumBL = dot(texture(u_webcam, clamp(uv + vec2(-offDiag.x, offDiag.y), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));

    return lum0 * 0.20 + (lumR + lumL + lumU + lumD) * 0.125 + (lumTR + lumTL + lumBR + lumBL) * 0.075;
}

float estimateSmoothDepth(vec2 uv, vec2 px) {
    float smoothLum = sampleLowPassLuminance(uv, px);

    vec2 centerOffset = (uv - vec2(0.5, 0.44)) * vec2(1.15, 1.30);
    float r = length(centerOffset);
    float dome = clamp(1.0 - r * 1.30, 0.0, 1.0);
    dome = smoothstep(0.0, 1.0, dome);

    float skinLumFactor = smoothstep(0.08, 0.35, smoothLum);
    float lumRelief = (smoothLum - 0.35) * 0.18 * clamp(u_depthResponse, 0.1, 1.5) * skinLumFactor;

    return clamp(dome * 0.85 + 0.10 + lumRelief, 0.05, 0.95);
}

vec3 computeLocalNormal(vec2 uv, vec2 px, float aspect, float tanF, float farZ) {
    float k = max(4.0, u_normalSmoothness * 12.0);
    vec2 stepUv = px * k;

    float dR = estimateSmoothDepth(uv + vec2(stepUv.x, 0.0), px);
    float dL = estimateSmoothDepth(uv - vec2(stepUv.x, 0.0), px);
    float dU = estimateSmoothDepth(uv - vec2(0.0, stepUv.y), px);
    float dD = estimateSmoothDepth(uv + vec2(0.0, stepUv.y), px);

    vec3 pR = reconstructWorldPos(uv + vec2(stepUv.x, 0.0), dR, aspect, tanF, farZ);
    vec3 pL = reconstructWorldPos(uv - vec2(stepUv.x, 0.0), dL, aspect, tanF, farZ);
    vec3 pU = reconstructWorldPos(uv - vec2(0.0, stepUv.y), dU, aspect, tanF, farZ);
    vec3 pD = reconstructWorldPos(uv + vec2(0.0, stepUv.y), dD, aspect, tanF, farZ);

    vec3 n = cross(pR - pL, pU - pD);
    if (length(n) < 0.0001) return vec3(0.0, 0.0, 1.0);
    n = normalize(n);
    if (n.z < 0.0) n = -n;
    return n;
}

void main() {
    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    float d = estimateSmoothDepth(v_texCoord, px);
    vec3 n = computeLocalNormal(v_texCoord, px, aspect, TAN_HALF_FOV, FAR_PLANE);
    fragColor = vec4(d, n * 0.5 + 0.5);
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_webcam;
uniform sampler2D u_depthNormalTex;
uniform vec2 u_resolution;

const int MAX_LIGHTS = 8;
uniform int u_numLights;
uniform vec3 u_lightPos[MAX_LIGHTS];       // (x, y, z)
uniform vec3 u_lightColor[MAX_LIGHTS];     // (r, g, b)
uniform vec4 u_lightParams[MAX_LIGHTS];    // (x: intensity, y: radius, z: castShadow, w: specular)

uniform float u_ambientIntensity;
uniform vec3 u_ambientColor;
uniform float u_normalSmoothness;
uniform float u_shadowSoftness;
uniform float u_specularShininess;
uniform float u_exposure;
uniform float u_contrast;
uniform int u_mirror;

// Depthbake parameters
uniform float u_diffuseWrap;        // Skin scattering wrap factor (default 0.20)
uniform float u_haloSuppression;     // Edge halo suppression factor (default 0.75)
uniform float u_shadowReach;        // Screen-space raymarch reach factor (default 0.25)
uniform int u_shadowSteps;          // Screen-space raymarch steps (default 10)

const float GOLDEN_ANGLE = 2.3999632;
const int VOGEL_TAPS = 8;
const float LIGHT_SWING = 1.7;

${DEPTH_SHARED_GLSL}

// Depthbake Vogel Spiral normal filtering using precomputed depth & float-precision base normals
vec3 computeDepthbakeNormals(
    vec2 uv,
    vec2 px,
    out float dCenter,
    out float nAgree,
    out float dRange
) {
    vec4 centerSample = texture(u_depthNormalTex, uv);
    dCenter = centerSample.r;
    vec3 baseN = normalize(centerSample.gba * 2.0 - 1.0);

    float baseRadius = max(5.0, u_normalSmoothness * 14.0);
    vec3 accNormal = baseN;
    float dNear = dCenter;
    float dFar = dCenter;

    for (int i = 0; i < VOGEL_TAPS; i++) {
        float r = baseRadius * sqrt((float(i) + 0.5) / float(VOGEL_TAPS));
        float a = float(i) * GOLDEN_ANGLE;
        vec2 off = vec2(cos(a), sin(a)) * r * px;
        vec2 tapUv = clamp(uv + off, 0.0, 1.0);

        vec4 tapSample = texture(u_depthNormalTex, tapUv);
        float dTap = tapSample.r;
        dNear = max(dNear, dTap);
        dFar = min(dFar, dTap);

        vec3 nTap = normalize(tapSample.gba * 2.0 - 1.0);
        accNormal += nTap;
    }

    dRange = dNear - dFar;
    nAgree = clamp(length(accNormal) / float(VOGEL_TAPS + 1), 0.0, 1.0);
    return normalize(accNormal);
}

void main() {
    vec2 uv = v_texCoord;
    if (u_mirror == 1) {
        uv.x = 1.0 - uv.x;
    }
    
    vec4 srcColor = texture(u_webcam, uv);
    // Convert sRGB albedo to linear space for physically accurate lighting calculation
    vec3 albedoLinear = pow(srcColor.rgb, vec3(2.2));
    
    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    
    float dCenter;
    float nAgree;
    float dRange;
    vec3 N = computeDepthbakeNormals(uv, px, dCenter, nAgree, dRange);
    vec3 fragPos = reconstructWorldPos(uv, dCenter, aspect, TAN_HALF_FOV, FAR_PLANE);
    vec3 V = normalize(-fragPos); // Camera at origin looking down -Z
    
    // Portrait Subject Mask: snugly bounds the presenter (head, neck, shoulders, torso)
    // and smoothly drops to 0.0 on background laptops, desks, chairs, shelves, and walls.
    float halfWidth = mix(0.18, 0.36, smoothstep(0.42, 0.88, uv.y));
    float hDist = abs(uv.x - 0.50) / max(halfWidth, 0.01);
    float hMask = smoothstep(1.15, 0.85, hDist);
    float vMask = smoothstep(0.08, 0.18, uv.y);
    float subjectMask = hMask * vMask;
    
    // Depthbake Halo & Silhouette Edge Suppression:
    // Drop lighting confidence to zero at depth discontinuities (hair silhouette, laptop edges)
    float haloFree = 1.0 - smoothstep(0.08, 0.25, dRange * (0.5 + 0.5 * u_haloSuppression));
    float edgeConfidence = haloFree * smoothstep(0.40, 0.80, nAgree);
    
    // Skin presence detector in linear color space:
    // Human skin has warm tone (R > G > B) and mid-to-high luminance.
    // Dark hair, dark glasses, clothing, and background do NOT have skin presence.
    float lum = dot(albedoLinear, vec3(0.299, 0.587, 0.114));
    float isWarmSkin = smoothstep(0.0, 0.05, albedoLinear.r - albedoLinear.g) *
                       smoothstep(-0.02, 0.06, albedoLinear.g - albedoLinear.b);
    float skinPresence = smoothstep(0.08, 0.20, lum) * isWarmSkin;
    
    // Depthbake Specular Catchlight Gating:
    // Requires high normal agreement (Depthbake), subject presence, and skin reflectance.
    // Completely eliminates specular glints on dark hair, beard, glasses, and background!
    float specGating = smoothstep(0.75, 0.95, nAgree) * subjectMask * skinPresence;
    
    vec3 diffuseAccum = vec3(0.0);
    vec3 specularAccum = vec3(0.0);
    
    float pivotZ = toZ(0.5, FAR_PLANE);
    
    for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= u_numLights) break;
        
        vec3 lPosNorm = u_lightPos[i];
        vec3 lCol = u_lightColor[i];
        vec4 lParams = u_lightParams[i];
        
        float intensity = lParams.x;
        float radius = max(0.2, lParams.y);
        bool castShadow = lParams.z > 0.5;
        float specStrength = lParams.w;
        
        if (intensity <= 0.001) continue;
        
        // Convert light from normalized (x,y,z) to Depthbake 3D camera space
        float zLight = lPosNorm.z * pivotZ;
        vec2 lightUv = lPosNorm.xy;
        float ndcLightX = (lightUv.x * 2.0 - 1.0) * aspect * TAN_HALF_FOV * LIGHT_SWING;
        float ndcLightY = ((1.0 - lightUv.y) * 2.0 - 1.0) * TAN_HALF_FOV * LIGHT_SWING;
        vec3 lightPos3D = vec3(ndcLightX * zLight, ndcLightY * zLight, -zLight);
        
        vec3 lightVec = lightPos3D - fragPos;
        float dist = length(lightVec);
        vec3 L = lightVec / max(dist, 0.0001);
        
        // Distance attenuation
        float rr = dist / (radius * pivotZ * 0.85);
        float att = 1.0 / (1.0 + rr * rr);
        
        // Depthbake Diffuse Wrap Lighting (Half-Lambert skin scattering)
        float w = u_diffuseWrap;
        float NdotL = dot(N, L);
        float diffWrap = max((NdotL + w) / (1.0 + w), 0.0);
        
        // Depthbake Screen-Space Raymarched Contact Shadows
        float shadow = 1.0;
        if (castShadow && u_shadowSteps > 0 && subjectMask > 0.1) {
            float occ = 0.0;
            // Bias ray origin along surface normal to prevent self-shadowing acne
            vec3 rayOrigin = fragPos + N * 0.06;
            float shadowBias = 0.05;
            
            for (int s = 1; s <= 16; s++) {
                if (s > u_shadowSteps) break;
                float t = (float(s) + 0.3) / float(u_shadowSteps);
                vec3 pRay = mix(rayOrigin, lightPos3D, t * u_shadowReach);
                vec2 suv = toScreenUv(pRay, aspect, TAN_HALF_FOV);
                if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
                
                float sampledDepth = texture(u_depthNormalTex, suv).r;
                float sampleZ = toZ(sampledDepth, FAR_PLANE);
                float dz = -pRay.z - sampleZ;
                
                float stepOcc = smoothstep(shadowBias, shadowBias * 3.5, dz) * (1.0 - t * 0.65);
                occ = max(occ, stepOcc);
            }
            shadow = 1.0 - clamp(occ * subjectMask * (1.0 - u_shadowSoftness * 0.4), 0.0, 0.85);
        }
        
        // Depthbake Specular Catchlight
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float spec = pow(NdotH, u_specularShininess) * specStrength * specGating;
        
        // Accumulate direct lighting - strictly gated to presenter subject mask & edge confidence
        float lightScalar = intensity * att * shadow * edgeConfidence * subjectMask;
        diffuseAccum += lCol * (diffWrap * lightScalar);
        specularAccum += lCol * (spec * lightScalar);
    }
    
    // Linear Ambient & Natural Webcam Exposure Retention
    vec3 linearAmbient = pow(u_ambientColor, vec3(2.2)) * (u_ambientIntensity * 0.45);
    float baseFactor = clamp(0.75 + u_ambientIntensity * 0.25, 0.7, 1.0);
    vec3 baseLit = albedoLinear * baseFactor + albedoLinear * linearAmbient;
    
    // Combine diffuse + specular in linear radiance space
    vec3 directLit = albedoLinear * diffuseAccum * 1.45 + specularAccum * 0.85;
    vec3 totalLinear = baseLit + directLit;
    
    // Film exponential tone mapping: avoids digital clipping & keeps highlights smooth
    vec3 tonemapped = vec3(1.0) - exp(-totalLinear * u_exposure);
    
    // Contrast adjustment in tone space
    tonemapped = pow(max(tonemapped, vec3(0.0)), vec3(u_contrast));
    
    // Convert back from linear space to sRGB for display output
    vec3 srgbOut = pow(clamp(tonemapped, 0.0, 1.0), vec3(1.0 / 2.2));
    
    fragColor = vec4(srgbOut, srcColor.a);
}
`;

export interface StudioLightingRenderOptions {
	maxDimension?: number;
}

export class StudioLightingEngine {
	private gl: WebGL2RenderingContext | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private program: WebGLProgram | null = null;
	private depthProgram: WebGLProgram | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private positionBuffer: WebGLBuffer | null = null;
	private texCoordBuffer: WebGLBuffer | null = null;
	private texture: WebGLTexture | null = null;
	private depthTexture: WebGLTexture | null = null;
	private depthFbo: WebGLFramebuffer | null = null;
	private depthFboWidth = 0;
	private depthFboHeight = 0;

	// Pass 1 uniform locations
	private uDepthWebcamLoc: WebGLUniformLocation | null = null;
	private uDepthResolutionLoc: WebGLUniformLocation | null = null;
	private uDepthResponseLoc: WebGLUniformLocation | null = null;
	private uDepthNormalSmoothnessLoc: WebGLUniformLocation | null = null;

	// Pass 2 uniform locations
	private uWebcamLoc: WebGLUniformLocation | null = null;
	private uDepthNormalTexLoc: WebGLUniformLocation | null = null;
	private uResolutionLoc: WebGLUniformLocation | null = null;
	private uNumLightsLoc: WebGLUniformLocation | null = null;
	private uLightPosLoc: WebGLUniformLocation | null = null;
	private uLightColorLoc: WebGLUniformLocation | null = null;
	private uLightParamsLoc: WebGLUniformLocation | null = null;
	private uAmbientIntensityLoc: WebGLUniformLocation | null = null;
	private uAmbientColorLoc: WebGLUniformLocation | null = null;
	private uNormalSmoothnessLoc: WebGLUniformLocation | null = null;
	private uShadowSoftnessLoc: WebGLUniformLocation | null = null;
	private uSpecularShininessLoc: WebGLUniformLocation | null = null;
	private uExposureLoc: WebGLUniformLocation | null = null;
	private uContrastLoc: WebGLUniformLocation | null = null;
	private uMirrorLoc: WebGLUniformLocation | null = null;
	private uDiffuseWrapLoc: WebGLUniformLocation | null = null;
	private uHaloSuppressionLoc: WebGLUniformLocation | null = null;
	private uShadowReachLoc: WebGLUniformLocation | null = null;
	private uShadowStepsLoc: WebGLUniformLocation | null = null;

	// Pre-allocated typed arrays to eliminate garbage collection in 60fps render loop
	private lightPositions = new Float32Array(24);
	private lightColors = new Float32Array(24);
	private lightParams = new Float32Array(32);

	private initialized = false;

	public getCanvas(): HTMLCanvasElement | null {
		return this.canvas;
	}

	public initialize(canvas?: HTMLCanvasElement): boolean {
		try {
			if (typeof document === "undefined") return false;
			if (this.initialized) {
				if (!canvas || this.canvas === canvas) {
					return true;
				}
				this.dispose();
			}
			this.canvas = canvas || document.createElement("canvas");
			const gl = this.canvas.getContext("webgl2", {
				alpha: true,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				antialias: false,
				powerPreference: "high-performance",
			}) as WebGL2RenderingContext | null;

			if (!gl) {
				console.warn("[StudioLightingEngine] WebGL2 not supported, falling back to 2D Canvas");
				return false;
			}
			this.gl = gl;

			const depthVs = this.compileShader(gl.VERTEX_SHADER, DEPTH_VS_SOURCE);
			const depthFs = this.compileShader(gl.FRAGMENT_SHADER, DEPTH_FS_SOURCE);
			if (!depthVs || !depthFs) return false;

			const depthProgram = gl.createProgram();
			if (!depthProgram) return false;
			gl.attachShader(depthProgram, depthVs);
			gl.attachShader(depthProgram, depthFs);
			gl.linkProgram(depthProgram);
			gl.deleteShader(depthVs);
			gl.deleteShader(depthFs);
			if (!gl.getProgramParameter(depthProgram, gl.LINK_STATUS)) {
				console.error("[StudioLightingEngine] Depth program link error:", gl.getProgramInfoLog(depthProgram));
				gl.deleteProgram(depthProgram);
				return false;
			}
			this.depthProgram = depthProgram;

			const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
			const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
			if (!vs || !fs) return false;

			const program = gl.createProgram();
			if (!program) return false;
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				console.error("[StudioLightingEngine] Program link error:", gl.getProgramInfoLog(program));
				gl.deleteProgram(program);
				return false;
			}
			this.program = program;

			// Pass 1 uniforms
			this.uDepthWebcamLoc = gl.getUniformLocation(depthProgram, "u_webcam");
			this.uDepthResolutionLoc = gl.getUniformLocation(depthProgram, "u_resolution");
			this.uDepthResponseLoc = gl.getUniformLocation(depthProgram, "u_depthResponse");
			this.uDepthNormalSmoothnessLoc = gl.getUniformLocation(depthProgram, "u_normalSmoothness");

			// Pass 2 uniforms
			this.uWebcamLoc = gl.getUniformLocation(program, "u_webcam");
			this.uDepthNormalTexLoc = gl.getUniformLocation(program, "u_depthNormalTex");
			this.uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
			this.uNumLightsLoc = gl.getUniformLocation(program, "u_numLights");
			this.uLightPosLoc = gl.getUniformLocation(program, "u_lightPos");
			this.uLightColorLoc = gl.getUniformLocation(program, "u_lightColor");
			this.uLightParamsLoc = gl.getUniformLocation(program, "u_lightParams");
			this.uAmbientIntensityLoc = gl.getUniformLocation(program, "u_ambientIntensity");
			this.uAmbientColorLoc = gl.getUniformLocation(program, "u_ambientColor");
			this.uNormalSmoothnessLoc = gl.getUniformLocation(program, "u_normalSmoothness");
			this.uShadowSoftnessLoc = gl.getUniformLocation(program, "u_shadowSoftness");
			this.uSpecularShininessLoc = gl.getUniformLocation(program, "u_specularShininess");
			this.uExposureLoc = gl.getUniformLocation(program, "u_exposure");
			this.uContrastLoc = gl.getUniformLocation(program, "u_contrast");
			this.uMirrorLoc = gl.getUniformLocation(program, "u_mirror");
			this.uDiffuseWrapLoc = gl.getUniformLocation(program, "u_diffuseWrap");
			this.uHaloSuppressionLoc = gl.getUniformLocation(program, "u_haloSuppression");
			this.uShadowReachLoc = gl.getUniformLocation(program, "u_shadowReach");
			this.uShadowStepsLoc = gl.getUniformLocation(program, "u_shadowSteps");

			// Setup Fullscreen Quad VAO using explicit layout locations (0: a_position, 1: a_texCoord)
			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			this.vao = vao;

			const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
			this.positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

			const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
			this.texCoordBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

			// Input webcam texture (unit 0)
			this.texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			// Pass 1 pre-baked depth/normal target (unit 1)
			this.depthTexture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			this.depthFbo = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				this.depthTexture,
				0,
			);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);

			this.initialized = true;
			return true;
		} catch (e) {
			console.error("[StudioLightingEngine] Failed to initialize WebGL2:", e);
			return false;
		}
	}

	private compileShader(type: number, source: string): WebGLShader | null {
		if (!this.gl) return null;
		const shader = this.gl.createShader(type);
		if (!shader) return null;
		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);
		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			console.error("[StudioLightingEngine] Shader compile error:", this.gl.getShaderInfoLog(shader));
			this.gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	public renderToCanvas(
		source: CanvasImageSource | ImageData | VideoFrame,
		settings: StudioLightingSettings,
		mirror = false,
		options?: StudioLightingRenderOptions,
	): HTMLCanvasElement | null {
		if (!this.initialized && !this.initialize()) {
			return null;
		}
		if (!this.gl || !this.program || !this.depthProgram || !this.canvas || !this.depthFbo || !this.depthTexture) {
			return null;
		}

		const gl = this.gl;
		let sourceWidth = 640;
		let sourceHeight = 480;

		if (source instanceof ImageData) {
			sourceWidth = source.width;
			sourceHeight = source.height;
		} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
			sourceWidth = source.displayWidth || source.codedWidth || 640;
			sourceHeight = source.displayHeight || source.codedHeight || 480;
		} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
			sourceWidth = source.videoWidth || source.width || 640;
			sourceHeight = source.videoHeight || source.height || 480;
		} else {
			const cs = source as { width?: number; height?: number };
			sourceWidth = cs.width || 640;
			sourceHeight = cs.height || 480;
		}

		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return null;
		}

		let width = sourceWidth;
		let height = sourceHeight;
		const maxDimension = options?.maxDimension;
		if (maxDimension && maxDimension > 0 && Math.max(sourceWidth, sourceHeight) > maxDimension) {
			const scale = maxDimension / Math.max(sourceWidth, sourceHeight);
			width = Math.max(2, Math.round(sourceWidth * scale));
			height = Math.max(2, Math.round(sourceHeight * scale));
		}

		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		const targetDepthWidth = Math.max(128, Math.ceil(width / 3));
		const targetDepthHeight = Math.max(90, Math.ceil(height / 3));
		if (this.depthFboWidth !== targetDepthWidth || this.depthFboHeight !== targetDepthHeight) {
			this.depthFboWidth = targetDepthWidth;
			this.depthFboHeight = targetDepthHeight;
			gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA8,
				targetDepthWidth,
				targetDepthHeight,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				null,
			);
		}

		// Upload webcam source texture once to unit 0
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		if (source instanceof ImageData) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sourceWidth, sourceHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
		}

		gl.bindVertexArray(this.vao);

		// Pass 1: Precompute smooth depth and float-precision base normals into 1/3-resolution FBO
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo);
		gl.viewport(0, 0, targetDepthWidth, targetDepthHeight);
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook
		gl.useProgram(this.depthProgram);
		gl.uniform1i(this.uDepthWebcamLoc, 0);
		gl.uniform2f(this.uDepthResolutionLoc, width, height);
		gl.uniform1f(this.uDepthResponseLoc, settings.depthResponse ?? 1.0);
		gl.uniform1f(this.uDepthNormalSmoothnessLoc, settings.normalSmoothness ?? 1.0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Pass 2: Full-frame lighting reading pre-baked depth/normals on unit 1
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook
		gl.useProgram(this.program);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
		gl.uniform1i(this.uWebcamLoc, 0);
		gl.uniform1i(this.uDepthNormalTexLoc, 1);
		gl.uniform2f(this.uResolutionLoc, width, height);

		// Lights
		const activeLights = (settings.lights || []).filter((l) => l.enabled).slice(0, 8);
		gl.uniform1i(this.uNumLightsLoc, activeLights.length);

		for (let i = 0; i < 8; i++) {
			const idx3 = i * 3;
			const idx4 = i * 4;
			const light = activeLights[i];
			if (light) {
				this.lightPositions[idx3] = light.x;
				this.lightPositions[idx3 + 1] = light.y;
				this.lightPositions[idx3 + 2] = light.z;

				const [r, g, b] = hexToRgb(light.color);
				this.lightColors[idx3] = r;
				this.lightColors[idx3 + 1] = g;
				this.lightColors[idx3 + 2] = b;

				this.lightParams[idx4] = light.intensity;
				this.lightParams[idx4 + 1] = light.radius;
				this.lightParams[idx4 + 2] = light.castShadow ? 1.0 : 0.0;
				this.lightParams[idx4 + 3] = light.specular;
			} else {
				this.lightPositions[idx3] = 0;
				this.lightPositions[idx3 + 1] = 0;
				this.lightPositions[idx3 + 2] = 0;

				this.lightColors[idx3] = 0;
				this.lightColors[idx3 + 1] = 0;
				this.lightColors[idx3 + 2] = 0;

				this.lightParams[idx4] = 0;
				this.lightParams[idx4 + 1] = 0;
				this.lightParams[idx4 + 2] = 0;
				this.lightParams[idx4 + 3] = 0;
			}
		}

		gl.uniform3fv(this.uLightPosLoc, this.lightPositions);
		gl.uniform3fv(this.uLightColorLoc, this.lightColors);
		gl.uniform4fv(this.uLightParamsLoc, this.lightParams);

		// Ambient and globals
		const [ar, ag, ab] = hexToRgb(settings.ambientColor || "#202028");
		gl.uniform1f(this.uAmbientIntensityLoc, settings.ambientIntensity ?? 0.5);
		gl.uniform3f(this.uAmbientColorLoc, ar, ag, ab);
		gl.uniform1f(this.uNormalSmoothnessLoc, settings.normalSmoothness ?? 1.0);
		gl.uniform1f(this.uShadowSoftnessLoc, settings.shadowSoftness ?? 0.5);
		gl.uniform1f(this.uSpecularShininessLoc, settings.specularShininess ?? 24.0);
		gl.uniform1f(this.uExposureLoc, settings.exposure ?? 1.0);
		gl.uniform1f(this.uContrastLoc, settings.contrast ?? 1.0);
		gl.uniform1i(this.uMirrorLoc, mirror ? 1 : 0);
		gl.uniform1f(this.uDiffuseWrapLoc, settings.diffuseWrap ?? 0.20);
		gl.uniform1f(this.uHaloSuppressionLoc, settings.haloSuppression ?? 0.75);
		gl.uniform1f(this.uShadowReachLoc, settings.shadowReach ?? 0.25);
		gl.uniform1i(this.uShadowStepsLoc, settings.shadowSteps ?? 10);

		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.bindVertexArray(null);

		return this.canvas;
	}

	public render(
		source: CanvasImageSource | ImageData | VideoFrame,
		settings: StudioLightingSettings,
		mirror = false,
		options?: StudioLightingRenderOptions,
	): boolean {
		return Boolean(this.renderToCanvas(source, settings, mirror, options));
	}

	public dispose() {
		if (!this.gl) return;
		const gl = this.gl;
		if (this.program) gl.deleteProgram(this.program);
		if (this.depthProgram) gl.deleteProgram(this.depthProgram);
		if (this.vao) gl.deleteVertexArray(this.vao);
		if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
		if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
		if (this.texture) gl.deleteTexture(this.texture);
		if (this.depthTexture) gl.deleteTexture(this.depthTexture);
		if (this.depthFbo) gl.deleteFramebuffer(this.depthFbo);
		this.initialized = false;
		this.depthFboWidth = 0;
		this.depthFboHeight = 0;
		this.gl = null;
		this.canvas = null;
	}
}

/**
 * Global shared renderer instance for off-screen / export frame processing
 */
let sharedEngineInstance: StudioLightingEngine | null = null;

export function renderStudioLightingToCanvas(
	source: CanvasImageSource | ImageData | VideoFrame,
	targetCanvas: HTMLCanvasElement,
	settings: StudioLightingSettings,
	mirror = false,
	options?: StudioLightingRenderOptions,
): boolean {
	let sourceWidth = 640;
	let sourceHeight = 480;

	if (source instanceof ImageData) {
		sourceWidth = source.width;
		sourceHeight = source.height;
	} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
		sourceWidth = source.displayWidth || source.codedWidth || 640;
		sourceHeight = source.displayHeight || source.codedHeight || 480;
	} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
		sourceWidth = source.videoWidth || source.width || 640;
		sourceHeight = source.videoHeight || source.height || 480;
	} else {
		const cs = source as { width?: number; height?: number };
		sourceWidth = cs.width || 640;
		sourceHeight = cs.height || 480;
	}

	let width = sourceWidth;
	let height = sourceHeight;
	const maxDimension = options?.maxDimension;
	if (maxDimension && maxDimension > 0 && Math.max(sourceWidth, sourceHeight) > maxDimension) {
		const scale = maxDimension / Math.max(sourceWidth, sourceHeight);
		width = Math.max(2, Math.round(sourceWidth * scale));
		height = Math.max(2, Math.round(sourceHeight * scale));
	}

	if (targetCanvas.width !== width || targetCanvas.height !== height) {
		targetCanvas.width = width;
		targetCanvas.height = height;
	}

	if (!settings.enabled) {
		const ctx = targetCanvas.getContext("2d");
		if (!ctx) return false;
		ctx.save();
		if (mirror) {
			ctx.translate(width, 0);
			ctx.scale(-1, 1);
		}
		if (source instanceof ImageData) {
			ctx.putImageData(source, 0, 0);
		} else {
			ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
		}
		ctx.restore();
		return true;
	}

	if (!sharedEngineInstance) {
		sharedEngineInstance = new StudioLightingEngine();
		sharedEngineInstance.initialize();
	}

	const glCanvas = sharedEngineInstance.renderToCanvas(source, settings, mirror, options);
	if (!glCanvas) {
		const ctx = targetCanvas.getContext("2d");
		if (ctx && !(source instanceof ImageData)) {
			ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
		}
		return false;
	}

	if (targetCanvas === glCanvas) {
		return true;
	}

	const ctx = targetCanvas.getContext("2d");
	if (!ctx) return false;
	ctx.clearRect(0, 0, width, height);
	ctx.drawImage(glCanvas, 0, 0, width, height);
	return true;
}

