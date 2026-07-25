import React from 'react';
import type { TicketData } from '../types/reservation.js';

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime12h(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${period}`;
}

function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  return `${formatDateShort(iso)} ${formatTime12h(iso)}`;
}

export function ReservationTicketEmail({ ticket }: { ticket: TicketData }) {
  const trip = ticket.trip;
  const passengerCount = ticket.passengers.length;

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={bodyStyle}>
        <div style={containerStyle}>
          <div style={cardStyle}>
            {/* Header */}
            <div style={headerBarStyle}>
              <div style={headerIconStyle}>
                <svg style={headerCheckSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div>
                <p style={headerTitleStyle}>Boleto de viaje</p>
                <p style={headerSubtitleStyle}>Presenta este código QR al abordar</p>
              </div>
            </div>

            {/* QR Code */}
            <div style={qrSectionStyle}>
              {ticket.qr_data_url ? (
                <div style={qrImageContainerStyle}>
                  <img
                    src={ticket.qr_data_url}
                    alt="Código QR de reserva"
                    width={150}
                    height={150}
                    style={{ display: 'block' }}
                  />
                </div>
              ) : (
                <div style={qrFallbackStyle}>
                  <span style={qrFallbackTextStyle}>{ticket.qr_code}</span>
                </div>
              )}
              <p style={qrCodeTextStyle}>{ticket.qr_code}</p>
            </div>

            {/* Trip Info */}
            {trip && (
              <div style={tripSectionStyle}>
                <div style={tripInfoBoxStyle}>
                  {/* Route */}
                  <div style={infoRowStyle}>
                    <div style={infoIconStyle}>
                      <svg style={infoIconSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </div>
                    <div style={infoContentStyle}>
                      <p style={infoLabelStyle}>Ruta</p>
                      <p style={infoValueBoldStyle}>{trip.origin} → {trip.destination}</p>
                    </div>
                  </div>

                  {/* Date / Time / Vehicle grid */}
                  <div style={gridStyle}>
                    <div style={gridItemStyle}>
                      <div style={gridIconStyle}>
                        <svg style={gridIconSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <p style={infoLabelStyle}>Fecha</p>
                      <p style={infoValueStyle}>{formatDateShort(trip.departure_time)}</p>
                    </div>
                    <div style={gridItemStyle}>
                      <div style={gridIconStyle}>
                        <svg style={gridIconSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                      </div>
                      <p style={infoLabelStyle}>Salida</p>
                      <p style={infoValueStyle}>{formatTime12h(trip.departure_time)}</p>
                    </div>
                    <div style={gridItemStyle}>
                      <div style={gridIconStyle}>
                        <svg style={gridIconSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 6v6" />
                          <path d="M16 6v6" />
                          <path d="M2 12h20" />
                          <path d="M18 18H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
                          <path d="M6 18v3" />
                          <path d="M18 18v3" />
                        </svg>
                      </div>
                      <p style={infoLabelStyle}>Vehículo</p>
                      <p style={infoValueStyle}>{VEHICLE_LABELS[trip.vehicle_type] ?? trip.vehicle_type}</p>
                    </div>
                  </div>

                  {/* Postponed banner */}
                  {trip.postponed_from && (
                    <div style={postponedBannerStyle}>
                      <svg style={postponedIconSvg} viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <p style={postponedTextStyle}>
                        Viaje pospuesto — Salida original: {formatDateTimeShort(trip.postponed_from)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Booker */}
            <div style={sectionStyle}>
              <div style={sectionBoxStyle}>
                <p style={sectionTitleStyle}>Reservador</p>
                <div style={infoRowStyle}>
                  <div style={infoIconStyle}>
                    <svg style={infoIconSvg} viewBox="0 0 24 24" fill="none" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div style={infoContentStyle}>
                    <p style={infoValueBoldStyle}>{ticket.booker_name}</p>
                    <div style={docRowStyle}>
                      <svg style={docIconSvg} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="5" width="20" height="14" rx="2" />
                        <line x1="2" y1="10" x2="22" y2="10" />
                      </svg>
                      <p style={docTextStyle}>{ticket.booker_document}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Passengers */}
            {ticket.passengers.length > 0 && (
              <div style={sectionStyle}>
                <div style={sectionBoxStyle}>
                  <p style={sectionTitleStyle}>Pasajeros ({passengerCount})</p>
                  {ticket.passengers.map((p, i) => (
                    <div key={p.id} style={{
                      ...passengerRowStyle,
                      borderBottom: i < ticket.passengers.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                    }}>
                      <div style={passengerSeatBadgeStyle}>
                        <span style={passengerSeatTextStyle}>{p.seat_code}</span>
                      </div>
                      <span style={passengerNameStyle}>{p.name || 'Sin nombre'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={footerBarStyle}>
              <p style={footerTextStyle}>
                Código: {ticket.reservation_id.slice(0, 8).toUpperCase()}
              </p>
            </div>

            {/* Disclaimer */}
            <p style={disclaimerStyle}>
              Guarda este correo como comprobante de tu reserva. Si tienes alguna consulta, contacta a tu agencia de viajes.
            </p>

            <div style={dividerStyle} />

            <p style={brandFooterStyle}>
              Nómadas Tour — Dejando huellas por Venezuela
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

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
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.06)',
  overflow: 'hidden',
};

// Header bar
const headerBarStyle: React.CSSProperties = {
  backgroundColor: '#000024',
  padding: '16px 20px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const headerIconStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '12px',
  backgroundColor: 'rgba(0,212,255,0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const headerCheckSvg: React.CSSProperties = {
  width: '20px',
  height: '20px',
};

const headerTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  fontWeight: 700,
  color: '#ffffff',
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
};

const headerSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '11px',
  color: 'rgba(255,255,255,0.6)',
};

// QR section
const qrSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '24px 20px',
};

const qrImageContainerStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  padding: '12px',
  borderRadius: '16px',
  border: '2px solid rgba(0,212,255,0.15)',
  boxShadow: '0 2px 12px rgba(0,212,255,0.06)',
};

const qrFallbackStyle: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  border: '2px dashed #e5e7eb',
  borderRadius: '12px',
  padding: '20px 32px',
};

const qrFallbackTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: '#000024',
  fontFamily: 'monospace',
  letterSpacing: '0.1em',
};

const qrCodeTextStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: '12px',
  fontWeight: 500,
  color: '#000024',
  wordBreak: 'break-all',
  textAlign: 'center',
};

// Trip section
const tripSectionStyle: React.CSSProperties = {
  padding: '0 20px 16px',
};

const tripInfoBoxStyle: React.CSSProperties = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '16px',
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '12px',
};

const infoIconStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  backgroundColor: 'rgba(0,212,255,0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const infoIconSvg: React.CSSProperties = {
  width: '16px',
  height: '16px',
};

const infoContentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const infoLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '10px',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const infoValueBoldStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 700,
  color: '#000024',
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
};

const infoValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  fontWeight: 500,
  color: '#000024',
};

// Grid (date/time/vehicle)
const gridStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  marginBottom: '12px',
};

const gridItemStyle: React.CSSProperties = {
  flex: 1,
};

const gridIconStyle: React.CSSProperties = {
  marginBottom: '4px',
};

const gridIconSvg: React.CSSProperties = {
  width: '14px',
  height: '14px',
};

// Postponed banner
const postponedBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  borderRadius: '8px',
  backgroundColor: '#fffbeb',
  border: '1px solid #fde68a',
};

const postponedIconSvg: React.CSSProperties = {
  width: '14px',
  height: '14px',
  flexShrink: 0,
};

const postponedTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '11px',
  color: '#92400e',
};

// Sections (booker, passengers)
const sectionStyle: React.CSSProperties = {
  padding: '0 20px 16px',
};

const sectionBoxStyle: React.CSSProperties = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '16px',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: '12px',
  fontWeight: 600,
  color: '#000024',
};

const docRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
};

const docIconSvg: React.CSSProperties = {
  width: '12px',
  height: '12px',
};

const docTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '11px',
  color: '#6b7280',
};

// Passengers
const passengerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
};

const passengerSeatBadgeStyle: React.CSSProperties = {
  backgroundColor: 'rgba(0,212,255,0.1)',
  borderRadius: '6px',
  padding: '2px 8px',
  minWidth: '34px',
  textAlign: 'center',
  flexShrink: 0,
};

const passengerSeatTextStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#00D4FF',
};

const passengerNameStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: '#000024',
  marginLeft: '10px',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// Footer bar
const footerBarStyle: React.CSSProperties = {
  backgroundColor: '#f1f5f9',
  padding: '12px 20px',
  borderTop: '1px solid rgba(0,0,0,0.06)',
};

const footerTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '10px',
  color: '#6b7280',
  textAlign: 'center',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// Disclaimer + brand footer
const disclaimerStyle: React.CSSProperties = {
  margin: '16px 20px 0',
  fontSize: '12px',
  lineHeight: '20px',
  color: '#9ca3af',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  margin: '16px 20px',
};

const brandFooterStyle: React.CSSProperties = {
  margin: '0 20px 20px',
  fontSize: '12px',
  color: '#6b7280',
  textAlign: 'center',
};
