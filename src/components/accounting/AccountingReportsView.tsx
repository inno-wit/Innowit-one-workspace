import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { UserRole } from '@/types';

interface AccountingReportsViewProps {
  userRole: UserRole;
}

type ReportType = 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'ar-ageing' | 'ap-ageing' | 'budget-variance' | 'vat-summary';

const REPORT_TABS: { key: ReportType; label: string }[] = [
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'profit-loss', label: 'Profit & Loss' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'cash-flow', label: 'Cash Flow' },
  { key: 'ar-ageing', label: 'AR Ageing' },
  { key: 'ap-ageing', label: 'AP Ageing' },
  { key: 'vat-summary', label: 'VAT Summary' },
  { key: 'budget-variance', label: 'Budget Variance' },
];

export function AccountingReportsView({ userRole }: AccountingReportsViewProps) {
  const [activeReport, setActiveReport] = useState<ReportType>('trial-balance');
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReportData(null);
    try {
      let res: any;
      switch (activeReport) {
        case 'trial-balance': res = await apiClient.getTrialBalance({ from: dateFrom, to: dateTo }); break;
        case 'profit-loss': res = await apiClient.getProfitAndLoss({ from: dateFrom, to: dateTo }); break;
        case 'balance-sheet': res = await apiClient.getBalanceSheet({ asOf: dateTo }); break;
        case 'cash-flow': res = await apiClient.getCashFlow({ from: dateFrom, to: dateTo }); break;
        case 'ar-ageing': res = await apiClient.getArAgeing({ asOf: dateTo }); break;
        case 'ap-ageing': res = await apiClient.getApAgeing({ asOf: dateTo }); break;
        case 'vat-summary': res = await apiClient.getVatSummary({ from: dateFrom, to: dateTo }); break;
        case 'budget-variance': res = await apiClient.getBudgetVariance(); break;
      }
      setReportData(res?.data || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [activeReport, dateFrom, dateTo]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const formatMoney = (val: any) => {
    if (val === null || val === undefined) return '—';
    return Number(val).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderTrialBalance = (data: any) => {
    const rows = data?.rows || data?.accounts || data?.lines || [];
    const totalDebit = data?.totalDebit;
    const totalCredit = data?.totalCredit;
    return (
      <div className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden">
        {totalDebit !== undefined && totalCredit !== undefined && (
          <div className={`px-4 py-2.5 text-xs font-mono flex items-center justify-end gap-6 ${
            Math.abs(Number(totalDebit) - Number(totalCredit)) < 0.01 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
          }`}>
            <span>Total Debit: <strong>{formatMoney(totalDebit)}</strong></span>
            <span>Total Credit: <strong>{formatMoney(totalCredit)}</strong></span>
            <span className="font-bold">
              {Math.abs(Number(totalDebit) - Number(totalCredit)) < 0.01 ? '✓ Balanced' : '✗ UNBALANCED'}
            </span>
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="bg-[#1B2436] text-white">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Account Code</th>
              <th className="px-4 py-3 text-left font-semibold">Account Name</th>
              <th className="px-4 py-3 text-left font-semibold">Type</th>
              <th className="px-4 py-3 text-right font-semibold">Debit</th>
              <th className="px-4 py-3 text-right font-semibold">Credit</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D8E2EC]">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">No data for selected period</td></tr>
            ) : rows.map((row: any, i: number) => (
              <tr key={i} className="hover:bg-[#F8FAFC]">
                <td className="px-4 py-2.5 font-mono text-[11px] text-[#54657E]">{row.accountNumber || row.code}</td>
                <td className="px-4 py-2.5 font-semibold text-[#0F172A]">{row.accountName || row.name}</td>
                <td className="px-4 py-2.5"><Badge variant="frost">{row.type}</Badge></td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#0F172A]">{formatMoney(row.debit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#54657E]">{formatMoney(row.credit)}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-bold tabular-nums ${Number(row.balance || 0) < 0 ? 'text-[#E03616]' : 'text-[#0F172A]'}`}>
                  {formatMoney(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAgeing = (data: any, label: string) => {
    const buckets = data?.buckets || [];
    const total = data?.total;
    return (
      <div className="space-y-4">
        {total !== undefined && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Current (0-30)', value: data?.current, color: 'text-emerald-700' },
              { label: '31-60 Days', value: data?.days30to60, color: 'text-amber-700' },
              { label: '61-90 Days', value: data?.days60to90, color: 'text-orange-700' },
              { label: '90+ Days', value: data?.days90plus, color: 'text-[#E03616]' },
            ].map(({ label: l, value, color }) => (
              <div key={l} className="rounded-xl border border-[#D8E2EC] bg-white p-3.5 shadow-xs">
                <div className="text-[10px] font-semibold uppercase text-[#54657E]">{l}</div>
                <div className={`mt-1 text-base font-bold font-mono tabular-nums ${color}`}>{formatMoney(value)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[#1B2436] text-white">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{label}</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-right font-semibold">0-30</th>
                <th className="px-4 py-3 text-right font-semibold">31-60</th>
                <th className="px-4 py-3 text-right font-semibold">61-90</th>
                <th className="px-4 py-3 text-right font-semibold">90+</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D8E2EC]">
              {(buckets.length === 0 && !data?.rows) ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">No outstanding balances</td></tr>
              ) : (data?.rows || buckets).map((row: any, i: number) => (
                <tr key={i} className="hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2.5 font-semibold text-[#0F172A]">{row.name || row.customerName || row.supplierName}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-[#0F172A]">{formatMoney(row.total || row.balance)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{formatMoney(row.current)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-amber-700">{formatMoney(row.days30to60)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-orange-700">{formatMoney(row.days60to90)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#E03616]">{formatMoney(row.days90plus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderGenericReport = (data: any) => {
    if (!data) return null;
    if (Array.isArray(data)) {
      return (
        <div className="rounded-xl border border-[#D8E2EC] bg-white p-4">
          <pre className="text-xs font-mono text-[#334155] whitespace-pre-wrap overflow-x-auto">{JSON.stringify(data, null, 2)}</pre>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-[#D8E2EC] bg-white p-4 space-y-4">
        {Object.entries(data).map(([key, val]) => (
          <div key={key} className="border-b border-[#E8EEF5] pb-3 last:border-0">
            <div className="text-[11px] font-bold uppercase text-[#54657E] mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
            {typeof val === 'object' && val !== null ? (
              <pre className="text-xs font-mono text-[#334155] whitespace-pre-wrap">{JSON.stringify(val, null, 2)}</pre>
            ) : (
              <div className="font-mono text-sm font-bold text-[#0F172A]">
                {typeof val === 'number' ? formatMoney(val) : String(val)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderReport = () => {
    if (loading) return (
      <div className="text-center py-16 text-xs text-[#64748B]">
        <RefreshCw size={24} className="animate-spin mx-auto mb-3" /> Loading {activeReport.replace('-', ' ')}...
      </div>
    );
    if (error) return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
        <AlertTriangle size={16} /> {error}
      </div>
    );
    if (!reportData) return <div className="text-center py-16 text-xs text-[#64748B]">No data available</div>;

    switch (activeReport) {
      case 'trial-balance': return renderTrialBalance(reportData);
      case 'ar-ageing': return renderAgeing(reportData, 'Customer');
      case 'ap-ageing': return renderAgeing(reportData, 'Supplier');
      default: return renderGenericReport(reportData);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <BarChart2 className="text-[#E03616]" size={22} />
              Financial Reports
            </h1>
            <Badge variant="slateBlue">Live Ledger</Badge>
          </div>
          <p className="mt-1 text-xs text-[#54657E]">
            Real-time financial statements derived from posted general ledger entries.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <label className="text-xs text-[#54657E] font-semibold">From:</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="rounded border border-[#D8E2EC] bg-[#F8FAFC] px-2 py-1 text-xs text-[#0F172A] focus:border-[#E03616] focus:outline-none" />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-[#54657E] font-semibold">To:</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="rounded border border-[#D8E2EC] bg-[#F8FAFC] px-2 py-1 text-xs text-[#0F172A] focus:border-[#E03616] focus:outline-none" />
          </div>
          <Button variant="outline" size="sm" onClick={fetchReport} className="flex items-center gap-1.5 text-xs">
            <RefreshCw size={14} /> Run Report
          </Button>
        </div>
      </div>

      {/* Report Tab Selector */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 bg-white p-2 rounded-xl border border-[#D8E2EC] shadow-xs">
        {REPORT_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveReport(tab.key)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeReport === tab.key ? 'bg-[#1B2436] text-white shadow-xs' : 'text-[#54657E] hover:text-[#0F172A] hover:bg-[#E8EEF5]'
            }`}>{tab.label}</button>
        ))}
      </div>

      {renderReport()}
    </div>
  );
}
