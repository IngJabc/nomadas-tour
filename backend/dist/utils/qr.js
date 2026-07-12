import QRCode from 'qrcode';
export function generateQRContent(destination, transactionId) {
    return `NT-${destination.toUpperCase()}-${transactionId.toUpperCase()}`;
}
export async function generateQRDataURL(content) {
    return QRCode.toDataURL(content, {
        width: 256,
        margin: 2,
        color: {
            dark: '#000024',
            light: '#ffffff',
        },
    });
}
//# sourceMappingURL=qr.js.map