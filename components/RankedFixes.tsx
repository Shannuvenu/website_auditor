'use client';

import { useEffect, useRef, useState } from 'react';
import { RankedFix } from '@/components/RankedFix';
import { StateMessage } from '@/components/StateMessage';
import type { AnalysisResult } from '@/lib/llm/analyze';
import type { Device } from '@/lib/validation/schemas';

export interface MeasuredAuditRow {
  auditId: string;
  title: string;
  affectedCount: number;
  sampledCount: number;
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; result: AnalysisResult };

const BUTTON =
  'rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60';

/**
 * Shows the measured audits straight away. The AI analysis runs only when the person presses
 * "Start analysis", so opening a template never waits for (or pays for) a model call.
 */
export function RankedFixes({
  templateId,
  device,
  runId,
  measured,
}: {
  templateId: string;
  device: Device;
  runId: string;
  measured: MeasuredAuditRow[];
}) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  // Different template, device or run: go back to idle. Nothing is sent until the button is pressed.
  useEffect(() => {
    controllerRef.current?.abort();
    setState({ phase: 'idle' });
  }, [templateId, device, runId]);

  // Abort any in-flight request when the component unmounts.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  function startAnalysis() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ phase: 'loading' });
    fetch(`/api/templates/${templateId}/analysis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        setState({ phase: 'done', result: body as AnalysisResult });
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ phase: 'error', message: err.message });
      });
  }

  const fallback = measured.length ? (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <p className="mb-2 font-medium">Failing Lighthouse audits (measured, highest impact first)</p>
      <ul className="space-y-1">
        {measured.map((a) => (
          <li key={a.auditId}>
            {a.title} <code className="text-xs text-slate-500">{a.auditId}</code>: {a.affectedCount} of{' '}
            {a.sampledCount} sample URLs
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  if (state.phase === 'idle') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium">AI analysis has not been run for this measurement</p>
          <p className="mt-1 text-slate-600">
            The measured results are shown below. Starting the analysis asks the model to explain them and
            propose fixes. Every suggestion is checked against the measured data before it is shown. It
            usually takes 10 to 15 seconds.
          </p>
          <button type="button" onClick={startAnalysis} className={`mt-3 ${BUTTON}`}>
            Start analysis
          </button>
        </div>
        {fallback}
      </div>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="space-y-4">
        <StateMessage title="Analysing the measured evidence…">
          Suggested fixes are validated against the data before they are shown.
        </StateMessage>
        {fallback}
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="space-y-4">
        <StateMessage tone="error" title="Could not load suggested fixes">
          {state.message}
          <div className="mt-3">
            <button type="button" onClick={startAnalysis} className={BUTTON}>
              Try again
            </button>
          </div>
        </StateMessage>
        {fallback}
      </div>
    );
  }

  const { result } = state;
  if (result.status !== 'ok') {
    return (
      <div className="space-y-4">
        <StateMessage
          tone={result.status === 'failed' ? 'error' : 'neutral'}
          title={result.status === 'failed' ? 'Suggested fixes are unavailable' : 'No LLM configured'}
        >
          {result.reason}
        </StateMessage>
        {fallback}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result.issues.length ? (
        <ol className="space-y-3">
          {result.issues.map((fix) => (
            <RankedFix key={fix.rank} fix={fix} />
          ))}
        </ol>
      ) : (
        <StateMessage
          title={measured.length ? 'No suggested fix passed validation' : 'No failing audits for this template'}
        >
          {measured.length
            ? 'The model produced nothing that could be tied to the measured evidence.'
            : 'All audits in this run passed.'}
        </StateMessage>
      )}
      {result.rejected.length ? (
        <details className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer">
            {result.rejected.length} suggestion(s) rejected by validation
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {result.rejected.map((r) => (
              <li key={r.index}>
                {r.title}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-slate-500">
        Suggestions by {result.provider} ({result.model}). Priority is computed in code; the model only
        explains and proposes. Causes are hypotheses.
      </p>
      {fallback && !result.issues.length ? fallback : null}
    </div>
  );
}