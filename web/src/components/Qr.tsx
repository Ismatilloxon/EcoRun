import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { useApp } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';

export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(setSvg);
  }, [value]);
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Camera QR scanner: BarcodeDetector when available, jsQR fallback. */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t, toast } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = 'BarcodeDetector' in window ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null;

    const tick = async () => {
      const v = video.current;
      if (!v || done.current) return;
      if (v.readyState >= 2) {
        try {
          let text: string | null = null;
          if (detector) {
            const codes = await detector.detect(v);
            text = codes[0]?.rawValue ?? null;
          } else if (ctx) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height)?.data ?? null;
          }
          if (text) {
            done.current = true;
            navigator.vibrate?.(30);
            onResult(text);
            return;
          }
        } catch {
          /* keep scanning */
        }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        toast(t('err.camera_unavailable'), 'error');
        onClose();
      });
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: '#000', aspectRatio: '1' }}>
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,0.85)', borderRadius: 18 }} />
      </div>
      <button className="btn gray" onClick={onClose}>
        <Icon name="close" size={18} /> {t('pt.stopCamera')}
      </button>
    </div>
  );
}
