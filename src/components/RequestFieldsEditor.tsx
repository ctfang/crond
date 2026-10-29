import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface RequestField {
  id: number;
  enabled: boolean;
  key: string;
  value: string;
}

let fieldId = 0;
export const createRequestField = (): RequestField => ({ id: ++fieldId, enabled: true, key: '', value: '' });

interface Props {
  label: string;
  fields: RequestField[];
  disabled: boolean;
  onChange: (fields: RequestField[]) => void;
}

export default function RequestFieldsEditor({ label, fields, disabled, onChange }: Props) {
  const update = (id: number, change: Partial<RequestField>) => onChange(fields.map(field => field.id === id ? { ...field, ...change } : field));
  return (
    <div className="px-4 py-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <div className="min-w-[320px]">
          <div className="grid grid-cols-[32px_minmax(100px,1fr)_minmax(120px,1.4fr)_32px] items-center h-8 bg-slate-50 border-b border-slate-200 text-[10px] font-medium tracking-wide text-slate-400">
            <span /><span className="px-2">名称</span><span className="px-2 border-l border-slate-200">值</span><span />
          </div>
          {fields.map((field, index) => (
            <div key={field.id} className={`grid grid-cols-[32px_minmax(100px,1fr)_minmax(120px,1.4fr)_32px] items-center h-10 border-b last:border-b-0 border-slate-100 ${field.enabled ? '' : 'bg-slate-50/60'}`}>
              <input type="checkbox" aria-label={`启用${label} ${index + 1}`} disabled={disabled} checked={field.enabled} onChange={e => update(field.id, { enabled: e.target.checked })} className="justify-self-center" />
              <input aria-label={`${label}名称 ${index + 1}`} disabled={disabled} value={field.key} onChange={e => update(field.id, { key: e.target.value })} placeholder={label === '请求头' ? 'Header' : 'Key'} className="h-full min-w-0 px-2 text-xs font-mono bg-transparent text-slate-600 placeholder:text-slate-300 focus:outline-none focus:bg-indigo-50/40 disabled:opacity-50" />
              <input aria-label={`${label}值 ${index + 1}`} disabled={disabled} value={field.value} onChange={e => update(field.id, { value: e.target.value })} placeholder="Value" className="h-full min-w-0 px-2 text-xs font-mono bg-transparent border-l border-slate-100 text-slate-600 placeholder:text-slate-300 focus:outline-none focus:bg-indigo-50/40 disabled:opacity-50" />
              <button type="button" disabled={disabled} aria-label={`删除${label} ${index + 1}`} title="删除此项" onClick={() => { const next = fields.filter(item => item.id !== field.id); onChange(next.length ? next : [createRequestField()]); }} className="h-7 w-7 grid place-items-center text-slate-300 hover:text-rose-500 rounded disabled:opacity-50"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>
      <button type="button" aria-label={`添加${label}`} disabled={disabled} onClick={() => onChange([...fields, createRequestField()])} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"><Plus className="w-3.5 h-3.5" />添加{label}</button>
      <p className="mt-4 text-[11px] leading-5 text-slate-400">未勾选的项不会发送。{label === '查询参数' ? '值会自动进行 URL 编码，支持同名参数。' : '登录会话自动携带，无需手动填写 Cookie。'}</p>
    </div>
  );
}
