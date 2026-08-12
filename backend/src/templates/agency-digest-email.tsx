import React from 'react';

export interface AgencyDigestTripRow {
  route_label: string;
  departure_formatted: string;
  reservation_count: number;
  available_seats: number;
  capacity: number;
  occupancy_pct: number;
}

interface AgencyDigestEmailProps {
  agencyName: string;
  digestDate: string;
  activeTrips: number;
  todayReservations: number;
  pendingBoarding: number;
  upcomingTrips: AgencyDigestTripRow[];
  dashboardUrl: string;
}

export function AgencyDigestEmail({
  agencyName,
  digestDate,
  activeTrips,
  todayReservations,
  pendingBoarding,
  upcomingTrips,
  dashboardUrl,
}: AgencyDigestEmailProps) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={bodyStyle}>
        <div style={containerStyle}>
          <div style={cardStyle}>
            <div style={headerStyle}>
              <div style={logoContainerStyle}>
                <svg style={logoSvgStyle} viewBox="0 0 80 86.02" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#fff" d="M88.29,7H67.11a1.7,1.7,0,0,0-1.7,1.71V52L38,7.79A1.69,1.69,0,0,0,36.5,7H14.57A1.7,1.7,0,0,0,12.86,8.7V66.25c0-.23-.07-.46-.11-.69q-1.27,7.26-2.54,14.53l0,0v.21c-.06.33-.11.66-.17,1l.19-.15L12.86,79l1.86-1.51,4.81-3.9,1.17,3.48L34.94,60.31,50.45,78.82a5.77,5.77,0,0,1,4.9.92,5,5,0,0,1,1.51,1.91c0,.09.08.18.11.27a4.18,4.18,0,0,1,.3,1.29L73.5,93l-5.2-4.79,0-.09.09-.18L69,86.74l4.34-9,2.88,4.83L90,66.34V8.7A1.71,1.71,0,0,0,88.29,7Z" transform="translate(-10 -6.99)" />
                </svg>
              </div>
            </div>

            <h1 style={titleStyle}>Resumen operativo diario</h1>

            <p style={textStyle}>
              Hola, <strong>{agencyName}</strong>
            </p>

            <p style={textStyle}>
              Este es el resumen de tu operación para el día <strong>{digestDate}</strong>.
            </p>

            <div style={infoBoxStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={infoLabelStyle}>Viajes activos</td>
                    <td style={infoValueStyle}>{activeTrips}</td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Reservas del día</td>
                    <td style={infoValueStyle}>{todayReservations}</td>
                  </tr>
                  <tr>
                    <td style={infoLabelStyle}>Pendientes de abordaje</td>
                    <td style={infoValueStyle}>{pendingBoarding}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 style={sectionTitleStyle}>Próximos viajes (48 h)</h2>

            {upcomingTrips.length === 0 ? (
              <p style={textStyle}>No hay viajes activos en las próximas 48 horas.</p>
            ) : (
              <div style={infoBoxStyle}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Ruta</th>
                      <th style={thStyle}>Salida</th>
                      <th style={thStyle}>Reservas</th>
                      <th style={thStyle}>Disp.</th>
                      <th style={thStyle}>Ocup.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingTrips.map((trip) => (
                      <tr key={`${trip.route_label}-${trip.departure_formatted}`}>
                        <td style={tdStyle}>{trip.route_label}</td>
                        <td style={tdStyle}>{trip.departure_formatted}</td>
                        <td style={tdStyle}>{trip.reservation_count}</td>
                        <td style={tdStyle}>
                          {trip.available_seats}/{trip.capacity}
                        </td>
                        <td style={tdStyle}>{trip.occupancy_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ textAlign: 'center', margin: '24px' }}>
              <a href={dashboardUrl} style={ctaStyle}>
                Abrir centro de operaciones
              </a>
            </div>

            <div style={dividerStyle} />

            <p style={footerStyle}>
              Nómadas Tour — Dejando huellas por Venezuela
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

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
  backgroundColor: '#fdfdfd',
  borderRadius: '16px',
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const headerStyle: React.CSSProperties = {
  backgroundColor: '#000024',
  padding: '24px',
  textAlign: 'center',
};

const logoContainerStyle: React.CSSProperties = {
  display: 'inline-block',
};

const logoSvgStyle: React.CSSProperties = {
  width: '48px',
  height: '52px',
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
  fontWeight: 800,
  fontSize: '22px',
  color: '#000024',
  margin: '24px 24px 8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
  fontWeight: 700,
  fontSize: '16px',
  color: '#000024',
  margin: '8px 24px 0',
};

const textStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '14px',
  color: '#374151',
  lineHeight: 1.6,
  margin: '0 24px 12px',
};

const infoBoxStyle: React.CSSProperties = {
  margin: '16px 24px',
  padding: '16px',
  backgroundColor: '#f1f5f9',
  borderRadius: '10px',
};

const infoLabelStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '12px',
  color: '#6b7280',
  padding: '4px 0',
  width: '55%',
};

const infoValueStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '14px',
  fontWeight: 600,
  color: '#000024',
  padding: '4px 0',
  textAlign: 'right',
};

const thStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '11px',
  color: '#6b7280',
  textAlign: 'left',
  padding: '4px 2px',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '12px',
  color: '#000024',
  padding: '6px 2px',
  verticalAlign: 'top',
};

const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#00D4FF',
  color: '#ffffff',
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontWeight: 600,
  fontSize: '14px',
  textDecoration: 'none',
  padding: '12px 20px',
  borderRadius: '10px',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: '#e5e7eb',
  margin: '16px 24px',
};

const footerStyle: React.CSSProperties = {
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
  fontSize: '12px',
  color: '#6b7280',
  textAlign: 'center',
  margin: '0 24px 24px',
};
