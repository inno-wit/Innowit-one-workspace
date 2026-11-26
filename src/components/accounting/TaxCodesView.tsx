import React, { useState, useEffect, useCallback } from 'react';
import { Percent, RefreshCw, AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { UserRole } from '@/types';
import { hasPermission } from '@/modules/auth/rbac';

interface TaxCodesViewProps {
  userRole: UserRole;
}

export function TaxCodesView({ userRole }: TaxCodesViewProps) {
  const [taxCodes, setTaxCodes] = useState<any[]>([]);
  const [vatSummary, setVatSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canCreate = hasPermission(userRole, 'ACCOUNTING', 'CREATE');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tcRes, vsRes] = await Promise.allSettled([
        apiClient.getTaxCodes(),
        apiClient.getVatSummary(),
      ]);
      if (tcRes.status === 'fulfilled') setTaxCodes(tcRes.value.data || []);
      if (vsRes.status === 'fulfilled') setVatSummary(vsRes.value.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tax data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case 'STANDARD_VAT': return <Badge variant="success">Standard VAT</Badge>;
      case 'ZERO_RATED': return <Badge variant="slateBlue">Zero Rated</Badge>;
      case 'EXEMPT': return <Badge variant="neutral">Exempt</Badge>;
      case 'OUT_OF_SCOPE': return <Badge variant="frost">Out of Scope</Badge>;
      case 'WHT_INCOME': return <Badge variant="slateBlue">WHT Income</Badge>;
      case 'WHT_VAT': return <Badge variant="slateBlue">WHT VAT</Badge>;
      default: return <Badge variant="neutral">{kind}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <Percent className="text-[#E03616]" size={22} />
              Tax Codes &amp; VAT Summary
            </h1>
            <Badge variant="slateBlue">Tax Engine</Badge>
          </div>
          <p className="mt-1 text-xs text-[#54657E]">Effective-dated tax rules, Kenyan VAT catalogue, and WHT codes.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={fetchData} className="flex items-center gap-1.5 text-xs">
            <RefreshCw size={14} /> Refresh
          </Button>
          {canCreate && (
            <Button variant="primary" size="sm" className="flex items-center gap-1.5 text-xs">
              <Plus size={14} /> New Tax Code
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-600">✕</button>
        </div>
      )}

      {/* VAT Summary Panel */}
      {vatSummary && (
        <div className="rounded-xl border border-[#D8E2EC] bg-white p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#1B2436] mb-3">VAT Summary (Current Period)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Output VAT (Sales)', value: vatSummary.outputVat, color: 'text-[#E03616]' },
              { label: 'Input VAT (Purchases)', value: vatSummary.inputVat, color: 'text-emerald-700' },
              { label: 'Net VAT Payable', value: vatSummary.netVat, color: 'text-[#0F172A]' },
              { label: 'WHT Payable', value: vatSummary.whtPayable, color: 'text-amber-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] p-3">
                <div className="text-[10px] font-semibold uppercase text-[#54657E]">{label}</div>
                <div className={`text-sm font-bold font-mono tabular-nums mt-1 ${color}`}>
                  KES {Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tax Codes Table */}
      <div className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#1B2436] text-white select-none">
              <tr>
                <th className="px-4 py-3 font-semibold text-left">Code</th>
                <th className="px-4 py-3 font-semibold text-left">Name</th>
                <th className="px-4 py-3 font-semibold text-center">Kind</th>
                <th className="px-4 py-3 font-semibold text-right">Rate (%)</th>
                <th className="px-4 py-3 font-semibold text-left">Effective From</th>
                <th className="px-4 py-3 font-semibold text-center">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D8E2EC]">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">
                  <RefreshCw size={18} className="animate-spin mx-auto mb-2" /> Loading...
                </td></tr>
              ) : taxCodes.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">
                  <Percent size={28} className="mx-auto mb-2 text-[#94A3B8]" /> No tax codes configured
                </td></tr>
              ) : taxCodes.map(tc => (
                <tr key={tc.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#0F172A]">{tc.code}</td>
                  <td className="px-4 py-3 font-semibold text-[#0F172A]">{tc.name}</td>
                  <td className="px-4 py-3 text-center">{getKindBadge(tc.kind)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[#0F172A]">
                    {Number(tc.rate || 0).toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[#54657E]">
                    {tc.effectiveFrom ? new Date(tc.effectiveFrom).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {tc.isActive ? (
                      <span className="text-emerald-700 font-semibold text-[11px]">✓ Active</span>
                    ) : (
                      <span className="text-[#64748B] text-[11px]">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
