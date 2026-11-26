import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Lock, Unlock, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { UserRole } from '@/types';
import { hasPermission } from '@/modules/auth/rbac';

interface FiscalPeriodsViewProps {
  userRole: UserRole;
}

export function FiscalPeriodsView({ userRole }: FiscalPeriodsViewProps) {
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reopenModal, setReopenModal] = useState<{ period: any } | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = hasPermission(userRole, 'ACCOUNTING', 'UPDATE');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fyRes, perRes] = await Promise.all([
        apiClient.getFiscalYears(),
        apiClient.getPeriods(),
      ]);
      setFiscalYears(fyRes.data || []);
      setPeriods(perRes.data || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load fiscal data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSoftClose = async (periodId: string) => {
    setSubmitting(true);
    try {
      await apiClient.softClosePeriod(periodId);
      await fetchData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to soft close period');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (periodId: string) => {
    setSubmitting(true);
    try {
      await apiClient.closePeriod(periodId);
      await fetchData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to close period');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!reopenModal || !reopenReason.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.reopenPeriod(reopenModal.period.id, { reason: reopenReason.trim() });
      setReopenModal(null);
      setReopenReason('');
      await fetchData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reopen period');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN': return <Badge variant="success">Open</Badge>;
      case 'SOFT_CLOSED': return <Badge variant="slateBlue">Soft Closed</Badge>;
      case 'CLOSED': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800"><Lock size={9} /> Closed</span>;
      default: return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <Calendar className="text-[#E03616]" size={22} />
              Fiscal Years &amp; Accounting Periods
            </h1>
            <Badge variant="slateBlue">Period Control</Badge>
          </div>
          <p className="mt-1 text-xs text-[#54657E]">Manage accounting periods, soft/hard close, and reopen controls.</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} className="flex items-center gap-1.5 text-xs">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-600">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-xs text-[#64748B]">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3" /> Loading fiscal data...
        </div>
      ) : (
        <div className="space-y-4">
          {fiscalYears.length === 0 && (
            <div className="text-center py-12 text-xs text-[#64748B] bg-white rounded-xl border border-[#D8E2EC]">
              <Calendar size={28} className="mx-auto mb-2 text-[#94A3B8]" />
              No fiscal years configured. Create one via the API.
            </div>
          )}
          {fiscalYears.map(fy => {
            const fyPeriods = periods.filter(p => p.fiscalYearId === fy.id);
            return (
              <div key={fy.id} className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden shadow-xs">
                <div className="bg-[#E8EEF5] px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-[#0F172A] text-sm">{fy.name}</span>
                    <span className="ml-3 text-xs text-[#54657E] font-mono">
                      {new Date(fy.startDate).toLocaleDateString()} — {new Date(fy.endDate).toLocaleDateString()}
                    </span>
                  </div>
                  <Badge variant={fy.isActive ? 'success' : 'neutral'}>{fy.isActive ? 'Current' : 'Inactive'}</Badge>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-[#F8FAFC] border-b border-[#D8E2EC]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold text-[#54657E] uppercase text-[10px]">Period</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-[#54657E] uppercase text-[10px]">Dates</th>
                      <th className="px-4 py-2.5 text-center font-semibold text-[#54657E] uppercase text-[10px]">Status</th>
                      {canManage && <th className="px-4 py-2.5 text-right font-semibold text-[#54657E] uppercase text-[10px]">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D8E2EC]">
                    {fyPeriods.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-[#94A3B8]">No periods in this year</td></tr>
                    ) : fyPeriods.map(period => (
                      <tr key={period.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-2.5 font-semibold text-[#0F172A]">{period.name}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#54657E]">
                          {new Date(period.startDate).toLocaleDateString()} — {new Date(period.endDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5 text-center">{getStatusBadge(period.status)}</td>
                        {canManage && (
                          <td className="px-4 py-2.5 text-right space-x-1">
                            {period.status === 'OPEN' && (
                              <>
                                <button onClick={() => handleSoftClose(period.id)} disabled={submitting}
                                  className="px-2 py-1 rounded text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-200 font-medium cursor-pointer">
                                  Soft Close
                                </button>
                                <button onClick={() => handleClose(period.id)} disabled={submitting}
                                  className="px-2 py-1 rounded text-[10px] bg-red-100 text-red-800 hover:bg-red-200 font-medium cursor-pointer">
                                  Hard Close
                                </button>
                              </>
                            )}
                            {period.status === 'SOFT_CLOSED' && (
                              <>
                                <button onClick={() => setReopenModal({ period })}
                                  className="px-2 py-1 rounded text-[10px] bg-[#E8EEF5] text-[#1B2436] hover:bg-[#D8E2EC] font-medium cursor-pointer">
                                  Reopen
                                </button>
                                <button onClick={() => handleClose(period.id)} disabled={submitting}
                                  className="px-2 py-1 rounded text-[10px] bg-red-100 text-red-800 hover:bg-red-200 font-medium cursor-pointer">
                                  Hard Close
                                </button>
                              </>
                            )}
                            {period.status === 'CLOSED' && (
                              <button onClick={() => setReopenModal({ period })}
                                className="px-2 py-1 rounded text-[10px] bg-[#E8EEF5] text-[#1B2436] hover:bg-[#D8E2EC] font-medium cursor-pointer">
                                Reopen
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {reopenModal && (
        <Modal isOpen={true} onClose={() => { setReopenModal(null); setReopenReason(''); }}
          title={`Reopen Period: ${reopenModal.period.name}`}
          description="Provide a mandatory reason for reopening this period. This action is audited.">
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="inline mr-1" />
              Reopening a closed period allows new postings. Ensure all required approvals are in place.
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Reason for Reopening <span className="text-[#E03616]">*</span>
              </label>
              <textarea rows={3} value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                placeholder="Explain why this period is being reopened..."
                className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] px-3 py-2 text-xs text-[#0F172A] focus:border-[#E03616] focus:outline-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#D8E2EC]">
              <Button variant="outline" size="sm" onClick={() => { setReopenModal(null); setReopenReason(''); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleReopen} disabled={!reopenReason.trim() || submitting}>
                {submitting ? 'Reopening...' : 'Reopen Period'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
