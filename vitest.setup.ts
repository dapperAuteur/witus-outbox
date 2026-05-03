import { vi } from "vitest";

// `import "server-only"` is a marker that throws if a file is bundled into a
// client component. In Node-side vitest runs, the import would also throw
// because the package's runtime check sees no React Server Component flag.
// Stub it to a no-op so tests can import lib/ files that are intended to
// run server-side.
vi.mock("server-only", () => ({}));
