import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, Plus, Search, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { apiClient, ApiError } from '@/services/api/apiClient';
import { UserRole } from '@/types';
import { hasPermission } from '@/modules/auth/rbac';

interface SupplierBillsViewProps {
  userRole: UserRole;
}

export function SupplierBillsView({ userRole }: SupplierBillsViewProps) {
  const [bills, setBills] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedBill, setSelectedBill] = useState<any | null>(null);

  const canCreate = hasPermission(userRole, 'ACCOUNTING', 'CREATE');

  const fetchBills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const result = await apiClient.getSupplierBills(params);
      setBills(result.data || []);
      setPagination(result.pagination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load supplier bills');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const handlePost = async (billId: string) => {
    try {
      await apiClient.postSupplierBill(billId);
      await fetchBills();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to post bill');
    }
  };

  const filteredBills = bills.filter(b => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (b.billNumber || '').toLowerCase().includes(q) ||
      (b.supplier?.name || '').toLowerCase().includes(q) ||
      (b.supplierRef || '').toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED': return <Badge variant="slateBlue">Posted</Badge>;
      case 'APPROVED': return <Badge variant="success">Approved</Badge>;
      case 'DRAFT': return <Badge variant="neutral">Draft</Badge>;
      case 'CANCELLED': return <span className="text-[11px] text-red-600 font-semibold">Cancelled</span>;
      default: return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D8E2EC] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2.5">
              <FileText className="text-[#E03616]" size={22} />
              Accounts Payable — Supplier Bills
            </h1>
            <Badge variant="slateBlue">AP Ledger</Badge>
          </div>
          <p className="mt-1 text-xs text-[#54657E]">Supplier bills, VAT/WHT calculations, and payment allocation.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={fetchBills} className="flex items-center gap-1.5 text-xs">
            <RefreshCw size={14} /> Refresh
          </Button>
          {canCreate && (
            <Button variant="primary" size="sm" className="flex items-center gap-1.5 text-xs">
              <Plus size={14} /> New Supplier Bill
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800">✕</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-[#D8E2EC] shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            placeholder="Search bill number, supplier, or reference..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#D8E2EC] bg-[#F8FAFC] pl-9 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-[#64748B] focus:border-[#E03616] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['ALL', 'DRAFT', 'APPROVED', 'POSTED', 'CANCELLED'] as const).map(st => (
            <button key={st} onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === st ? 'bg-[#1B2436] text-white' : 'text-[#54657E] hover:bg-[#E8EEF5]'
              }`}>{st}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#D8E2EC] bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1B2436] text-white select-none">
              <tr>
                <th className="px-4 py-3 font-semibold">Bill #</th>
                <th className="px-4 py-3 font-semibold">Supplier</th>
                <th className="px-4 py-3 font-semibold">Ref</th>
                <th className="px-4 py-3 font-semibold">Bill Date</th>
                <th className="px-4 py-3 font-semibold text-right">Total Amount</th>
                <th className="px-4 py-3 font-semibold text-right">VAT</th>
                <th className="px-4 py-3 font-semibold text-center">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D8E2EC]">
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-xs text-[#64748B]">
                  <RefreshCw size={18} className="animate-spin mx-auto mb-2" /> Loading supplier bills...
                </td></tr>
              ) : filteredBills.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-xs text-[#64748B]">
                  <FileText size={28} className="mx-auto mb-2 text-[#94A3B8]" />
                  {searchQuery ? `No bills matching "${searchQuery}"` : 'No supplier bills found'}
                </td></tr>
              ) : filteredBills.map(bill => (
                <tr key={bill.id} className="hover:bg-[#F8FAFC] transition-colors cursor-pointer" onClick={() => setSelectedBill(bill)}>
                  <td className="px-4 py-3 font-mono font-bold text-[#0F172A] hover:text-[#E03616]">{bill.billNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#0F172A]">{bill.supplier?.name || '—'}</div>
                    <div className="text-[10px] text-[#64748B] font-mono">{bill.supplier?.kraPin || ''}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[#54657E]">{bill.supplierRef || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[#54657E]">
                    {bill.billDate ? new Date(bill.billDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[#0F172A]">
                    {bill.currency} {Number(bill.totalAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[#54657E]">
                    {Number(bill.vatAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-center">{getStatusBadge(bill.status)}</td>
                  <td className="px-4 py-3 text-right space-x-1" onClick={e => e.stopPropagation()}>
                    {bill.status === 'DRAFT' && canCreate && (
                      <button onClick={() => handlePost(bill.id)}
                        className="px-2 py-1 rounded text-xs bg-[#E03616] text-white hover:bg-[#C72E14] transition-colors font-medium cursor-pointer">
                        Post
                      </button>
                    )}
                    <button onClick={() => setSelectedBill(bill)}
                      className="px-2 py-1 rounded text-xs bg-[#E8EEF5] text-[#1B2436] hover:bg-[#D8E2EC] transition-colors font-medium cursor-pointer">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination && (
          <div className="border-t border-[#D8E2EC] bg-[#F8FAFC] px-4 py-2.5 text-[11px] text-[#54657E] font-mono">
            Showing {filteredBills.length} of {pagination.total || bills.length} bills
          </div>
        )}
      </div>

      {selectedBill && (
        <Modal isOpen={!!selectedBill} onClose={() => setSelectedBill(null)}
          title={`Supplier Bill: ${selectedBill.billNumber}`}
          description={`Supplier: ${selectedBill.supplier?.name || '—'}`} maxWidth="xl">
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Status', value: selectedBill.status },
                { label: 'Bill Date', value: selectedBill.billDate ? new Date(selectedBill.billDate).toLocaleDateString() : '—' },
                { label: 'Due Date', value: selectedBill.dueDate ? new Date(selectedBill.dueDate).toLocaleDateString() : '—' },
                { label: 'Currency', value: selectedBill.currency },
                { label: 'Subtotal', value: `${selectedBill.currency} ${Number(selectedBill.subtotal || 0).toLocaleString()}` },
                { label: 'VAT', value: `${selectedBill.currency} ${Number(selectedBill.vatAmount || 0).toLocaleString()}` },
                { label: 'WHT', value: `${selectedBill.currency} ${Number(selectedBill.whtAmount || 0).toLocaleString()}` },
                { label: 'Total', value: `${selectedBill.currency} ${Number(selectedBill.totalAmount || 0).toLocaleString()}` },
                { label: 'Supplier Ref', value: selectedBill.supplierRef || '—' },
              ].map(({ label, value }) => (
                <div key={label} className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#D8E2EC]">
                  <div className="text-[10px] font-semibold uppercase text-[#54657E]">{label}</div>
                  <div className="font-bold text-[#0F172A] mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            {selectedBill.lines?.length > 0 && (
              <div className="border border-[#D8E2EC] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[#E8EEF5] text-[11px] font-bold uppercase text-[#334155]">
                    <tr>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3 text-center">Qty</th>
                      <th className="py-2 px-3 text-right">Unit Price</th>
                      <th className="py-2 px-3 text-right">Tax</th>
                      <th className="py-2 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D8E2EC]">
                    {selectedBill.lines.map((line: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 px-3">{line.description || line.accountId}</td>
                        <td className="py-2 px-3 text-center font-mono">{line.quantity || 1}</td>
                        <td className="py-2 px-3 text-right font-mono">{Number(line.unitPrice || 0).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono text-[#54657E]">{Number(line.taxAmount || 0).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{Number(line.lineTotal || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-[#D8E2EC]">
              <Button variant="outline" size="sm" onClick={() => setSelectedBill(null)}>Close</Button>
              {selectedBill.status === 'DRAFT' && canCreate && (
                <Button variant="primary" size="sm" onClick={async () => { await handlePost(selectedBill.id); setSelectedBill(null); }}>
                  Post to GL
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
