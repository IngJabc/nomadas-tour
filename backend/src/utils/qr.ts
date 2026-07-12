import QRCode from 'qrcode';

export function generateQRContent(destination: string, transactionId: string): string {
  return `NT-${destination.toUpperCase()}-${transactionId.toUpperCase()}`;
}

export async function generateQRDataURL(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    width: 256,
    margin: 2,
    color: {
      dark: '#000024',
      light: '#ffffff',
    },
  });
}
