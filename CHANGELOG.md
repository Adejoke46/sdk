# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Custom serialization/deserialization support with pluggable `Serializer` interface
- Multi-region failover and round-robin load balancing via `FailoverManager`
- Comprehensive SDK testing guide (`docs/TESTING.md`)

## [0.1.0] - 2026-09-11

### Added

#### Core Features

- **Type-safe client library** with full TypeScript support for Dorisio payment infrastructure
- **Domain-specific error classes** with rich metadata:
  - `DorisioError` (base error)
  - `AuthError` (authentication failures)
  - `WalletVerificationError` (wallet linking issues)
  - `PaymentError` (payment processing failures)
  - `ValidationError` (input validation)
  - `RateLimitError` (rate limiting)
  - `TimeoutError` (network timeouts)

#### Payment & Transactions

- **Idempotency key support** on `createTip()` for safe retries and preventing double-charging
- Transaction creation with optional message support
- Transaction history retrieval with pagination
- Transaction status checking and confirmation polling
- Stellar transaction building and submission flow

#### Wallet Management

- Wallet linking with challenge-response verification
- Wallet balance queries
- Multiple wallet support
- Network awareness (testnet/mainnet)

#### Authentication

- User registration and login
- Session validation
- Token management
- Logout functionality

#### Developer Experience

- **Exported Zod validation schemas** for consumer input validation:
  - `Schemas.Auth` (login, register, wallet verification)
  - `Schemas.Payment` (tip creation with idempotency)
  - `Schemas.Creator` (creator operations)
  - `Schemas.Wallet` (wallet operations)

- **Webhook signature verification utilities**:
  - HMAC-SHA256 signature verification
  - Constant-time comparison for security
  - Webhook payload parsing and validation
  - Webhook event type enums

- **Comprehensive examples**:
  - Vanilla JavaScript/TypeScript examples in `examples/vanilla/`
  - React hook examples with components in `examples/react/`
  - Auth, wallet linking, and payment flows

#### React Integration

- `useCreateTip()` hook with loading and error states
- `useWallet()` hook for wallet information
- `useCreatorBalance()` hook for creator balance queries
- `useTransactionHistory()` hook for transaction history
- `DorisioProvider` context for SDK configuration

#### Documentation

- Comprehensive JSDoc comments on all public methods
- Rich examples with real-world patterns
- README documentation for vanilla and React examples
- Type inference helpers (e.g., `CreateTipInput`, `TransactionDetails`)

### Dependencies

- `@stellar/stellar-sdk`: ^12.0.0
- `zod`: ^3.23.8
- `react`: ^18.0.0 (peer dependency, optional)

### Compatibility

- Node.js: >=20.0.0
- React: >=18.0.0 (optional)
- Browsers: Modern ES2020+ support required

### Security Considerations

- Always use HTTPS in production
- Store API credentials securely (env variables)
- Validate webhook signatures before processing
- Use unique idempotency keys per transaction attempt
- Never expose private keys in client code

---

## Notes

### v0.1.0 is considered production-ready for:

- Basic authentication flows
- Tip creation and payments
- Wallet linking and verification
- Transaction history retrieval

### Known Limitations

- Async event webhooks require backend implementation
- Stellar network operations use testnet by default
- React components are presentational (styling customizable)

### Breaking Changes

None (initial release)

### Migration Guide

None (initial release)

---

## Future Roadmap (v0.2.0+)

- [ ] Batch payment operations
- [ ] Advanced creator analytics
- [ ] Multi-currency support
- [ ] Subscription/recurring payments
- [ ] Mobile SDK
- [ ] Webhook retry logic
- [ ] Advanced error recovery strategies
