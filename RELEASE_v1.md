# Ghost v1.0.0 Release Notes

Welcome to Ghost v1.0.0! This release marks our graduation to a production-ready, secure, and hardened AI assistant platform.

## What's New in v1.0.0

- **Production Security Hardening (`GHOST_DEPLOYMENT_MODE`)**: We've introduced a `public` deployment mode which restricts privileged system operations (like shell execution and arbitrary file writes) exclusively to authenticated administrators, while still providing robust and helpful text-assistance to standard users.
- **Robust JWT Authentication**: We now have a full authentication layer for API endpoints, using cryptographically sound JWT tokens and bcrypt hashing.
- **Role-Based Access Control (RBAC)**: Fine-grained tool access limits standard users to safe capabilities (`chat:use`, `memory:read`, `memory:write`), preventing unauthorized access to the host environment.
- **Encrypted Local Auth State**: Safe administration and guest isolation capabilities to support public-facing deployments.
- **Multi-LLM Fallback Architecture**: Continues to support robust fallbacks across Gemini, Groq, NVIDIA NIM, and OpenRouter to guarantee sub-second latency and uptime.

## Migration Guide

To deploy v1.0.0, you must update your `.env` file with the following new variables:

```env
GHOST_DEPLOYMENT_MODE=public
AUTH_REQUIRED=true
JWT_SECRET=your_secure_random_string_here
```

## Security Improvements
- Guarded all system routes (`/api/execute-plan-step`, `/api/workspace/save`, etc.) to reject unauthorized traffic.
- Added strict rate limiting to authentication endpoints.
- Validated all inbound payloads to mitigate injection and DOS vectors.

Enjoy the new secure and powerful Ghost!
