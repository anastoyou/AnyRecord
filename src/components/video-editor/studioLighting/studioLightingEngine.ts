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
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_webcam;
uniform vec2 u_resolution;

const int MAX_LIGHTS = 8;
uniform int u_numLights;
uniform vec3 u_lightPos[MAX_LIGHTS];       // (x, y, z)
uniform vec3 u_lightColor[MAX_LIGHTS];     // (r, g, b)
uniform vec4 u_lightParams[MAX_LIGHTS];    // (x: intensity, y: radius, z: castShadow, w: specular)

uniform float u_ambientIntensity;
uniform vec3 u_ambientColor;
uniform float u_depthResponse;
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
const float TAN_HALF_FOV = 0.57735; // 60 deg vertical FOV perspective
const float FAR_PLANE = 3.5;
const float LIGHT_SWING = 1.7;

// Depthbake perspective depth conversion: toZ(d, far) = 1.0 / mix(1.0 / far, 1.0, d)
float toZ(float d, float farZ) {
    return 1.0 / mix(1.0 / farZ, 1.0, clamp(d, 0.001, 1.0));
}

// Depthbake 3D camera-space position reconstruction
vec3 reconstructWorldPos(vec2 uv, float d, float aspect, float tanF, float farZ) {
    float z = toZ(d, farZ);
    vec2 s = vec2((uv.x * 2.0 - 1.0) * aspect, (1.0 - uv.y) * 2.0 - 1.0) * tanF;
    return vec3(s * z, -z);
}

// Convert 3D camera-space coordinate back to screen UV
vec2 toScreenUv(vec3 p, float aspect, float tanF) {
    vec2 ndc = p.xy / max(-p.z, 0.0001) / (tanF * vec2(aspect, 1.0));
    return vec2((ndc.x + 1.0) * 0.5, 1.0 - (ndc.y + 1.0) * 0.5);
}

// 9-tap 2D Gaussian low-pass depth sampling to eliminate sensor noise and ISO micro-grain
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
    
    // Smooth portrait volumetric dome prior
    vec2 centerOffset = (uv - vec2(0.5, 0.44)) * vec2(1.15, 1.30);
    float r = length(centerOffset);
    float dome = clamp(1.0 - r * 1.30, 0.0, 1.0);
    dome = smoothstep(0.0, 1.0, dome);
    
    // Hair & dark-region protection:
    // In dark hair, beard, and shadows, do NOT carve steep depth craters!
    // Modulate depth only where there is skin-level luminance.
    float skinLumFactor = smoothstep(0.08, 0.35, smoothLum);
    float lumRelief = (smoothLum - 0.35) * 0.18 * clamp(u_depthResponse, 0.1, 1.5) * skinLumFactor;
    
    return clamp(dome * 0.85 + 0.10 + lumRelief, 0.05, 0.95);
}

// Depthbake base surface normal reconstruction via orthogonal central differences
vec3 computeLocalNormal(vec2 uv, vec2 px, float aspect, float tanF, float farZ) {
    float k = max(4.0, u_normalSmoothness * 12.0);
    vec2 stepUv = px * k;
    
    float dR = estimateSmoothDepth(uv + vec2(stepUv.x, 0.0), px);
    float dL = estimateSmoothDepth(uv - vec2(stepUv.x, 0.0), px);
    float dU = estimateSmoothDepth(uv - vec2(0.0, stepUv.y), px); // UV y=0 is top, so -y is UP in 3D (+Y)
    float dD = estimateSmoothDepth(uv + vec2(0.0, stepUv.y), px); // UV y=1 is bottom, so +y is DOWN in 3D (-Y)
    
    vec3 pR = reconstructWorldPos(uv + vec2(stepUv.x, 0.0), dR, aspect, tanF, farZ);
    vec3 pL = reconstructWorldPos(uv - vec2(stepUv.x, 0.0), dL, aspect, tanF, farZ);
    vec3 pU = reconstructWorldPos(uv - vec2(0.0, stepUv.y), dU, aspect, tanF, farZ);
    vec3 pD = reconstructWorldPos(uv + vec2(0.0, stepUv.y), dD, aspect, tanF, farZ);
    
    vec3 dX = pR - pL;
    vec3 dY = pU - pD;
    vec3 n = cross(dX, dY);
    if (length(n) < 0.0001) return vec3(0.0, 0.0, 1.0);
    n = normalize(n);
    if (n.z < 0.0) n = -n;
    return n;
}

