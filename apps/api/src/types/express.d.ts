import type { AccessClaims } from '../auth/jwt.js'

declare global {
  namespace Express {
    interface Request {
      claims?: AccessClaims
    }
  }
}

export {}
