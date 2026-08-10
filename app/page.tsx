export default function Home() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 480,
        margin: '80px auto',
        padding: '0 24px',
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Email API</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        Secure REST API for transactional email delivery via SMTP.
      </p>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ padding: '6px 12px 6px 0', color: '#888', whiteSpace: 'nowrap' }}>
              Status
            </td>
            <td style={{ padding: '6px 0', color: '#16a34a', fontWeight: 600 }}>
              ● Online
            </td>
          </tr>
          <tr>
            <td style={{ padding: '6px 12px 6px 0', color: '#888' }}>Version</td>
            <td style={{ padding: '6px 0' }}>v1</td>
          </tr>
          <tr>
            <td style={{ padding: '6px 12px 6px 0', color: '#888' }}>Health</td>
            <td style={{ padding: '6px 0' }}>
              <a href="/api/health" style={{ color: '#2563eb' }}>
                /api/health
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  )
}
