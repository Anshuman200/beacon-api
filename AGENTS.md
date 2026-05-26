# Next.js Agent Rules

**Warning:** This is Next.js 16, which has breaking changes and new APIs. Read `node_modules/next/dist/docs/` for full details.

## Project Conventions
- 12-factor app principles
- Environment variables in `.env.local`
- Configuration in `next.config.js`
- Project structure: `src/` for source, `components/`, `lib/`, `styles/`, `pages/`, `public/`

## Development Guidelines
- Write clean, maintainable code
- Follow TypeScript best practices
- Add JSDoc comments for complex logic
- Handle errors gracefully with proper error boundaries
- Optimize for performance (code splitting, memoization)

## Deployment
- AWS Amplify platform deployment recommended
- Environment variables in AWS dashboard
- Deployment via Git integration

## Testing
- Unit tests in `src/tests/`
- Integration tests for complex flows
- Component tests using React Testing Library
- E2E tests with Playwright or Cypress (if configured)

## Local Development
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run production build
npm run start

# Run tests
npm test
```

## Performance Optimization
- Use Server Components by default
- Memoize expensive computations
- Code split routes and components
- Lazy load images and heavy components
- Implement proper caching strategies

## Security
- Sanitize all user inputs
- Use environment variables for secrets
- Implement rate limiting on sensitive endpoints
- Role-based access control for all protected routes
- Proper error handling to avoid information leaks

## Versioning & Updates
- Check `node_modules/next/dist/docs/` for API changes
- Follow Next.js migration guides for major updates
- Test critical paths after library upgrades
- Update component patterns as needed
