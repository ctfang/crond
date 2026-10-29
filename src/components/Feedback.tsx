import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

type Confirmation = { id: number; message: string; resolve: (confirmed: boolean) => void };
type Notice = { id: number; message: string };
let confirmations: Confirmation[] = [];
let notices: Notice[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => listeners.forEach(listener => listener());

export function confirmAction(message: string): Promise<boolean> {
  return new Promise(resolve => { confirmations = [...confirmations, { id: ++nextId, message, resolve }]; emit(); });
}

export function notify(message: string) {
  notices = [...notices, { id: ++nextId, message }];
  emit();
}

function dismissNotice(id: number) {
  notices = notices.filter(notice => notice.id !== id);
  emit();
}

function ConfirmationDialog({ request }: { request: Confirmation }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const finish = (confirmed: boolean) => {
    dialog.current?.close();
    confirmations = confirmations.filter(item => item !== request);
    request.resolve(confirmed);
    emit();
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="confirmation-title" aria-describedby="confirmation-message"
    onCancel={event => { event.preventDefault(); finish(false); }}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm">
    <div className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="h-5 w-5" /></span>
        <h2 id="confirmation-title" className="text-base font-semibold">确认操作</h2>
      </div>
      <p id="confirmation-message" className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{request.message}</p>
    </div>
    <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
      <button autoFocus type="button" onClick={() => finish(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">取消</button>
      <button type="button" onClick={() => finish(true)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">确认删除</button>
    </div>
  </dialog>;
}

export default function Feedback() {
  const queue = useSyncExternalStore(subscribe, () => confirmations);
  const messages = useSyncExternalStore(subscribe, () => notices);
  return <>
    {queue[0] && <ConfirmationDialog key={queue[0].id} request={queue[0]} />}
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed right-4 top-4 z-[100] flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-sm flex-col gap-3 overflow-y-auto">
      {messages.map(notice => <div key={notice.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-700 shadow-lg">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6">{notice.message}</p>
        <button type="button" aria-label="关闭通知" onClick={() => dismissNotice(notice.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-4 w-4" /></button>
      </div>)}
    </div>
  </>;
}
