export const TIP_FIXTURE = {
  ID: 'tip-workflow-001',
  CREATOR_ID: 'creator-workflow-001',
  SENDER_ID: 'user-workflow-001',
  AMOUNT: 50,
  MESSAGE: 'Integration tip',
  ENVELOPE: 'AAAAAgAAAAC7integrationenvelope',
  SIGNED_ENVELOPE: 'AAAAAgAAAAC7signedintegrationenvelope',
  TX_HASH: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
  SENDER_PUBLIC_KEY: 'GSENDERPUBLICKEYINTEGRATION000000000000000000000000000',
  CREATOR_PUBLIC_KEY: 'GCREATORPUBLICKEYINTEGRATION0000000000000000000000000',
} as const;

export const WALLET_FIXTURE = {
  ID: 'wallet-workflow-001',
  USER_ID: 'user-wallet-001',
  PUBLIC_KEY: 'GWALLETPUBLICKEYINTEGRATION00000000000000000000000000',
  NONCE: 'nonce-workflow-001',
  CHALLENGE: 'CHALLENGE_XDR_WORKFLOW_001',
  PROOF: 'signed-proof-workflow-001',
  SIGNED_TRANSACTION: 'AAAAAgAAAAC7signedwalletxdr',
  EXPIRES_IN: 300,
  AVAILABLE: 250,
  PENDING: 25,
  CURRENCY: 'USDC',
} as const;

export const CREATOR_FIXTURE = {
  ID: 'creator-workflow-002',
  DOCUMENT_TYPE: 'passport',
  DOCUMENT_URL: 'https://docs.example.com/passport.pdf',
  DESCRIPTION: 'Creator identity verification',
  TOTAL_EARNINGS: 12_500,
  PENDING_BALANCE: 1_500,
  CONFIRMED_BALANCE: 11_000,
  TRANSACTION_COUNT: 42,
  MINIMUM_THRESHOLD: 10,
} as const;

export const HISTORY_FIXTURE = {
  PAGE_SIZE: 2,
  TOTAL: 5,
} as const;
