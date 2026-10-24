# Preserved browser-session reference

The cookie parser and old sessions repository are retained for compatibility review and tests only. `app.ts` never wires this repository into the mobile API. New authentication lives in `modules/auth`; legacy cookies and the old sessions table do not grant bearer access. Token randomness/hash utilities are shared temporarily; migrating those utilities does not require destroying the old reference.
