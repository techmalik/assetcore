import { useAuth } from '../lib/AuthContext'

/**
 * Where an authenticated account with no organisation lands.
 *
 * Every screen in the app is scoped to an organisation, so an account whose
 * membership row is missing has nothing any page can show. It used to reach
 * the dashboard anyway: full chrome, a truncated nav, every tile a dash, and
 * a red banner reading `no_org_context`. That is not an explanation, it is the
 * error code the API happened to use.
 *
 * This says what is actually wrong, names the account so an administrator can
 * be told exactly which one to fix, and gives the one action that works.
 */
export default function NoOrganisation() {
  const { fullName, user, signOut } = useAuth()
  const email = user?.email || fullName

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--n100)', padding: 20,
    }}>
      <div style={{
        maxWidth: 460, width: '100%', background: 'var(--n0)', border: 'var(--bdr)',
        borderRadius: 10, padding: '28px 30px',
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 14 }} aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" stroke="var(--a500)" strokeWidth="1.6" />
          <path d="M12 7.4v5.2" stroke="var(--a500)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16.3" r="1.05" fill="var(--a500)" />
        </svg>

        <h1 style={{ fontSize: 19, fontWeight: 650, color: 'var(--n900)', margin: '0 0 10px' }}>
          This account is not in an organisation yet
        </h1>

        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--n600)', margin: '0 0 12px' }}>
          You signed in successfully, but {email ? <strong>{email}</strong> : 'this account'} has not been
          added to an organisation, so there is no asset register, no work orders and no
          settings to show you. Nothing is broken on your side and nothing has been lost.
        </p>

        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--n600)', margin: '0 0 20px' }}>
          Ask a System Admin to invite this address from <strong>Admin → Users &amp; Roles</strong>.
          Once they have, sign in again and everything will be here.
        </p>

        <button
          onClick={signOut}
          className="btn btn-primary"
          style={{ width: '100%', height: 38, fontSize: 13.5 }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
