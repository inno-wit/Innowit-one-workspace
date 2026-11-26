import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { UserRole } from '@/types';
import { hasPermission } from '@/modules/auth/rbac';

interface FxRatesViewProps {
  userRole: UserRole;
}

export function FxRatesView({ userRole }: FxRatesViewProps) {
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ currency: '', rateValue: '', rateDate: new Date().toISOString().slice(0, 10), rateType: 'CBK' });
  const [submitting, setSubmitting] = useState(false);

  const canCreate = hasPermission(userRole, 'ACCOUNTING', 'CREATE');

  const fetchRates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getFxRates();
      setRates(res.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load FX rates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.currency || !form.rateValue || !form.rateDate) return;
    setSubmitting(true);
    try {
      await apiClient.captureRate({ currency: form.currency, rateValue: form.rateValue, rateDate: form.rateDate, rateType: form.rateType });
      setAddModal(false);
      setForm({ currency: '', rateValue: '', rateDate: new Date().toISOString().slice(0, 10), rateType: 'CBK' });
      await fetchRates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to capture rate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <TrendingUp className="text-[#E03616]" size={22} />
              FX Exchange Rates
            </h1>
            <Badge variant="slateBlue">Multi-Currency</Badge>
          </div>
          <p className="mt-1 text-xs text-[#54657E]">Capture and manage exchange rates for multi-currency transactions.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={fetchRates} className="flex items-center gap-1.5 text-xs">
            <RefreshCw size={14} /> Refresh
          </Button>
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setAddModal(true)} className="flex items-center gap-1.5 text-xs">
              <Plus size={14} /> Capture Rate
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

      <div className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#1B2436] text-white select-none">
              <tr>
                <th className="px-4 py-3 font-semibold text-left">Currency Pair</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
                <th className="px-4 py-3 font-semibold text-right">Inverse</th>
                <th className="px-4 py-3 font-semibold text-left">Rate Date</th>
                <th className="px-4 py-3 font-semibold text-left">Source Type</th>
                <th className="px-4 py-3 font-semibold text-left">Captured At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D8E2EC]">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">
                  <RefreshCw size={18} className="animate-spin mx-auto mb-2" /> Loading...
                </td></tr>
              ) : rates.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-[#64748B]">
                  <TrendingUp size={28} className="mx-auto mb-2 text-[#94A3B8]" /> No exchange rates captured
                </td></tr>
              ) : rates.map(r => (
                <tr key={r.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#0F172A]">{r.fromCurrency}/{r.toCurrency}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[#0F172A]">
                    {Number(r.rate || 0).toFixed(6)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[#54657E]">
                    {r.rate ? (1 / Number(r.rate)).toFixed(6) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[#54657E]">
                    {r.rateDate ? new Date(r.rateDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="frost">{r.rateType || 'CBK'}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[#54657E]">
                    {r.capturedAt ? new Date(r.capturedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addModal && (
        <Modal isOpen={true} onClose={() => setAddModal(false)}
          title="Capture Exchange Rate"
          description="Record the exchange rate for a currency pair. This is used for multi-currency transactions.">
          <form onSubmit={handleCapture} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">Currency Code <span className="text-[#E03616]">*</span></label>
                <input required type="text" placeholder="e.g. USD, EUR, GBP"
                  value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#0F172A] font-mono focus:border-[#E03616] focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">Rate (to functional currency) <span className="text-[#E03616]">*</span></label>
                <input required type="number" step="0.000001" placeholder="e.g. 130.5000"
                  value={form.rateValue} onChange={e => setForm(f => ({ ...f, rateValue: e.target.value }))}
                  className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#0F172A] font-mono focus:border-[#E03616] focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">Rate Date <span className="text-[#E03616]">*</span></label>
                <input required type="date"
                  value={form.rateDate} onChange={e => setForm(f => ({ ...f, rateDate: e.target.value }))}
                  className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#E03616] focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">Rate Source</label>
                <select value={form.rateType} onChange={e => setForm(f => ({ ...f, rateType: e.target.value }))}
                  className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#E03616] focus:outline-none">
                  <option value="CBK">CBK Indicative</option>
                  <option value="BANK">Actual Bank Rate</option>
                  <option value="MANUAL">Manual Entry</option>
                </select>
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800">
              Note: CBK indicative rates are reference rates only. Actual transaction rates may differ. Record the rate type accurately.
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#D8E2EC]">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddModal(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" disabled={submitting}>
                {submitting ? 'Saving...' : 'Capture Rate'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
