import { useLayoutEffect, useRef } from 'react';
import { BarChart3, FolderOpen, Scale, Unlock, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ViewType } from '@/types/views';

type DockMenuProps = {
  activeView: ViewType;
  onChange: (view: ViewType) => void;
  onDocumentsHoverChange?: (hovered: boolean) => void;
  onHeightChange?: (height: number) => void;
};

type DockItem = {
  key: ViewType;
  label: string;
  icon: LucideIcon;
  gradient: string;
};

const dockItems: DockItem[] = [
  {
    key: 'documents',
    label: 'Documents',
    icon: FolderOpen,
    gradient: 'from-slate-900 via-slate-800 to-slate-700',
  },
  {
    key: 'uploads',
    label: 'Uploads',
    icon: Upload,
    gradient: 'from-sky-500 via-blue-500 to-indigo-500',
  },
  {
    key: 'decrypt',
    label: 'Decrypt',
    icon: Unlock,
    gradient: 'from-emerald-500 via-teal-500 to-emerald-400',
  },
  {
    key: 'cashflow',
    label: 'Cashflow',
    icon: BarChart3,
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
  },
  {
    key: 'balance',
    label: 'Balance',
    icon: Scale,
    gradient: 'from-violet-500 via-purple-500 to-indigo-500',
  },
];

export function DockMenu({ activeView, onChange, onDocumentsHoverChange, onHeightChange }: DockMenuProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!wrapperRef.current || typeof window === 'undefined') return;

    const updateHeight = () => {
      if (!wrapperRef.current) return;
      onHeightChange?.(wrapperRef.current.getBoundingClientRect().height);
    };

    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(wrapperRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [onHeightChange]);

  return (
    <div ref={wrapperRef} className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-end gap-4 rounded-[32px] border border-white/40 bg-white/80 px-6 py-4 shadow-[0_25px_55px_rgba(15,23,42,0.25)] backdrop-blur-2xl">
        {dockItems.map((item) => {
          const isActive = item.key === activeView;
          const hoverProps =
            item.key === 'documents'
              ? {
                  onMouseEnter: () => onDocumentsHoverChange?.(true),
                  onMouseLeave: () => onDocumentsHoverChange?.(false),
                  onFocus: () => onDocumentsHoverChange?.(true),
                  onBlur: () => onDocumentsHoverChange?.(false),
                }
              : {};
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(item.key)}
              {...hoverProps}
              className={`group flex flex-col items-center gap-2 text-[11px] font-semibold tracking-tight transition-colors duration-200 ${
                isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${item.gradient} text-white shadow-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:scale-110 ${
                  isActive ? 'scale-110 -translate-y-1 ring-2 ring-white/40' : ''
                }`}
              >
                <item.icon className="h-5 w-5" />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