// Depthbake Vogel Spiral normal filtering, normal agreement & depth range estimation
vec3 computeDepthbakeNormals(
    vec2 uv,
    vec2 px,
    float aspect,
    float tanF,
    float farZ,
    out float dCenter,
    out float nAgree,
    out float dRange
) {
    dCenter = estimateSmoothDepth(uv, px);
    vec3 baseN = computeLocalNormal(uv, px, aspect, tanF, farZ);
    
    float baseRadius = max(5.0, u_normalSmoothness * 14.0);
    vec3 accNormal = baseN;
    float dNear = dCenter;
    float dFar = dCenter;
    
    for (int i = 0; i < VOGEL_TAPS; i++) {
        float r = baseRadius * sqrt((float(i) + 0.5) / float(VOGEL_TAPS));
        float a = float(i) * GOLDEN_ANGLE;
        vec2 off = vec2(cos(a), sin(a)) * r * px;
        vec2 tapUv = clamp(uv + off, 0.0, 1.0);
        
        float dTap = estimateSmoothDepth(tapUv, px);
        dNear = max(dNear, dTap);
        dFar = min(dFar, dTap);
        
        vec3 nTap = computeLocalNormal(tapUv, px, aspect, tanF, farZ);
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
    vec3 N = computeDepthbakeNormals(uv, px, aspect, TAN_HALF_FOV, FAR_PLANE, dCenter, nAgree, dRange);
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
                
                float sampledDepth = estimateSmoothDepth(suv, px);
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

export class StudioLightingEngine {
	private gl: WebGL2RenderingContext | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private program: WebGLProgram | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private positionBuffer: WebGLBuffer | null = null;
	private texCoordBuffer: WebGLBuffer | null = null;
	private texture: WebGLTexture | null = null;

	// Uniform locations
	private uWebcamLoc: WebGLUniformLocation | null = null;
	private uResolutionLoc: WebGLUniformLocation | null = null;
	private uNumLightsLoc: WebGLUniformLocation | null = null;
	private uLightPosLoc: WebGLUniformLocation | null = null;
	private uLightColorLoc: WebGLUniformLocation | null = null;
	private uLightParamsLoc: WebGLUniformLocation | null = null;
	private uAmbientIntensityLoc: WebGLUniformLocation | null = null;
	private uAmbientColorLoc: WebGLUniformLocation | null = null;
	private uDepthResponseLoc: WebGLUniformLocation | null = null;
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

	public initialize(canvas?: HTMLCanvasElement): boolean {
		try {
			if (typeof document === "undefined") return false;
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

			const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
			const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
			if (!vs || !fs) return false;

			const program = gl.createProgram();
			if (!program) return false;
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				console.error("[StudioLightingEngine] Program link error:", gl.getProgramInfoLog(program));
				return false;
			}
			this.program = program;

			// Uniforms
			this.uWebcamLoc = gl.getUniformLocation(program, "u_webcam");
			this.uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
			this.uNumLightsLoc = gl.getUniformLocation(program, "u_numLights");
			this.uLightPosLoc = gl.getUniformLocation(program, "u_lightPos");
			this.uLightColorLoc = gl.getUniformLocation(program, "u_lightColor");
			this.uLightParamsLoc = gl.getUniformLocation(program, "u_lightParams");
			this.uAmbientIntensityLoc = gl.getUniformLocation(program, "u_ambientIntensity");
			this.uAmbientColorLoc = gl.getUniformLocation(program, "u_ambientColor");
			this.uDepthResponseLoc = gl.getUniformLocation(program, "u_depthResponse");
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

			// Setup Fullscreen Quad VAO
			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			this.vao = vao;

			const aPosLoc = gl.getAttribLocation(program, "a_position");
			const aTexLoc = gl.getAttribLocation(program, "a_texCoord");

			const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
			this.positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
			if (aPosLoc >= 0) {
				gl.enableVertexAttribArray(aPosLoc);
				gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
			}

			const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
			this.texCoordBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
			if (aTexLoc >= 0) {
				gl.enableVertexAttribArray(aTexLoc);
				gl.vertexAttribPointer(aTexLoc, 2, gl.FLOAT, false, 0, 0);
			}

			// Texture
			this.texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

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
	): HTMLCanvasElement | null {
		if (!this.initialized && !this.initialize()) {
			return null;
		}
		if (!this.gl || !this.program || !this.canvas) {
			return null;
		}

		const gl = this.gl;
		let width = 640;
		let height = 480;

		if (source instanceof ImageData) {
			width = source.width;
			height = source.height;
		} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
			width = source.displayWidth || source.codedWidth || 640;
			height = source.displayHeight || source.codedHeight || 480;
		} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
			width = source.videoWidth || source.width || 640;
			height = source.videoHeight || source.height || 480;
		} else {
			const cs = source as { width?: number; height?: number };
			width = cs.width || 640;
			height = cs.height || 480;
		}

		if (width <= 0 || height <= 0) {
			return null;
		}

		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		gl.viewport(0, 0, width, height);
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook
		gl.useProgram(this.program);

		// Bind texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		if (source instanceof ImageData) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
		}
		gl.uniform1i(this.uWebcamLoc, 0);
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
		gl.uniform1f(this.uDepthResponseLoc, settings.depthResponse ?? 1.0);
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

		// Draw
		gl.bindVertexArray(this.vao);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.bindVertexArray(null);

		return this.canvas;
	}

	public render(
		source: CanvasImageSource | ImageData | VideoFrame,
		settings: StudioLightingSettings,
		mirror = false,
	): boolean {
		return Boolean(this.renderToCanvas(source, settings, mirror));
	}

	public dispose() {
		if (!this.gl) return;
		const gl = this.gl;
		if (this.program) gl.deleteProgram(this.program);
		if (this.vao) gl.deleteVertexArray(this.vao);
		if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
		if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
		if (this.texture) gl.deleteTexture(this.texture);
		this.initialized = false;
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
): boolean {
	let width = 640;
	let height = 480;

	if (source instanceof ImageData) {
		width = source.width;
		height = source.height;
	} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
		width = source.displayWidth || source.codedWidth || 640;
		height = source.displayHeight || source.codedHeight || 480;
	} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
		width = source.videoWidth || source.width || 640;
		height = source.videoHeight || source.height || 480;
	} else {
		const cs = source as { width?: number; height?: number };
		width = cs.width || 640;
		height = cs.height || 480;
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

	const glCanvas = sharedEngineInstance.renderToCanvas(source, settings, mirror);
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

