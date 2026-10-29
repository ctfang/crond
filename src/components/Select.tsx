import React, { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type Props = {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  title?: string;
  id?: string;
  'aria-label'?: string;
  dark?: boolean;
};

export default function Select({ value, onChange, children, className = '', disabled, autoFocus, title, id, dark, 'aria-label': label }: Props) {
  const options = Children.toArray(children).filter(isValidElement<{ value?: string; children: React.ReactNode; disabled?: boolean }>).map(child => ({
    value: String(child.props.value ?? child.props.children), label: child.props.children, disabled: child.props.disabled,
  }));
  const selected = options.findIndex(option => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 256 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const listId = useId();
  const close = () => setOpen(false);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || disabled) return;
    onChange({ target: { value: option.value } });
    close();
    trigger.current?.focus();
  };
  const show = () => {
    if (disabled) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : options.findIndex(option => !option.disabled));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upwards = below < 200 && above > below;
    const maxHeight = Math.max(40, Math.min(256, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
    const height = Math.min(options.length * 36 + 8, maxHeight);
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: upwards ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      if (!enabled.length) return;
      const current = enabled.indexOf(active);
      setActive(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)! : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const text = (Date.now() - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase();
      search.current = { text, time: Date.now() };
      const index = options.findIndex(option => !option.disabled && String(option.label).toLowerCase().startsWith(text));
      if (!open) show();
      if (index >= 0) setActive(index);
    }
  };

  return <>
    <button ref={trigger} type="button" role="combobox" id={id} aria-label={label} title={title}
      aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox"
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      autoFocus={autoFocus} disabled={disabled} onKeyDown={onKeyDown} onBlur={close}
      onClick={() => open ? close() : show()} className={`ui-select ${className}`}>
      <span className="min-w-0 flex-1 truncate text-left">{options[selected]?.label ?? '请选择'}</span>
      <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && !disabled && createPortal(<div ref={menu} id={listId} role="listbox" aria-label={label}
      style={position} onPointerDown={event => event.preventDefault()}
      className={`fixed z-[110] overflow-y-auto rounded-lg border p-1 shadow-xl ${dark ? 'border-slate-600 bg-slate-800 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(index); }}
        className={`flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs ${option.disabled ? 'cursor-not-allowed opacity-40' : active === index ? dark ? 'bg-indigo-500/20 text-indigo-200' : 'bg-indigo-50 text-indigo-700' : ''}`}>
        <span className="min-w-0 flex-1 truncate" title={String(option.label)}>{option.label}</span>
        {option.value === value && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
      </div>)}
    </div>, document.body)}
  </>;
}
