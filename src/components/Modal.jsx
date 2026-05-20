import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`relative w-full ${maxWidth} fd-card p-0 max-h-[92vh] flex flex-col animate-pop-in shadow-xl`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E5E7EB]">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#111827] truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-[#9CA3AF] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto thin-scrollbar flex-1">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB] rounded-b-2xl flex flex-wrap items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
