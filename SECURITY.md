# Security Policy

## Reporting Vulnerabilities

The Dorisio project takes security very seriously. If you discover a security vulnerability, please report it to us responsibly.

### How to Report

**Do not open public issues for security vulnerabilities.** Instead, please email security concerns directly to the maintainers.

Include the following information in your report:
- Description of the vulnerability
- Affected versions
- Steps to reproduce (if applicable)
- Potential impact
- Any proposed fixes (optional)

## Security Best Practices

When using the Dorisio SDK, please follow these security best practices:

### Wallet Key Management

- **Never share your private keys** with anyone, including Dorisio developers or support staff
- **Store private keys securely** using environment variables or secure key management systems
- **Do not hardcode credentials** in source code or version control
- **Rotate keys regularly** if you suspect any compromise
- **Use hardware wallets** for storing significant amounts of cryptocurrency
- **Test with testnet first** before deploying to mainnet

### Payment Security

- **Validate all payment amounts** before processing
- **Implement rate limiting** on payment endpoints
- **Monitor for suspicious transaction patterns**
- **Use TLS/HTTPS** for all API communications
- **Verify transaction confirmations** before considering payment complete
- **Implement proper authorization checks** for payment operations
- **Log all payment transactions** for audit purposes

### General Security

- **Keep dependencies updated** - regularly run `npm audit` and update packages
- **Review SDK changes** in release notes, especially for security-related updates
- **Use strong authentication** for your applications and services
- **Implement proper error handling** to avoid leaking sensitive information
- **Enable security features** like rate limiting and request validation
- **Follow the principle of least privilege** when assigning permissions

## Secure Token Storage

### Environment Variables (Recommended)

Store sensitive tokens in environment variables:

```bash
# .env file (never commit this)
DORISIO_API_TOKEN=your_token_here
DORISIO_SECRET_KEY=your_secret_here
```

```typescript
// Access in your application
const token = process.env.DORISIO_API_TOKEN;
```

### Platform-Specific Storage

#### Web Applications

- Use `httpOnly` cookies for session tokens to prevent XSS access
- Set `Secure` flag to ensure cookies are only sent over HTTPS
- Set `SameSite` attribute to prevent CSRF attacks
- Implement Content Security Policy (CSP) headers

#### Mobile Applications (React Native)

- Use secure storage APIs:
  - iOS: Keychain Services
  - Android: EncryptedSharedPreferences or Keystore
- Never store tokens in AsyncStorage or plain text files
- Use biometric authentication for sensitive operations

#### Server-Side Applications

- Use secret management services:
  - AWS Secrets Manager
  - Azure Key Vault
  - HashiCorp Vault
- Rotate secrets regularly
- Implement proper access controls for secret access

## CSRF Protection

### What is CSRF?

Cross-Site Request Forgery (CSRF) is an attack that forces an end user to execute unwanted actions on a web application in which they're currently authenticated.

### Prevention Strategies

1. **SameSite Cookies**: Set `SameSite=Lax` or `SameSite=Strict` on cookies
2. **CSRF Tokens**: Include anti-CSRF tokens in state-changing requests
3. **Custom Headers**: Use custom headers (e.g., `X-Requested-With`) for API calls
4. **Origin Verification**: Verify the `Origin` or `Referer` headers

### Implementation Example

```typescript
// Add CSRF token to requests
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

client.request('POST', '/api/v1/transactions/tip', {
  amount: 10,
  creatorId: '123',
}, {
  headers: {
    'X-CSRF-Token': csrfToken,
  }
});
```

## XSS Prevention

### What is XSS?

Cross-Site Scripting (XSS) allows attackers to inject malicious scripts into web pages viewed by other users.

### Prevention Strategies

1. **Input Validation**: Validate and sanitize all user inputs
2. **Output Encoding**: Encode data before rendering in HTML, JavaScript, or URLs
3. **Content Security Policy**: Implement strict CSP headers
4. **HttpOnly Cookies**: Prevent JavaScript access to sensitive cookies

### CSP Example

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';
```

## HTTPS Requirements

### Mandatory HTTPS

- All API communications must use HTTPS (TLS 1.2 or higher)
- Never use HTTP in production environments
- Implement HSTS (HTTP Strict Transport Security)

### Certificate Management

- Use valid SSL/TLS certificates from trusted CAs
- Monitor certificate expiration and renew before expiry
- Implement certificate pinning for mobile applications when possible

### HSTS Configuration

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

## Security Checklist

### Before Deployment

- [ ] All API calls use HTTPS
- [ ] Environment variables are used for sensitive data
- [ ] No hardcoded credentials in source code
- [ ] Dependencies are up-to-date (run `npm audit`)
- [ ] Error messages don't leak sensitive information
- [ ] Rate limiting is implemented on sensitive endpoints
- [ ] Input validation is implemented for all user inputs
- [ ] Authentication tokens are stored securely
- [ ] CSRF protection is implemented for state-changing operations
- [ ] Content Security Policy is configured
- [ ] HttpOnly and Secure flags are set on cookies
- [ ] Logging doesn't include sensitive data
- [ ] Backup and recovery procedures are tested
- [ ] Security headers are properly configured

### Ongoing Security

- [ ] Regular security audits (quarterly)
- [ ] Dependency updates are applied promptly
- [ ] Security advisories are monitored
- [ ] Access logs are reviewed regularly
- [ ] Incident response plan is documented and tested
- [ ] Team members receive security training

## OWASP References

For comprehensive security guidance, refer to OWASP resources:

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)

## Supported Versions

Security updates are provided for:
- Current major version: All minor and patch versions
- Previous major version: Critical security fixes only

We recommend always using the latest stable version.

## Security Updates

When we release security updates, they will be:
1. Announced via GitHub releases with security tags
2. Documented in the CHANGELOG with security notices
3. Tested thoroughly before release

Subscribe to GitHub security advisories to stay informed.

## Acknowledgments

We appreciate the security research community's efforts to help us keep Dorisio secure. We will acknowledge researchers who responsibly report vulnerabilities (unless they request anonymity).
