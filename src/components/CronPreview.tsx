import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function CronPreview({ expression = '' }: { expression?: string }) {
  const [preview, setPreview] = useState({ expression: '', label: '计算中...' });

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewCron(expression);
        const label = result.nextRun
          ? new Intl.DateTimeFormat('sv-SE', {
              timeZone: result.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
            }).format(new Date(result.nextRun))
          : '无可执行时间';
        if (current) setPreview({ expression, label: `${label} (${result.timezone})` });
      } catch (error) {
        if (current) setPreview({ expression, label: error instanceof Error ? error.message : '无法获取执行时间' });
      }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [expression]);

  const label = preview.expression === expression ? preview.label : '计算中...';
  return <span role="status" title={label}>{label}</span>;
}
