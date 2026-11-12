## What's Changed in AnyRecord v1.4.3

### ☁️ Cloudinary & Neon Cloud Storage Integration
- **Build-time Database Configuration**: Injected `CLOUDINARY_DATABASE_URL` and `CLOUDINARY_TOKEN_KEY` into the packaged Electron build and CI/CD workflows.
- **Packaged Standalone Support**: Enables the Cloud tab and Cloudinary OAuth connection in distributed desktop releases without requiring a local `.env` file.

## What's Changed in AnyRecord v1.4.2

### ☁️ Cloud Sign-In & Supabase Integration
- **Build Workflow Injection**: Supabase authentication credentials are now injected into CI/CD build workflows across Windows, macOS, and Linux packages.
- **Enabled OAuth Providers**: Full support for Google and GitHub social logins and email authentication out of the box in packaged desktop releases.

## What's Changed in AnyRecord v1.4.1

### 🎙️ AI-Powered Noise Suppression
- **Live Real-Time Noise Reduction**: Integrated DeepFilterNet / DTLN audio worklet via `@workadventure/noise-suppression` for live microphone and webcam audio filtering.
- **Minimal HUD Settings & Test**: Added a clean live settings popup with adjustable noise reduction level slider and live mic test recording.
- **Export Pipeline Processing**: Offline noise reduction is seamlessly applied to microphone and camera audio tracks when rendering and exporting.

### 📹 Camera-Only Mode Refinements
- **Focused UI for Camera Footages**: When recording in Camera mode, screen-specific options (display picker, system audio, PIP webcam overlays) are hidden from the HUD.
- **Full-Bleed Editor Presentation**: Camera recordings open edge-to-edge on canvas without desktop window borders, shadows, or cursor overlays.
- **Streamlined Sidebar**: The video editor sidebar hides desktop effect tabs (Scene, Cursor, Gestures, Webcam PIP), focusing directly on Audio, Captions, and Settings.

### ⚡ Performance & Stability
- **Windows Helpers**: Fully bundled and signed native helpers (`wgc-capture.exe`, `recordly-gpu-export.exe`, `cursor-monitor.exe`, and Whisper runtime).
- **Offline Audio Encoder**: Robust multi-track audio offline processing and synchronization.
