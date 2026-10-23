import type { LadderResult, Realization } from '@smithonline/core';
import { useEffect, useState, type RefObject } from 'react';
import { fmtComplex, fmtFrequency } from '../lib/format';
import {
  circleTable,
  datapointTable,
  exportReport,
  printReport,
  svgPiece,
  type ReportParts,
  type ReportSelection,
} from '../lib/report';
import { useDesignStore } from '../store/useDesignStore';

interface ReportDialogProps {
  readonly result: LadderResult;
  readonly realization: Realization | null;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly schematicRef: RefObject<SVGSVGElement | null>;
  /** Whether the chart view (with the chart and the schematic) is on screen. */
  readonly chartShown: boolean;
  readonly onClose: () => void;
}

const OPTIONS: readonly { readonly key: keyof ReportSelection; readonly label: string }[] = [
  { key: 'chart', label: 'Smith chart' },
  { key: 'schematic', label: 'Schematic' },
  { key: 'datapoints', label: 'Datapoint table' },
  { key: 'circles', label: 'Circle list' },
];

/**
 * The original's print dialog: tick what goes on the page, then save it as
 * one SVG file or open it as a print page.
 */
export function ReportDialog({
  result,
  realization,
  svgRef,
  schematicRef,
  chartShown,
  onClose,
}: ReportDialogProps) {
  const design = useDesignStore((s) => s.design);
  const { setMessage } = useDesignStore.getState();
  const hasChart = chartShown;
  const hasSchematic = chartShown;
  const [sel, setSel] = useState<ReportSelection>({
    chart: hasChart,
    schematic: hasSchematic,
    datapoints: true,
    circles: true,
  });
  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';
  const nothing = !sel.chart && !sel.schematic && !sel.datapoints && !sel.circles;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const parts = (): ReportParts => {
    const date = new Date().toISOString().slice(0, 10);
    return {
      title: design.name || 'Smith Online design',
      subtitle: `${fmtFrequency(design.frequency)}, Z0 = ${design.z0} Ω, load ${fmtComplex(design.load)} Ω, Zin ${fmtComplex(result.zin)} Ω. Smith Online, ${date}.`,
      chart: sel.chart && svgRef.current ? svgPiece(svgRef.current) : null,
      schematic: sel.schematic && schematicRef.current ? svgPiece(schematicRef.current) : null,
      datapoints: realization
        ? [
            datapointTable(result, 'Datapoints, ideal values'),
            datapointTable(realization.result, `Datapoints, ${realization.sourceLabel} values`),
          ]
        : [datapointTable(result)],
      circles: circleTable(design),
    };
  };

  const save = (): void => {
    exportReport(parts(), sel, safeName);
    setMessage(`Exported ${safeName}-report.svg`);
    onClose();
  };
  const print = (): void => {
    const how = printReport(parts(), sel);
    setMessage(
      how === 'tab'
        ? 'Report opened in a new tab for printing'
        : 'Pop-ups are blocked here, so the print dialog opens with the report directly',
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="tool-head">
          <strong id="report-title">Report</strong>
          <span className="muted">one SVG file, or a page to print</span>
          <button className="btn tiny" onClick={onClose} aria-label="Close report dialog">
            &#215;
          </button>
        </div>
        <div className="report-options">
          {OPTIONS.map((o) => {
            const available =
              o.key === 'chart' ? hasChart : o.key === 'schematic' ? hasSchematic : true;
            return (
              <label key={o.key} className={`check ${available ? '' : 'disabled'}`}>
                <input
                  type="checkbox"
                  disabled={!available}
                  checked={available && sel[o.key]}
                  onChange={(e) => setSel({ ...sel, [o.key]: e.target.checked })}
                />
                {o.label}
                {!available && <span className="muted small">switch to the Smith chart</span>}
                {o.key === 'datapoints' && realization && (
                  <span className="muted small">ideal and {realization.sourceLabel}</span>
                )}
              </label>
            );
          })}
        </div>
        <div className="dropdown-note">
          The chart and schematic are drawn in the light theme at their current zoom; the tables
          come from the right panel.
        </div>
        <div className="actions">
          <button className="btn primary" onClick={save} disabled={nothing}>
            Save SVG
          </button>
          <button className="btn" onClick={print} disabled={nothing}>
            Print&#8230;
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
