## Packages
framer-motion | Smooth animations for page transitions and modal entries
date-fns | Formatting dates for patient DOB and sample collection times
recharts | Dashboard analytics charts for test volumes
clsx | Utility for constructing className strings conditionally
tailwind-merge | Utility for merging Tailwind classes safely

## Notes
- Authentication is handled via /api/auth endpoints (session-based)
- All mutations invalidate relevant query keys to keep UI in sync
- Strict type safety using shared Zod schemas
