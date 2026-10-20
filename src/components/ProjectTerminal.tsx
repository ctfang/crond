import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  projectId: string;
  blocked: boolean;
}

export default function ProjectTerminal({ projectId, blocked }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const retries = useRef(0);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'closed'>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let opened = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setConnection('connecting');
    const term = new Terminal({
      cursorBlink: true, fontSize: 13, scrollback: 3000,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
      screenReaderMode: true,
      theme: { background: '#101214', foreground: '#d1d5db', cursor: '#34d399' },
    });
    terminal.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/terminal/ws`, window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket | null = null;
    const resize = () => {
      if (disposed || !host.current?.clientWidth || !host.current?.clientHeight) return;
      fit.fit();
      if (socket?.readyState === WebSocket.OPEN) {
        // AttachAddon carries shell input/output; binary JSON carries the PTY size.
        socket.send(new TextEncoder().encode(JSON.stringify({ cols: term.cols, rows: term.rows })));
      }
    };
    // Defer connection so StrictMode's probe mount cannot reserve a second PTY.
    const frame = window.requestAnimationFrame(() => {
      if (disposed) return;
      const connectedSocket = new WebSocket(url);
      socket = connectedSocket;
      connectedSocket.binaryType = 'arraybuffer';
      connectedSocket.onopen = () => {
        if (disposed) return;
        opened = true;
        retries.current = 0;
        term.loadAddon(new AttachAddon(connectedSocket));
        setConnection('connected');
        resize();
        term.focus();
      };
      connectedSocket.onclose = () => {
        if (disposed) return;
        // A previous project's PTY may still be finishing its final file sync.
        if (!opened && retries.current < 2) {
          retries.current++;
          retryTimer = setTimeout(() => setAttempt(value => value + 1), 600);
          return;
        }
        setConnection('closed');
        term.writeln('\r\n\x1b[33m终端连接已关闭，可点击“重新连接”。\x1b[0m');
      };
      connectedSocket.onerror = () => {
        if (!disposed) term.writeln('\r\n\x1b[31m无法连接终端，请检查登录、拥有者权限或已有终端会话。\x1b[0m');
      };
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(retryTimer);
      window.cancelAnimationFrame(frame);
      socket?.close();
      term.dispose();
      terminal.current = null;
    };
  }, [projectId, attempt]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.disableStdin = blocked;
  }, [blocked, attempt]);

  return (
    <section className="h-64 min-h-48 shrink-0 flex flex-col bg-[#101214] border-t border-slate-700" aria-label="项目交互终端">
      <div className="px-4 py-2 text-xs text-slate-300 flex justify-between items-center gap-3">
        <span>项目终端 · xterm.js · Bash / Origami · {connection === 'connected' ? '已连接 Bash' : connection === 'connecting' ? '连接中…' : '已断开'}</span>
        <div className="flex items-center gap-3">
          {blocked && <span className="text-amber-300">请先保存编辑器草稿</span>}
          <button onClick={() => terminal.current?.clear()} className="text-slate-400 hover:text-white">清屏</button>
          {connection === 'closed' && <button onClick={() => { retries.current = 0; setAttempt(value => value + 1); }} className="text-emerald-400">重新连接</button>}
        </div>
      </div>
      <div ref={host} className="flex-1 min-h-0 px-3 pb-2" />
    </section>
  );
}
