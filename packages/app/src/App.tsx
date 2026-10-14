import { cabs, complex, CORE_VERSION } from '@smithonline/core';
import { useAppStore } from './store/useAppStore';

export function App() {
  const z0 = useAppStore((s) => s.z0);
  const setZ0 = useAppStore((s) => s.setZ0);
  const magnitude = cabs(complex(3, 4));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6 font-sans">
      <h1 className="text-2xl font-semibold">Smith Online</h1>
      <p className="text-sm text-gray-600">
        Phase 0 scaffold. Core library {CORE_VERSION}, |3 + 4j| = {magnitude}.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <span>Z0 (ohm)</span>
        <input
          className="w-24 rounded border border-gray-300 px-2 py-1"
          type="number"
          value={z0}
          onChange={(e) => setZ0(Number(e.target.value))}
        />
      </label>
    </main>
  );
}
