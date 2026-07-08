import { SignJWT, jwtVerify } from 'jose'
import { config } from '../config.js'

const secret = new TextEncoder().encode(config.JWT_SECRET)

export type AccessClaims = {
  sub: string
  email: string
  org_id: string | null
  role_key: string | null
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ email: claims.email, org_id: claims.org_id, role_key: claims.role_key })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(config.JWT_ACCESS_TTL)
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret)
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    org_id: (payload.org_id as string) ?? null,
    role_key: (payload.role_key as string) ?? null,
  }
}
