import { RefreshCw } from 'lucide-react';

export type ActiveTab = 'market' | 'portfolio' | 'history' | 'rules' | 'phantom';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onScanNow: () => void;
  isScanning: boolean;
  phantomConnected?: boolean;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'market', label: 'Mercado' },
  { id: 'portfolio', label: 'Cartera' },
  { id: 'history', label: 'Historial' },
  { id: 'rules', label: 'Reglas' },
  { id: 'phantom', label: 'Phantom' },
];

function PhantomSymbol({ connected }: { connected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 ${connected ? 'text-emerald-400' : 'text-violet-400'}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5C6.75 2.5 3 6.55 3 12.1c0 4.25 1.88 7.5 4.45 8.55 1.02.42 1.87-.33 2.13-1.1.24-.71.48-1.45.95-1.45.47 0 .67.74.93 1.45.28.77 1.12 1.52 2.14 1.1.98-.4 1.85-1.32 2.48-2.43.88.53 2.02.2 2.77-.64C20.1 16.2 21 14.3 21 12.1 21 6.55 17.25 2.5 12 2.5Zm-2.3 8.2a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4.6 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

export function TopBar({
  activeTab,
  onSelectTab,
  onScanNow,
  isScanning,
  phantomConnected = false,
}: TopBarProps) {
  return (
    <header className="border-b border-slate-800 bg-[#0B0F17]">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-3.5">
        {/* Zone 1: Single-element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('market');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-500 rounded"
        >
          victorinOX
        </a>

        {/* Zone 2: Clean single-line text nav links */}
        <nav aria-label="Navegación principal" className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative inline-flex items-center gap-1.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-500 rounded ${
                  isActive
                    ? 'text-slate-100'
                    : item.id === 'phantom' && phantomConnected
                    ? 'text-emerald-400 hover:text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.id === 'phantom' && <PhantomSymbol connected={phantomConnected} />}
                <span>{item.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-emerald-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onScanNow}
            disabled={isScanning}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isScanning ? 'Escaneando...' : 'Escanear Ahora'}</span>
          </button>
        </div>
      </div>

      {/* Mobile navigation row */}
      <nav
        aria-label="Navegación móvil"
        className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-slate-800/80 px-4 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`inline-flex items-center gap-1 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.id === 'phantom' && <PhantomSymbol connected={phantomConnected} />}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
