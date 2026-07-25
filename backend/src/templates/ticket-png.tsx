import type { TicketData } from '../types/reservation.js';

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

const TZ = 'America/Caracas';

function formatDateShort(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatTime12h(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function formatDateTimeShort(iso: string): string {
  if (!iso) return '—';
  const date = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
  return `${date} · ${time}`;
}

/* ── Inline SVG icons (Lucide-compatible paths, Satori-safe) ── */

function CheckCircleIcon({ size = 20, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MapPinIcon({ size = 16, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CalendarIcon({ size = 14, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClockIcon({ size = 14, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function BusIcon({ size = 14, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6v6" />
      <path d="M16 6v6" />
      <path d="M2 12h20" />
      <path d="M7 18v2" />
      <path d="M17 18v2" />
      <path d="M3 6h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

function UserIcon({ size = 16, color = '#00D4FF' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AlertTriangleIcon({ size = 14, color = '#92400e' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CreditCardIcon({ size = 12, color = '#6b7280' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

export function TicketPNGTemplate({ ticket }: { ticket: TicketData }) {
  const trip = ticket.trip;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 400,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        overflow: 'hidden',
        fontFamily: 'Poppins',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: '#000024',
          padding: '16px 20px',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: 'rgba(0,212,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckCircleIcon size={20} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'Montserrat',
            }}
          >
            Boleto de viaje
          </span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
            Presenta este código QR al abordar
          </span>
        </div>
      </div>

      {/* QR Code */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            borderRadius: 16,
            border: '2px solid rgba(0,212,255,0.15)',
            backgroundColor: '#ffffff',
            boxShadow: '0 2px 12px rgba(0,212,255,0.06)',
          }}
        >
          <img src={ticket.qr_data_url} width={150} height={150} />
        </div>
        <span
          style={{
            marginTop: 12,
            fontSize: 12,
            fontWeight: 500,
            color: '#000024',
            wordBreak: 'break-all',
            textAlign: 'center',
          }}
        >
          {ticket.qr_code}
        </span>
      </div>

      {/* Trip Info */}
      {trip && (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px 16px' }}>
          <div
            style={{
              backgroundColor: '#f1f5f9',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Route */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: 'rgba(0,212,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <MapPinIcon size={16} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Ruta
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#000024',
                    fontFamily: 'Montserrat',
                  }}
                >
                  {trip.origin} → {trip.destination}
                </span>
              </div>
            </div>

            {/* Date / Time / Vehicle grid */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarIcon size={14} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Fecha
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#000024' }}>
                    {formatDateShort(trip.departure_time)}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClockIcon size={14} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Salida
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#000024' }}>
                    {formatTime12h(trip.departure_time)}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BusIcon size={14} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Vehículo
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#000024' }}>
                    {VEHICLE_LABELS[trip.vehicle_type] ?? trip.vehicle_type}
                  </span>
                </div>
              </div>
            </div>

            {/* Postponed banner */}
            {trip.postponed_from && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                }}
              >
                <AlertTriangleIcon size={14} />
                <span style={{ fontSize: 11, color: '#92400e' }}>
                  Viaje pospuesto — Salida original: {formatDateTimeShort(trip.postponed_from)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Booker */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#000024', marginBottom: 8 }}>
            Reservador
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(0,212,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <UserIcon size={16} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#000024',
                  fontFamily: 'Montserrat',
                }}
              >
                {ticket.booker_name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <CreditCardIcon size={12} />
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {ticket.booker_document}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Passengers */}
      {ticket.passengers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#000024' }}>
              Pasajeros ({ticket.passengers.length})
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {ticket.passengers.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: i < ticket.passengers.length - 1 ? 8 : 0,
                    borderBottom: i < ticket.passengers.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#00D4FF',
                        backgroundColor: 'rgba(0,212,255,0.1)',
                        paddingLeft: 8,
                        paddingRight: 8,
                        paddingTop: 2,
                        paddingBottom: 2,
                        borderRadius: 6,
                        minWidth: 34,
                        textAlign: 'center',
                      }}
                    >
                      {p.seat_code}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#000024' }}>
                        {p.name || 'Sin nombre'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <CreditCardIcon size={12} />
                        <span style={{ fontSize: 11, color: '#6b7280' }}>
                          {p.document}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 20px',
          backgroundColor: '#f1f5f9',
          borderTop: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            textAlign: 'center',
          }}
        >
          Código: {ticket.reservation_id.slice(0, 8).toUpperCase()}
        </span>
      </div>
    </div>
  );
}
