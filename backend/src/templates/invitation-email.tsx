import React from 'react';

interface InvitationEmailProps {
  agencyName: string;
  invitationLink: string;
}

export function InvitationEmail({ agencyName, invitationLink }: InvitationEmailProps) {
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

            <h1 style={titleStyle}>Invitación a Nómadas Tour</h1>

            <p style={textStyle}>
              Hola, <strong>{agencyName}</strong>
            </p>

            <p style={textStyle}>
              Has sido invitado a unirte a la plataforma de Nómadas Tour.
            </p>

            <p style={textStyle}>
              Haz clic en el siguiente enlace para completar tu registro y configurar tu contraseña:
            </p>

            <div style={buttonContainerStyle}>
              <a href={invitationLink} style={buttonStyle}>
                Completar registro
              </a>
            </div>

            <p style={textStyle}>
              Si no esperabas esta invitación, puedes ignorar este correo de forma segura.
            </p>

            <div style={dividerStyle} />

            <p style={footerStyle}>
              Nómadas Tour — Viaja con nosotros, llega seguro
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
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  padding: '40px 32px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.06)',
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
};

const logoContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: '32px',
};

const logoSvgStyle: React.CSSProperties = {
  width: '48px',
  height: '52px',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: '24px',
  fontWeight: 700,
  color: '#000024',
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
  textAlign: 'center' as const,
};

const textStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '14px',
  lineHeight: '24px',
  color: '#374151',
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#00D4FF',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '10px',
  fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  margin: '24px 0',
};

const footerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: '#6b7280',
  textAlign: 'center' as const,
};
