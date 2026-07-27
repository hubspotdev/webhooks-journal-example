import axios from 'axios';
import * as hubspot from '@hubspot/api-client';
import { prisma, hubspotClient, LIMITER_OPTIONS } from './clients';
import { HUBSPOT_API_BASE, JOURNAL_SCOPES, OAUTH_SCOPES } from './utils/utils';
import { createLogger } from './utils/logger';

const logger = createLogger('Auth');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('CLIENT_ID and CLIENT_SECRET must be set in .env');
}

const REDIRECT_URI = 'http://localhost:3002/oauth-callback';

export function buildAuthUrl(state?: string): string {
  let url = `https://app.hubspot.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${OAUTH_SCOPES.join('%20')}`;
  if (state) {
    url += `&state=${encodeURIComponent(state)}`;
  }
  return url;
}

// --- OAuth Authorization Code Flow (for app installation + CRM access) ---

export async function redeemCode(code: string): Promise<void> {
  const result = await hubspotClient.oauth.tokensApi.create(
    'authorization_code',
    code,
    REDIRECT_URI,
    CLIENT_ID!,
    CLIENT_SECRET!
  );

  hubspotClient.setAccessToken(result.accessToken);
  const tokenInfo = await hubspotClient.oauth.accessTokensApi.get(result.accessToken);
  const portalId = String(tokenInfo.hubId);

  const expiresAt = new Date(Date.now() + result.expiresIn * 1000);

  await prisma.authorization.upsert({
    where: { customerId: portalId },
    update: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: String(result.expiresIn),
      expiresAt,
      hsPortalId: portalId,
    },
    create: {
      customerId: portalId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: String(result.expiresIn),
      expiresAt,
      hsPortalId: portalId,
    },
  });

  logger.info(`OAuth tokens stored for portal ${portalId}`);
}

export async function getOAuthAccessTokenForPortal(portalId: string): Promise<string> {
  const auth = await prisma.authorization.findFirst({
    where: { hsPortalId: portalId },
  });

  if (!auth) {
    throw new Error(`No OAuth authorization found for portal ${portalId}. Install the app first.`);
  }

  const bufferMs = 60 * 1000;
  if (new Date(Date.now() + bufferMs) >= auth.expiresAt) {
    logger.info(`OAuth token expired for portal ${portalId}, refreshing...`);
    const result = await hubspotClient.oauth.tokensApi.create(
      'refresh_token',
      undefined as unknown as string,
      REDIRECT_URI,
      CLIENT_ID!,
      CLIENT_SECRET!,
      auth.refreshToken
    );

    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);

    await prisma.authorization.update({
      where: { customerId: auth.customerId },
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: String(result.expiresIn),
        expiresAt,
      },
    });

    logger.info('OAuth token refreshed successfully');
    return result.accessToken;
  }

  return auth.accessToken;
}

export async function authenticateHubspotClientForPortal(portalId: string): Promise<hubspot.Client> {
  const token = await getOAuthAccessTokenForPortal(portalId);
  return new hubspot.Client({
    accessToken: token,
    limiterOptions: LIMITER_OPTIONS,
  });
}

export async function getInstalledPortals(): Promise<string[]> {
  const auths = await prisma.authorization.findMany({
    select: { hsPortalId: true },
    distinct: ['hsPortalId'],
  });
  return auths.map((a) => a.hsPortalId);
}

// --- Client Credentials Flow (for Journal API access) ---

let cachedClientCredentialToken: { accessToken: string; expiresAt: Date } | null = null;

export async function getClientCredentialToken(): Promise<string> {
  if (cachedClientCredentialToken && new Date(Date.now() + 60_000) < cachedClientCredentialToken.expiresAt) {
    return cachedClientCredentialToken.accessToken;
  }

  const stored = await prisma.clientCredentialToken.findFirst({
    orderBy: { id: 'desc' },
  });

  if (stored && new Date(Date.now() + 60_000) < stored.expiresAt) {
    cachedClientCredentialToken = {
      accessToken: stored.accessToken,
      expiresAt: stored.expiresAt,
    };
    return stored.accessToken;
  }

  logger.info('Requesting new client credentials token...');

  const response = await axios.post(
    `${HUBSPOT_API_BASE}/oauth/v1/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope: JOURNAL_SCOPES.join(' '),
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  const { access_token, expires_in } = response.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await prisma.clientCredentialToken.create({
    data: { accessToken: access_token, expiresAt },
  });

  cachedClientCredentialToken = { accessToken: access_token, expiresAt };
  logger.info('Client credentials token obtained successfully');

  return access_token;
}
