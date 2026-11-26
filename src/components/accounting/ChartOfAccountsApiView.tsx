/**
 * Phase 4 — API-wired Chart of Accounts
 * Fetches accounts from /api/accounting/accounts and passes them to ChartOfAccountsView.
 * Replaces the static DEFAULT_ACCOUNTS prop-drilling pattern from App.tsx.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ChartOfAccountsView } from '@/components/views/ChartOfAccountsView';
import { apiClient } from '@/services/api/apiClient';
import { Account, UserRole, AccountType } from '@/types';

interface ChartOfAccountsApiViewProps {
  userRole: UserRole;
}

export function ChartOfAccountsApiView({ userRole }: ChartOfAccountsApiViewProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.getAccounts({ limit: 500 });
      const raw = (res as any)?.data ?? (res as any) ?? [];
      const list: any[] = Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
      const mapped: Account[] = list.map((a: any): Account => ({
        id: a.id,
        organizationId: a.organizationId ?? '',
        accountNumber: a.code ?? a.accountNumber ?? '',
        name: a.name,
        type: (a.type as AccountType) ?? 'ASSET',
        subType: a.subType ?? '',
        balance: Number(a.openingBalance ?? a.balance ?? 0),
        description: a.description ?? '',
        currency: a.currency ?? 'KES',
        isActive: a.isActive !== false,
      }));
      setAccounts(mapped);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleAddAccount = useCallback(async (newAccount: Account) => {
    try {
      await apiClient.createAccount({
        accountNumber: newAccount.accountNumber,
        name: newAccount.name,
        type: newAccount.type,
        subType: newAccount.subType,
        normalBalance: undefined,
        currency: newAccount.currency,
        description: newAccount.description,
        parentId: undefined,
        isControl: false,
      });
      await fetchAccounts();
    } catch (err: any) {
      console.error('[ChartOfAccountsApiView] createAccount failed:', err?.message);
    }
  }, [fetchAccounts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#00B3C8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-red-600">{error}</p>
        <button onClick={fetchAccounts} className="text-xs text-[#00B3C8] underline">Retry</button>
      </div>
    );
  }

  return (
    <ChartOfAccountsView
      accounts={accounts}
      onAddAccount={handleAddAccount}
      userRole={userRole}
    />
  );
}
