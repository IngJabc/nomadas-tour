import React from 'react';
import type { TicketData } from '../types/reservation.js';

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

function formatDateShort(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime12h(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${period}`;
}

export function ReservationConfirmedEmail({ ticket }: { ticket: TicketData }) {
  const origin = ticket.trip?.origin ?? '';
  const destination = ticket.trip?.destination ?? '';
  const departureTime = ticket.trip?.departure_time ?? '';
  const vehicleType = ticket.trip?.vehicle_type ?? '';
  const passengerCount = ticket.passengers?.length ?? 0;
  const vehicleLabel = VEHICLE_LABELS[vehicleType] ?? vehicleType;

  const bodyStyle: React.CSSProperties = {
    margin: 0,
    padding: 0,
    backgroundColor: '#f1f5f9',
    fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  };

  const containerStyle: React.CSSProperties = {
    padding: '40px 20px',
    maxWidth: '560px',
    margin: '0 auto',
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '40px 32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid rgba(0,0,0,0.06)',
  };

  const logoContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '32px',
  };

  const titleStyle: React.CSSProperties = {
    margin: '0 0 24px',
    fontSize: '24px',
    fontWeight: 700,
    color: '#000024',
    fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
    textAlign: 'center',
  };

  const textStyle: React.CSSProperties = {
    margin: '0 0 16px',
    fontSize: '14px',
    lineHeight: '24px',
    color: '#374151',
  };

  const infoBoxStyle: React.CSSProperties = {
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '16px 20px',
    margin: '24px 0',
    border: '1px solid #e5e7eb',
  };

  const infoLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '6px 0',
    verticalAlign: 'top',
    width: '100px',
  };

  const infoValueStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    color: '#000024',
    padding: '6px 0',
  };

  const dividerStyle: React.CSSProperties = {
    borderTop: '1px solid #e5e7eb',
    margin: '24px 0',
  };

  const footerStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '12px',
    color: '#6b7280',
    textAlign: 'center',
  };

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={bodyStyle}>
        <div style={containerStyle}>
          <div style={cardStyle}>
            {/* Logo */}
            <div style={logoContainerStyle}>
              <svg
                width="48"
                height="52"
                viewBox="0 0 80 86.02"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M80 19.15v47.44L68 73.08V32.77l-8-5.18v36.47L48 63.6V21.37l-8-5.18v36.47L24 54.13V11.92l-8-5.18v44.4L0 54.13V0l40 25.51L80 0v19.15z"
                  fill="#fff"
                />
              </svg>
            </div>

            {/* Title */}
            <h1 style={titleStyle}>Reserva confirmada</h1>

            {/* Body */}
            <p style={textStyle}>
              Tu reserva ha sido confirmada exitosamente. A continuación encontrarás
              los detalles de tu viaje.
            </p>

            <p style={textStyle}>
              El boleto digital de tu viaje está adjunto a este correo en formato PNG.
            </p>

            {/* Info box */}
            <div style={infoBoxStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={infoLabelStyle}>Origen</td>
                    <td style={infoValueStyle}>{origin}</td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Destino</td>
                    <td style={infoValueStyle}>{destination}</td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Salida</td>
                    <td style={infoValueStyle}>
                      {formatDateShort(departureTime)} — {formatTime12h(departureTime)}
                    </td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Vehículo</td>
                    <td style={infoValueStyle}>{vehicleLabel}</td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Pasajeros</td>
                    <td style={infoValueStyle}>{passengerCount}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer text */}
            <p style={textStyle}>
              Descarga el archivo adjunto <strong>boleto.png</strong> para ver tu
              boleto completo con código QR.
            </p>

            <div style={dividerStyle} />
            <p style={footerStyle}>Nómadas Tour — Dejando huellas por Venezuela</p>
          </div>
        </div>
      </body>
    </html>
  );
}
