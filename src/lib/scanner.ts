/**
 * Browser barcode scanner: rear camera → video frames → zxing-wasm (EAN-13/8, UPC-A/E).
 * Safari has no native BarcodeDetector, so WASM is used everywhere. The .wasm is served from /wasm/.
 */
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/wasm/${path}` : prefix + path),
  },
});

const OPTIONS: ReaderOptions = {
  formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'],
  tryHarder: true,
  maxNumberOfSymbols: 1,
};

export class Scanner {
  private stream: MediaStream | null = null;
  private running = false;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(private video: HTMLVideoElement, private onCode: (code: string) => void) {}

  get active(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const { videoWidth: w, videoHeight: h } = this.video;
      if (w && h) {
        // Decode the middle band of the frame, where the guide line is — faster and fewer false reads.
        const bandH = Math.round(h * 0.5);
        const scale = Math.min(1, 1000 / w);
        this.canvas.width = Math.round(w * scale);
        this.canvas.height = Math.round(bandH * scale);
        this.ctx.drawImage(this.video, 0, (h - bandH) / 2, w, bandH, 0, 0, this.canvas.width, this.canvas.height);
        try {
          const [hit] = await readBarcodes(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height), OPTIONS);
          if (hit?.isValid && hit.text && this.running) {
            this.stop();
            navigator.vibrate?.(60);
            this.onCode(hit.text);
            return;
          }
        } catch {
          /* keep scanning */
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

/** Decode a still photo (fallback when live camera isn't available). */
export async function scanPhoto(file: File): Promise<string | null> {
  const [hit] = await readBarcodes(file, { ...OPTIONS, tryHarder: true });
  return hit?.isValid ? hit.text : null;
}
